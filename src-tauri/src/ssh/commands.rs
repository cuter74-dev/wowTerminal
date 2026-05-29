//! SSH 관련 Tauri command.

use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::DataSink;
use crate::secrets::{EncryptedFileStore, SecretStore};

use super::groups::GroupStore;
use super::keys::{self, KeyStore};
use super::known_hosts::{KnownHostEntry, KnownHostsStore};
use super::manager::{SshError, SshManager};
use super::session::{ResolvedAuth, SessionId};
use super::sftp::{FileEntry, ProgressSink, SearchHit, SftpManager};
use super::store::HostStore;
use super::tags::TagStore;
use super::types::{Group, SshAuthMethod, SshHost, SshKeyEntry, Tag};

/// 프론트엔드가 패턴 매칭으로 구분할 수 있도록 직렬화된 에러.
/// 단순 `String` 대신 이 enum을 쓰면 UI가 HostKeyMismatch / FirstContact를
/// 정확히 감지해 별도 모달을 띄울 수 있다.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshConnectError {
    HostKeyMismatch {
        host: String,
        port: u16,
        algorithm: String,
        stored: String,
        presented: String,
    },
    FirstContact {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    PasswordRequired {
        host: String,
        port: u16,
        user: String,
    },
    Other {
        message: String,
    },
}

impl From<SshError> for SshConnectError {
    fn from(e: SshError) -> Self {
        match e {
            SshError::HostKeyMismatch {
                host,
                port,
                algorithm,
                stored,
                presented,
            } => Self::HostKeyMismatch {
                host,
                port,
                algorithm,
                stored,
                presented,
            },
            SshError::FirstContactRequired {
                host,
                port,
                algorithm,
                fingerprint,
            } => Self::FirstContact {
                host,
                port,
                algorithm,
                fingerprint,
            },
            SshError::PasswordRequired { host, port, user } => Self::PasswordRequired {
                host,
                port,
                user,
            },
            other => Self::Other {
                message: other.to_string(),
            },
        }
    }
}

impl SshConnectError {
    fn from_string(message: impl Into<String>) -> Self {
        Self::Other {
            message: message.into(),
        }
    }
}

pub struct SshState {
    pub manager: Arc<SshManager>,
    pub sftp: Arc<SftpManager>,
    pub store: HostStore,
    pub groups: GroupStore,
    pub tags: TagStore,
    pub keys: KeyStore,
    pub known_hosts: Arc<KnownHostsStore>,
    /// 시크릿 저장소 핸들. 앱 시작 시 사용자 패스프레이즈로 열린 핸들이 들어간다.
    /// v1에서는 일단 옵션으로 두고, 없으면 password/key auth는 사용 불가.
    pub secrets: Option<Arc<dyn SecretStore>>,
}

pub fn build_state(
    app: &AppHandle,
    hosts_path: PathBuf,
    known_hosts_path: PathBuf,
    groups_path: PathBuf,
    tags_path: PathBuf,
    keys_path: PathBuf,
) -> SshState {
    let handle = app.clone();
    let sink: DataSink = Arc::new(move |session_id, data| {
        let payload = SshOutput {
            session_id,
            data_b64: B64.encode(&data),
        };
        let _ = handle.emit("ssh:output", payload);
    });

    let known_hosts = Arc::new(KnownHostsStore::new(known_hosts_path));

    let progress_handle = app.clone();
    let progress: ProgressSink = Arc::new(move |transfer_id, transferred, total| {
        let _ = progress_handle.emit(
            "sftp:progress",
            SftpProgress {
                transfer_id,
                transferred,
                total,
            },
        );
    });

    SshState {
        manager: Arc::new(SshManager::new(sink, Arc::clone(&known_hosts))),
        sftp: Arc::new(SftpManager::new(Arc::clone(&known_hosts), progress)),
        store: HostStore::new(hosts_path),
        groups: GroupStore::new(groups_path),
        tags: TagStore::new(tags_path),
        keys: KeyStore::new(keys_path),
        known_hosts,
        secrets: None,
    }
}

#[derive(Clone, Serialize)]
struct SshOutput {
    session_id: SessionId,
    data_b64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpProgress {
    transfer_id: String,
    transferred: u64,
    total: u64,
}

#[tauri::command]
pub fn ssh_list_hosts(state: State<'_, SshState>) -> Result<Vec<SshHost>, String> {
    state.store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_save_host(host: SshHost, state: State<'_, SshState>) -> Result<(), String> {
    state.store.upsert(host).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_delete_host(id: String, state: State<'_, SshState>) -> Result<(), String> {
    state.store.delete(&id).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectArgs {
    pub host_id: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    /// PasswordPrompt 인증 시 사용자가 모달에서 입력한 password. 메모리에서만 사용, 저장 안 함.
    pub password: Option<String>,
}

#[tauri::command]
pub async fn ssh_connect(
    args: SshConnectArgs,
    state: State<'_, SshState>,
) -> Result<SessionId, SshConnectError> {
    let host = state
        .store
        .get(&args.host_id)
        .map_err(|e| SshConnectError::from_string(e.to_string()))?;
    let cols = args.cols.unwrap_or(80);
    let rows = args.rows.unwrap_or(24);

    let auth = resolve_auth(
        &host.auth,
        state.secrets.as_deref(),
        args.password.as_deref(),
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(SshConnectError::from)?;

    state
        .manager
        .connect(&host, auth, cols, rows)
        .await
        .map_err(SshConnectError::from)
}

#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data_b64: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let bytes = B64.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    state
        .manager
        .write(&session_id, &bytes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state
        .manager
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_kill(session_id: String, state: State<'_, SshState>) -> Result<(), String> {
    state
        .manager
        .kill(&session_id)
        .await
        .map_err(|e| e.to_string())
}

fn resolve_auth(
    method: &SshAuthMethod,
    secrets: Option<&dyn SecretStore>,
    prompted_password: Option<&str>,
    host: &str,
    port: u16,
    user: &str,
) -> Result<ResolvedAuth, SshError> {
    match method {
        SshAuthMethod::Password { secret_id } => {
            // 저장된 비밀번호를 우선 사용. 없으면(예: secret 저장소 이전 후) 모달 입력으로 폴백.
            if let Some(store) = secrets {
                if let Ok(pw) = store.load(secret_id) {
                    return ResolvedAuth::from_method(method, Some(pw.as_slice()), None, None);
                }
            }
            let pw = prompted_password.ok_or_else(|| SshError::PasswordRequired {
                host: host.to_string(),
                port,
                user: user.to_string(),
            })?;
            Ok(ResolvedAuth::Password(pw.to_string()))
        }
        SshAuthMethod::PasswordPrompt => {
            let pw = prompted_password.ok_or_else(|| SshError::PasswordRequired {
                host: host.to_string(),
                port,
                user: user.to_string(),
            })?;
            Ok(ResolvedAuth::Password(pw.to_string()))
        }
        SshAuthMethod::PrivateKey {
            key_id,
            passphrase_secret_id,
        } => {
            let store = secrets.ok_or_else(|| SshError::Auth("secret store not unlocked".into()))?;
            let key_pem = store.load(key_id).map_err(|e| SshError::Auth(e.to_string()))?;
            let passphrase = if let Some(pid) = passphrase_secret_id {
                Some(store.load(pid).map_err(|e| SshError::Auth(e.to_string()))?)
            } else {
                None
            };
            ResolvedAuth::from_method(
                method,
                None,
                Some(key_pem.as_slice()),
                passphrase.as_ref().map(|p| p.as_slice()),
            )
        }
        SshAuthMethod::Agent => ResolvedAuth::from_method(method, None, None, None),
    }
}

/// 시크릿 저장소를 사용자 패스프레이즈로 unlock한다. 호출 후 상태에 보관되어
/// password/key 인증이 가능해진다. v1에서는 EncryptedFileStore만 지원.
#[tauri::command]
pub fn secrets_unlock(_passphrase: String, _state: State<'_, SshState>) -> Result<(), String> {
    // 실제 unlock 흐름은 후속 이슈에서 구체화 (State를 Mutex로 감싸야 함).
    // 지금은 호출 가능 여부만 노출.
    Err("not implemented yet — use direct EncryptedFileStore for now".into())
}

/// PasswordPrompt로 입력받은 password를 OS 키링에 저장하고, 해당 호스트의 auth를
/// `Password{secret_id=hostId}`로 갱신해 다음 접속부터 자동 인증되게 한다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberPasswordArgs {
    pub host_id: String,
    pub password: String,
}

#[tauri::command]
pub fn ssh_remember_password(
    args: RememberPasswordArgs,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let secrets = state
        .secrets
        .as_ref()
        .ok_or_else(|| "secret store not configured".to_string())?;
    secrets
        .save(&args.host_id, args.password.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut host = state.store.get(&args.host_id).map_err(|e| e.to_string())?;
    host.auth = SshAuthMethod::Password {
        secret_id: args.host_id.clone(),
    };
    state.store.upsert(host).map_err(|e| e.to_string())?;
    Ok(())
}

// ---- SSH 키 관리 (S-019~024) ----

#[tauri::command]
pub fn ssh_list_keys(state: State<'_, SshState>) -> Result<Vec<SshKeyEntry>, String> {
    state.keys.list().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyArgs {
    pub name: String,
    /// "ed25519" 또는 "rsa".
    pub algorithm: String,
}

#[tauri::command]
pub fn ssh_generate_key(
    args: GenerateKeyArgs,
    state: State<'_, SshState>,
) -> Result<SshKeyEntry, String> {
    let secrets = state
        .secrets
        .as_ref()
        .ok_or_else(|| "secret store not configured".to_string())?;
    let (pem, meta) =
        keys::generate(&args.algorithm, &args.name).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    secrets.save(&id, pem.as_bytes()).map_err(|e| e.to_string())?;
    let entry = SshKeyEntry {
        id,
        name: args.name,
        algorithm: meta.algorithm,
        fingerprint: meta.fingerprint,
        public_key: meta.public_key,
        encrypted: meta.encrypted,
    };
    state.keys.upsert(entry.clone()).map_err(|e| e.to_string())?;
    Ok(entry)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportKeyArgs {
    pub name: String,
    /// OpenSSH 개인키 PEM 원문.
    pub pem: String,
    /// 암호화된 키면 복호화에 사용 (메타 추출 검증용). 저장은 PEM 원문 그대로.
    pub passphrase: Option<String>,
}

#[tauri::command]
pub fn ssh_import_key(
    args: ImportKeyArgs,
    state: State<'_, SshState>,
) -> Result<SshKeyEntry, String> {
    let secrets = state
        .secrets
        .as_ref()
        .ok_or_else(|| "secret store not configured".to_string())?;
    let meta = keys::parse_imported(&args.pem, args.passphrase.as_deref())
        .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    // PEM 원문(암호화 상태 그대로)을 keyring에 저장. 접속 시 passphrase는 별도 secret.
    secrets
        .save(&id, args.pem.as_bytes())
        .map_err(|e| e.to_string())?;
    let entry = SshKeyEntry {
        id,
        name: args.name,
        algorithm: meta.algorithm,
        fingerprint: meta.fingerprint,
        public_key: meta.public_key,
        encrypted: meta.encrypted,
    };
    state.keys.upsert(entry.clone()).map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command]
pub fn ssh_delete_key(id: String, state: State<'_, SshState>) -> Result<(), String> {
    if let Some(secrets) = state.secrets.as_ref() {
        let _ = secrets.delete(&id);
    }
    state.keys.delete(&id).map_err(|e| e.to_string())
}

// ---- SFTP 파일 브라우저 (S-025~) ----

#[derive(Serialize)]
pub struct Listing {
    /// 정규화된 현재 경로.
    pub cwd: String,
    pub entries: Vec<FileEntry>,
}

/// 호스트에 SFTP로 연결하고 시작 경로를 리스팅한다. password prompt 인증은
/// v1 SFTP에서 미지원 — agent 또는 keychain 저장된 password/key 호스트만.
#[tauri::command]
pub async fn sftp_open(
    host_id: String,
    path: Option<String>,
    state: State<'_, SshState>,
) -> Result<Listing, String> {
    let host = state.store.get(&host_id).map_err(|e| e.to_string())?;
    let auth = resolve_auth(
        &host.auth,
        state.secrets.as_deref(),
        None,
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(|e| e.to_string())?;
    state.sftp.connect(&host, auth).await.map_err(|e| e.to_string())?;

    let start = path.unwrap_or_else(|| ".".to_string());
    let cwd = state
        .sftp
        .canonicalize(&host_id, &start)
        .await
        .map_err(|e| e.to_string())?;
    let entries = state
        .sftp
        .list_dir(&host_id, &cwd)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Listing { cwd, entries })
}

#[tauri::command]
pub async fn sftp_list(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<Listing, String> {
    let cwd = state
        .sftp
        .canonicalize(&host_id, &path)
        .await
        .map_err(|e| e.to_string())?;
    let entries = state
        .sftp
        .list_dir(&host_id, &cwd)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Listing { cwd, entries })
}

#[tauri::command]
pub async fn sftp_disconnect(host_id: String, state: State<'_, SshState>) -> Result<(), String> {
    state.sftp.disconnect(&host_id).await;
    Ok(())
}

fn basename(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

/// 원격 파일을 로컬 디렉토리로 다운로드. 저장된 로컬 경로 반환.
#[tauri::command]
pub async fn sftp_download(
    host_id: String,
    remote_path: String,
    local_dir: String,
    transfer_id: String,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let name = basename(&remote_path);
    let local_path = PathBuf::from(&local_dir).join(name);
    let local_str = local_path.to_string_lossy().to_string();
    state
        .sftp
        .download(&host_id, &remote_path, &local_str, &transfer_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(local_str)
}

/// 로컬 파일을 원격 디렉토리로 업로드. 업로드된 원격 경로 반환.
#[tauri::command]
pub async fn sftp_upload(
    host_id: String,
    local_path: String,
    remote_dir: String,
    transfer_id: String,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let name = std::path::Path::new(&local_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "invalid local path".to_string())?;
    let remote_path = format!("{}/{}", remote_dir.trim_end_matches('/'), name);
    state
        .sftp
        .upload(&host_id, &local_path, &remote_path, &transfer_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(remote_path)
}

#[tauri::command]
pub async fn sftp_remove(
    host_id: String,
    path: String,
    is_dir: bool,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state
        .sftp
        .remove(&host_id, &path, is_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    host_id: String,
    from: String,
    to: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state
        .sftp
        .rename(&host_id, &from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state.sftp.mkdir(&host_id, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_touch(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state.sftp.touch(&host_id, &path).await.map_err(|e| e.to_string())
}

/// 텍스트 미리보기. 최대 256KB까지 읽어 반환.
#[tauri::command]
pub async fn sftp_read_text(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<String, String> {
    state
        .sftp
        .read_text(&host_id, &path, 256 * 1024)
        .await
        .map_err(|e| e.to_string())
}

/// 원격 파일 검색. root에서 이름에 query가 포함된 항목을 찾는다 (최대 500개).
#[tauri::command]
pub async fn sftp_search(
    host_id: String,
    root: String,
    query: String,
    recursive: bool,
    state: State<'_, SshState>,
) -> Result<Vec<SearchHit>, String> {
    state
        .sftp
        .search(&host_id, &root, &query, recursive, 500)
        .await
        .map_err(|e| e.to_string())
}

/// 원격 파일 권한 변경. mode는 8진수 정수 (예: 0o755 = 493).
#[tauri::command]
pub async fn sftp_chmod(
    host_id: String,
    path: String,
    mode: u32,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state
        .sftp
        .chmod(&host_id, &path, mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_list_dir(path: Option<String>) -> Result<Listing, String> {
    use std::time::UNIX_EPOCH;
    let base = match path {
        Some(p) => PathBuf::from(p),
        None => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };
    let canon = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&canon).map_err(|e| e.to_string())? {
        let e = match e {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            Some(meta.permissions().mode())
        };
        #[cfg(not(unix))]
        let permissions = None;
        entries.push(FileEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified,
            permissions,
        });
    }
    Ok(Listing {
        cwd: canon.to_string_lossy().to_string(),
        entries,
    })
}

// ---- 그룹 / 태그 (S-017) ----

#[tauri::command]
pub fn ssh_list_groups(state: State<'_, SshState>) -> Result<Vec<Group>, String> {
    state.groups.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_save_group(group: Group, state: State<'_, SshState>) -> Result<(), String> {
    state.groups.upsert(group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_delete_group(id: String, state: State<'_, SshState>) -> Result<(), String> {
    // 이 그룹에 속한 호스트들의 group_id를 비워준다 (호스트 자체는 보존).
    let hosts = state.store.list().map_err(|e| e.to_string())?;
    for mut h in hosts {
        if h.group_id.as_deref() == Some(&id) {
            h.group_id = None;
            state.store.upsert(h).map_err(|e| e.to_string())?;
        }
    }
    state.groups.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_list_tags(state: State<'_, SshState>) -> Result<Vec<Tag>, String> {
    state.tags.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_save_tag(tag: Tag, state: State<'_, SshState>) -> Result<(), String> {
    state.tags.upsert(tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ssh_delete_tag(id: String, state: State<'_, SshState>) -> Result<(), String> {
    // 호스트의 tags 배열에서 이 태그 이름을 제거.
    // (v1에서는 tag id를 SshHost.tags에 직접 안 넣고 이름을 넣고 있어 이름으로 매칭.)
    let target = state.tags.list().map_err(|e| e.to_string())?;
    let removed_name = target.iter().find(|t| t.id == id).map(|t| t.name.clone());
    if let Some(name) = removed_name {
        let hosts = state.store.list().map_err(|e| e.to_string())?;
        for mut h in hosts {
            let before = h.tags.len();
            h.tags.retain(|t| t != &name);
            if h.tags.len() != before {
                state.store.upsert(h).map_err(|e| e.to_string())?;
            }
        }
    }
    state.tags.delete(&id).map_err(|e| e.to_string())
}

// ---- known_hosts (TOFU) ----

#[derive(Serialize)]
pub struct KnownHostRow {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub added_at: String,
}

#[tauri::command]
pub fn ssh_list_known_hosts(state: State<'_, SshState>) -> Result<Vec<KnownHostRow>, String> {
    let entries = state.known_hosts.list().map_err(|e| e.to_string())?;
    Ok(entries
        .into_iter()
        .map(|(key, e)| split_into_row(&key, &e))
        .collect())
}

#[tauri::command]
pub fn ssh_forget_known_host(
    host: String,
    port: u16,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state.known_hosts.forget(&host, port).map_err(|e| e.to_string())
}

/// 사용자가 위험을 인지한 상태에서 새 키를 강제로 신뢰하도록 갱신한다.
/// `fingerprint`는 `SshError::HostKeyMismatch.presented`에서 받은 값을 그대로 보낸다.
#[tauri::command]
pub fn ssh_trust_known_host(
    host: String,
    port: u16,
    algorithm: String,
    fingerprint: String,
    state: State<'_, SshState>,
) -> Result<KnownHostRow, String> {
    let entry = state
        .known_hosts
        .record(&host, port, &algorithm, &fingerprint)
        .map_err(|e| e.to_string())?;
    Ok(split_into_row(&format!("{host}:{port}"), &entry))
}

fn split_into_row(key: &str, entry: &KnownHostEntry) -> KnownHostRow {
    // 키 포맷: "host:port". rsplit_once로 마지막 ':' 기준 분리 (IPv6 미지원 — TODO).
    let (host, port_str) = key
        .rsplit_once(':')
        .map(|(h, p)| (h.to_string(), p.to_string()))
        .unwrap_or_else(|| (key.to_string(), "22".into()));
    let port = port_str.parse::<u16>().unwrap_or(22);
    KnownHostRow {
        host,
        port,
        algorithm: entry.algorithm.clone(),
        fingerprint: entry.fingerprint.clone(),
        added_at: entry.added_at.clone(),
    }
}

// 컴파일러가 미사용 import로 경고하지 않도록 명시적으로 참조.
#[allow(dead_code)]
fn _ensure_imports_used() {
    let _ = std::any::TypeId::of::<EncryptedFileStore>();
}
