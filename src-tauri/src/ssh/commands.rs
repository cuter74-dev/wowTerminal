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
use super::session::{ResolvedAuth, SessionId, WireAuth, WireJump};
use super::sftp::{FileEntry, ProgressSink, SearchHit, SftpManager};
use super::store::HostStore;
use super::tags::TagStore;
use super::textfile::{self, TextRead};
use super::tunnel::{TunnelInfo, TunnelManager};
use super::types::{Group, SshAuthMethod, SshHost, SshKeyEntry, Tag};

/// 프론트엔드가 패턴 매칭으로 구분할 수 있도록 직렬화된 에러.
/// 단순 `String` 대신 이 enum을 쓰면 UI가 HostKeyMismatch / FirstContact를
/// 정확히 감지해 별도 모달을 띄울 수 있다.
#[derive(Debug, Serialize, Deserialize)]
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
    pub tunnel: Arc<TunnelManager>,
    pub store: HostStore,
    pub groups: GroupStore,
    pub tags: TagStore,
    pub keys: KeyStore,
    pub known_hosts: Arc<KnownHostsStore>,
    /// 시크릿 저장소 핸들. 앱 시작 시 사용자 패스프레이즈로 열린 핸들이 들어간다.
    /// v1에서는 일단 옵션으로 두고, 없으면 password/key auth는 사용 불가.
    pub secrets: Option<Arc<dyn SecretStore>>,
    /// SSH 세션을 소유하는 세션 데몬(#160). 프로토콜 v2 이상일 때만 들어간다 — 그러면 SSH 셸이
    /// 앱 업데이트·재시작에도 끊기지 않는다. None이면 종전처럼 인프로세스.
    #[cfg(unix)]
    pub daemon: Option<Arc<crate::daemon::client::DaemonClient>>,
}

pub fn build_state(
    app: &AppHandle,
    hosts_path: PathBuf,
    known_hosts_path: PathBuf,
    groups_path: PathBuf,
    tags_path: PathBuf,
    keys_path: PathBuf,
    history: Arc<crate::pty::manager::HistoryStore>,
) -> SshState {
    let handle = app.clone();
    let hist = Arc::clone(&history);
    let sink: DataSink = Arc::new(move |session_id, data| {
        // 출력 ring buffer에 누적(세션 인계 시 스크롤백 복원용) 후 프론트로 emit.
        hist.append(&session_id, &data);
        let payload = SshOutput {
            session_id,
            data_b64: B64.encode(&data),
        };
        let _ = handle.emit("ssh:output", payload);
    });

    let known_hosts = Arc::new(KnownHostsStore::new(known_hosts_path));

    // 진행 이벤트 throttle(#151): 병렬 다운로드는 256KB마다 progress를 호출해 초당 수백~수천
    // 건이 될 수 있다 — 매 건을 webview로 emit하면 IPC/UI가 병목이 된다. transfer_id별로
    // 40ms 간격으로만 emit하되, 시작(0)과 완료(>=total)는 항상 보낸다.
    let progress_handle = app.clone();
    let last_emit: Arc<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>> =
        Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let progress: ProgressSink = Arc::new(move |transfer_id, transferred, total| {
        let now = std::time::Instant::now();
        let should_emit = {
            let mut m = last_emit.lock().unwrap();
            let final_or_start = transferred == 0 || transferred >= total;
            let due = final_or_start
                || m.get(&transfer_id).map_or(true, |t| {
                    now.duration_since(*t) >= std::time::Duration::from_millis(40)
                });
            if due {
                if transferred >= total {
                    m.remove(&transfer_id);
                } else {
                    m.insert(transfer_id.clone(), now);
                }
            }
            due
        };
        if should_emit {
            let _ = progress_handle.emit(
                "sftp:progress",
                SftpProgress {
                    transfer_id,
                    transferred,
                    total,
                },
            );
        }
    });

    // 세션 종료 알림 (#96) — pty와 같은 `session:closed` 이벤트를 공유한다.
    let closed_handle = app.clone();
    let closed: crate::pty::manager::ClosedSink = Arc::new(move |session_id| {
        let _ = closed_handle.emit(
            "session:closed",
            crate::pty::commands::SessionClosed { session_id },
        );
    });

    SshState {
        manager: Arc::new(SshManager::with_closed(
            sink,
            Arc::clone(&known_hosts),
            history,
            closed,
        )),
        sftp: Arc::new(SftpManager::new(Arc::clone(&known_hosts), progress)),
        tunnel: Arc::new(TunnelManager::new(Arc::clone(&known_hosts))),
        store: HostStore::new(hosts_path),
        groups: GroupStore::new(groups_path),
        tags: TagStore::new(tags_path),
        keys: KeyStore::new(keys_path),
        known_hosts,
        secrets: None,
        #[cfg(unix)]
        daemon: None,
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
    /// 재attach 힌트 (#160): 이전 실행의 세션 id. 세션 데몬에 아직 살아있으면 새로 접속하지
    /// 않고(인증·비밀번호 프롬프트 없이) 그 세션을 그대로 돌려준다.
    #[serde(default)]
    pub attach: Option<String>,
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

    // 재attach (#160): 데몬에 이 세션이 살아 있으면 인증 없이 그대로 붙는다 — 업데이트로 앱이
    // 재시작돼도 원격 셸이 끊기지 않은 경우다. 새 창 크기로 맞춰 준다.
    #[cfg(unix)]
    if let (Some(d), Some(id)) = (&state.daemon, &args.attach) {
        if let Ok(v) = d.call(crate::daemon::proto::Req::ListSessions).await {
            let alive = v
                .as_array()
                .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(id.as_str())));
            if alive {
                let _ = d
                    .call(crate::daemon::proto::Req::SshResize { session_id: id.clone(), cols, rows })
                    .await;
                return Ok(id.clone());
            }
        }
    }

    let auth = resolve_wire_auth(
        &host.auth,
        state.secrets.as_deref(),
        args.password.as_deref(),
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(SshConnectError::from)?;

    // ProxyJump(#61): proxy_jump가 지정되면 점프 호스트 + 그 인증을 해석해 JumpSpec 구성.
    // 점프 호스트는 ssh-agent/키체인 저장 인증만 지원(점프용 비밀번호 프롬프트는 후속).
    let jump = match &host.proxy_jump {
        Some(jid) if !jid.is_empty() => {
            let jhost = state
                .store
                .get(jid)
                .map_err(|e| SshConnectError::from_string(e.to_string()))?;
            let jauth = resolve_wire_auth(
                &jhost.auth,
                state.secrets.as_deref(),
                None,
                &jhost.host,
                jhost.port,
                &jhost.user,
            )
            .map_err(SshConnectError::from)?;
            Some(WireJump {
                host: jhost.host,
                port: jhost.port,
                user: jhost.user,
                auth: jauth,
            })
        }
        _ => None,
    };

    // 세션 데몬이 있으면 데몬이 연결을 소유한다(#160). 호스트 키 확인 같은 대화형 흐름은
    // 데몬이 구조화된 오류로 돌려주므로 프론트는 종전과 똑같이 모달 → 재시도한다.
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d
            .call(crate::daemon::proto::Req::SshConnect {
                host: host.host.clone(),
                port: host.port,
                user: host.user.clone(),
                auth,
                cols,
                rows,
                jump,
            })
            .await
            .map_err(SshConnectError::from_string)?;
        if let Some(id) = v.get("ok").and_then(|x| x.as_str()) {
            return Ok(id.to_string());
        }
        return Err(v
            .get("err")
            .cloned()
            .and_then(|e| serde_json::from_value(e).ok())
            .unwrap_or_else(|| SshConnectError::from_string(format!("daemon: {v}"))));
    }

    let auth = auth.into_resolved().map_err(SshConnectError::from)?;
    let jump = jump.map(WireJump::into_spec).transpose().map_err(SshConnectError::from)?;
    state
        .manager
        .connect(&host, auth, cols, rows, jump)
        .await
        .map_err(SshConnectError::from)
}

#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data_b64: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::SshWrite { session_id, data_b64 }).await?;
        return Ok(());
    }
    let bytes = B64.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    state
        .manager
        .write(&session_id, &bytes)
        .await
        .map_err(|e| e.to_string())
}

/// 원격 셸의 현재 작업 디렉터리(Linux 원격 전용). 드래그 업로드 위치 결정용 — 실패 시 null.
#[tauri::command]
pub async fn ssh_remote_cwd(
    session_id: String,
    state: State<'_, SshState>,
) -> Result<Option<String>, String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d
            .call(crate::daemon::proto::Req::SshRemoteCwd { session_id })
            .await
            .unwrap_or_default();
        return Ok(serde_json::from_value(v).unwrap_or(None));
    }
    Ok(state.manager.remote_cwd(&session_id).await)
}

/// 원격 tmux 세션 목록 (#89). tmux 미설치/서버 없음이면 null — UI가 "세션 없음"으로 안내.
#[tauri::command]
pub async fn ssh_tmux_sessions(
    session_id: String,
    state: State<'_, SshState>,
) -> Result<Option<Vec<super::types::TmuxSessionInfo>>, String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d
            .call(crate::daemon::proto::Req::SshTmuxSessions { session_id })
            .await
            .unwrap_or_default();
        return Ok(serde_json::from_value(v).unwrap_or(None));
    }
    Ok(state.manager.tmux_sessions(&session_id).await)
}

/// 원격 시스템 요약(OS/셸/유저/배포판) — AI 어시스턴트에 "어떤 시스템인지" 알려주는 컨텍스트용 (#103).
/// 별도 exec 채널이라 대화형 화면에 흔적 없음. 조회 실패/타임아웃이면 null.
#[tauri::command]
pub async fn ssh_probe_system(
    session_id: String,
    state: State<'_, SshState>,
) -> Result<Option<String>, String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d
            .call(crate::daemon::proto::Req::SshProbeSystem { session_id })
            .await
            .unwrap_or_default();
        return Ok(serde_json::from_value(v).unwrap_or(None));
    }
    Ok(state.manager.probe_system(&session_id).await)
}

#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, SshState>,
) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::SshResize { session_id, cols, rows }).await?;
        return Ok(());
    }
    state
        .manager
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_kill(session_id: String, state: State<'_, SshState>) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::SshKill { session_id }).await?;
        return Ok(());
    }
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
    resolve_wire_auth(method, secrets, prompted_password, host, port, user)?.into_resolved()
}

/// 인증 재료를 꺼낸다(#160): 시크릿 저장소 조회와 비밀번호 프롬프트 판정은 UI 프로세스가 한다.
/// 결과는 인프로세스 경로(`into_resolved`)와 세션 데몬 전송에 공통으로 쓴다.
fn resolve_wire_auth(
    method: &SshAuthMethod,
    secrets: Option<&dyn SecretStore>,
    prompted_password: Option<&str>,
    host: &str,
    port: u16,
    user: &str,
) -> Result<WireAuth, SshError> {
    let utf8 = |b: &[u8], what: &str| {
        std::str::from_utf8(b)
            .map(str::to_string)
            .map_err(|_| SshError::Auth(format!("{what} is not UTF-8")))
    };
    let required = || SshError::PasswordRequired {
        host: host.to_string(),
        port,
        user: user.to_string(),
    };
    match method {
        SshAuthMethod::Password { secret_id } => {
            // 저장된 비밀번호를 우선 사용. 없으면(예: secret 저장소 이전 후) 모달 입력으로 폴백.
            if let Some(store) = secrets {
                if let Ok(pw) = store.load(secret_id) {
                    return Ok(WireAuth::Password { password: utf8(pw.as_slice(), "password")? });
                }
            }
            let pw = prompted_password.ok_or_else(required)?;
            Ok(WireAuth::Password { password: pw.to_string() })
        }
        SshAuthMethod::PasswordPrompt => {
            let pw = prompted_password.ok_or_else(required)?;
            Ok(WireAuth::Password { password: pw.to_string() })
        }
        SshAuthMethod::PrivateKey {
            key_id,
            passphrase_secret_id,
        } => {
            let store = secrets.ok_or_else(|| SshError::Auth("secret store not unlocked".into()))?;
            let key_pem = store.load(key_id).map_err(|e| SshError::Auth(e.to_string()))?;
            let passphrase = match passphrase_secret_id {
                Some(pid) => Some(utf8(
                    store.load(pid).map_err(|e| SshError::Auth(e.to_string()))?.as_slice(),
                    "passphrase",
                )?),
                None => None,
            };
            Ok(WireAuth::PrivateKey {
                pem: utf8(key_pem.as_slice(), "private key")?,
                passphrase,
            })
        }
        SshAuthMethod::Agent => Ok(WireAuth::Agent),
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

/// 목적지 파일명으로 안전한지 검사한다. 경로 구분자나 `.`/`..`가 섞이면 대상 디렉토리 밖을
/// 가리킬 수 있어 거부한다(#136). 이름 충돌 시 사용자가 고른 새 이름도 같은 경로를 타므로
/// 원격이 준 basename과 동일하게 검사한다(#137).
fn validate_dest_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(format!("invalid destination name: {name:?}"));
    }
    Ok(())
}

/// 원격 파일을 로컬 디렉토리로 다운로드. 저장된 로컬 경로 반환.
/// `dest_name`이 있으면 그 이름으로 저장한다 — 이름 충돌 시 "새 이름으로 저장" 선택용(#137).
#[tauri::command]
pub async fn sftp_download(
    host_id: String,
    remote_path: String,
    local_dir: String,
    transfer_id: String,
    dest_name: Option<String>,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let name = dest_name.as_deref().unwrap_or_else(|| basename(&remote_path));
    validate_dest_name(name)?;
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
/// `dest_name`이 있으면 그 이름으로 올린다 — 이름 충돌 시 "새 이름으로 저장" 선택용(#137).
/// `no_clobber`면 같은 이름이 있을 때 덮어쓰지 않고 "이름 (1).확장자"로 올린다 — 충돌 창이
/// 없는 경로(터미널에 드롭)용(#165). 반환 경로로 실제 이름을 알 수 있다.
#[tauri::command]
pub async fn sftp_upload(
    host_id: String,
    local_path: String,
    remote_dir: String,
    transfer_id: String,
    dest_name: Option<String>,
    no_clobber: Option<bool>,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let name = match dest_name {
        Some(n) => n,
        None => std::path::Path::new(&local_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| "invalid local path".to_string())?,
    };
    validate_dest_name(&name)?;
    let remote_path = if no_clobber.unwrap_or(false) {
        state
            .sftp
            .free_path(&host_id, &remote_dir, &name)
            .await
            .map_err(|e| e.to_string())?
    } else {
        format!("{}/{}", remote_dir.trim_end_matches('/'), name)
    };
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

/// 빠른 편집용 읽기. 앞 256KB와 함께 저장해도 안전한지(편집 가능 여부·이유·줄끝)를 돌려준다(#165).
#[tauri::command]
pub async fn sftp_read_for_edit(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<TextRead, String> {
    let buf = state
        .sftp
        .read_prefix(&host_id, &path, textfile::EDIT_LIMIT as u64 + 1)
        .await
        .map_err(|e| e.to_string())?;
    Ok(textfile::classify(buf, textfile::EDIT_LIMIT))
}

/// 텍스트를 원격 파일에 저장한다 (빠른 편집). 기존 내용을 덮어쓴다.
#[tauri::command]
pub async fn sftp_write_text(
    host_id: String,
    path: String,
    content: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    state
        .sftp
        .write_text(&host_id, &path, &content)
        .await
        .map_err(|e| e.to_string())
}

/// 원격 파일을 base64로 읽는다 (이미지 미리보기용). 상한 8MB.
#[tauri::command]
pub async fn sftp_read_bytes(
    host_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<String, String> {
    state
        .sftp
        .read_bytes_base64(&host_id, &path, 8 * 1024 * 1024)
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
    // Windows canonicalize는 verbatim 접두사(\\?\)를 붙이는데, verbatim 경로는 `/` 구분자
    // 정규화를 하지 않아 프론트의 경로 조합과 만나면 os error 123(ERROR_INVALID_NAME)이
    // 난다(#94). 접두사를 벗겨 일반 경로(C:\... 또는 \\server\...)로 노출한다.
    let canon_str = {
        let raw = canon.to_string_lossy().to_string();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            raw
        }
    };
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
        cwd: canon_str,
        entries,
    })
}

/// 로컬 파일을 텍스트로 읽는다 (미리보기용, 상한 256KB).
#[tauri::command]
pub fn local_read_text(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(256 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// 로컬 파일 빠른 편집용 읽기 — `sftp_read_for_edit`와 같은 판정(#165).
#[tauri::command]
pub fn local_read_for_edit(path: String) -> Result<TextRead, String> {
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(textfile::EDIT_LIMIT as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(textfile::classify(buf, textfile::EDIT_LIMIT))
}

/// 로컬 파일에 텍스트를 쓴다 (설정 내보내기용). 경로는 저장 다이얼로그에서 받은 것.
#[tauri::command]
pub fn local_write_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// 로컬 파일을 대상 디렉터리로 복사한다 (터미널에 파일 드래그→현재 폴더에 넣기, 로컬 셸).
/// 복사된 파일의 전체 경로를 반환한다. 같은 이름이 있으면 덮어쓰지 않고 "이름 (1).확장자"로
/// 복사한다(#165). 존재 확인은 링크를 따라가지 않는다 — copy가 링크 너머에 쓰지 않게.
#[tauri::command]
pub fn local_copy_into(src_path: String, dest_dir: String) -> Result<String, String> {
    let src = std::path::Path::new(&src_path);
    let name = src
        .file_name()
        .ok_or_else(|| "invalid source path".to_string())?
        .to_string_lossy()
        .to_string();
    let dir = std::path::Path::new(&dest_dir);
    let mut dest = dir.join(&name);
    let mut n = 0;
    while std::fs::symlink_metadata(&dest).is_ok() {
        n += 1;
        if n > 999 {
            return Err(format!("no free name for {name:?} in {dest_dir}"));
        }
        dest = dir.join(textfile::numbered_name(&name, n));
    }
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// 포트 포워딩 시작 — 로컬(-L) (#60). 바인딩된 실제 포트를 담은 TunnelInfo 반환.
#[tauri::command]
pub async fn tunnel_start_local(
    host_id: String,
    local_host: Option<String>,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    password: Option<String>,
    state: State<'_, SshState>,
) -> Result<TunnelInfo, String> {
    let host = state.store.get(&host_id).map_err(|e| e.to_string())?;
    let auth = resolve_auth(
        &host.auth,
        state.secrets.as_deref(),
        password.as_deref(),
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    state
        .tunnel
        .start_local(
            id,
            host,
            auth,
            local_host.unwrap_or_else(|| "127.0.0.1".into()),
            local_port,
            remote_host,
            remote_port,
        )
        .await
        .map_err(|e| e.to_string())
}

/// 포트 포워딩 시작 — 다이내믹(-D SOCKS5) (#60).
#[tauri::command]
pub async fn tunnel_start_dynamic(
    host_id: String,
    local_host: Option<String>,
    local_port: u16,
    password: Option<String>,
    state: State<'_, SshState>,
) -> Result<TunnelInfo, String> {
    let host = state.store.get(&host_id).map_err(|e| e.to_string())?;
    let auth = resolve_auth(
        &host.auth,
        state.secrets.as_deref(),
        password.as_deref(),
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    state
        .tunnel
        .start_dynamic(
            id,
            host,
            auth,
            local_host.unwrap_or_else(|| "127.0.0.1".into()),
            local_port,
        )
        .await
        .map_err(|e| e.to_string())
}

/// 포트 포워딩 시작 — 원격(-R) (#74). 서버 bind_port → 클라이언트 local_host:local_port.
#[tauri::command]
pub async fn tunnel_start_remote(
    host_id: String,
    bind_host: Option<String>,
    bind_port: u16,
    local_host: String,
    local_port: u16,
    password: Option<String>,
    state: State<'_, SshState>,
) -> Result<TunnelInfo, String> {
    let host = state.store.get(&host_id).map_err(|e| e.to_string())?;
    let auth = resolve_auth(
        &host.auth,
        state.secrets.as_deref(),
        password.as_deref(),
        &host.host,
        host.port,
        &host.user,
    )
    .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    state
        .tunnel
        .start_remote(
            id,
            host,
            auth,
            bind_host.unwrap_or_else(|| "127.0.0.1".into()),
            bind_port,
            local_host,
            local_port,
        )
        .await
        .map_err(|e| e.to_string())
}

/// 포트 포워딩 중지.
#[tauri::command]
pub async fn tunnel_stop(id: String, state: State<'_, SshState>) -> Result<(), String> {
    state.tunnel.stop(&id).await.map_err(|e| e.to_string())
}

/// 활성 포트 포워딩 목록.
#[tauri::command]
pub async fn tunnel_list(state: State<'_, SshState>) -> Result<Vec<TunnelInfo>, String> {
    Ok(state.tunnel.list().await)
}

/// 세션 로그를 파일에 누적(append)한다 (#65). dir가 비면 ~/wowterminal-logs 사용.
/// 디렉터리를 만들고 `dir/name` 파일에 content를 이어 붙인 뒤, 실제 파일 경로를 돌려준다.
#[tauri::command]
pub fn session_log_append(dir: String, name: String, content: String) -> Result<String, String> {
    use std::io::Write;
    let base = if dir.trim().is_empty() {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| "홈 디렉토리를 찾을 수 없습니다".to_string())?;
        std::path::Path::new(&home).join("wowterminal-logs")
    } else {
        std::path::PathBuf::from(dir)
    };
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    // name에서 경로 구분자를 제거해 디렉터리 탈출 방지.
    let safe = name.replace(['/', '\\'], "_");
    let path = base.join(safe);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// 로컬 `~/.ssh/config` 내용을 읽는다 (SSH 호스트 임포트용). 파일이 없으면 빈 문자열.
#[tauri::command]
pub fn ssh_read_config() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "홈 디렉토리를 찾을 수 없습니다".to_string())?;
    let path = std::path::Path::new(&home).join(".ssh").join("config");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 로컬 파일을 base64로 읽는다 (이미지 미리보기용, 상한 8MB).
#[tauri::command]
pub fn local_read_bytes(path: String) -> Result<String, String> {
    use std::io::Read;
    let max: u64 = 8 * 1024 * 1024;
    let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(max + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > max {
        return Err(format!("file too large to preview (> {} bytes)", max));
    }
    Ok(B64.encode(&buf))
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

#[cfg(all(test, unix))]
mod tests {
    use super::local_copy_into;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("wt-copy-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::create_dir_all(d.join("dst")).unwrap();
        d
    }

    /// 같은 이름이 있으면 덮어쓰지 않고 "이름 (1)"로 복사한다(#165).
    #[test]
    fn copy_into_never_overwrites() {
        let d = scratch("clobber");
        std::fs::write(d.join("src/a.txt"), "new").unwrap();
        std::fs::write(d.join("dst/a.txt"), "old").unwrap();
        let out = local_copy_into(
            d.join("src/a.txt").to_string_lossy().into(),
            d.join("dst").to_string_lossy().into(),
        )
        .unwrap();
        assert!(out.ends_with("a (1).txt"), "{out}");
        assert_eq!(std::fs::read_to_string(d.join("dst/a.txt")).unwrap(), "old");
        assert_eq!(
            std::fs::read_to_string(d.join("dst/a (1).txt")).unwrap(),
            "new"
        );
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 대상 이름이 끊긴 심볼릭 링크여도 링크 너머(target)에 쓰지 않는다(#165).
    #[test]
    fn copy_into_does_not_write_through_dangling_symlink() {
        let d = scratch("symlink");
        std::fs::write(d.join("src/b.txt"), "data").unwrap();
        let target = d.join("outside.txt");
        std::os::unix::fs::symlink(&target, d.join("dst/b.txt")).unwrap();
        let out = local_copy_into(
            d.join("src/b.txt").to_string_lossy().into(),
            d.join("dst").to_string_lossy().into(),
        )
        .unwrap();
        assert!(out.ends_with("b (1).txt"), "{out}");
        assert!(!target.exists(), "must not create the symlink target");
        let _ = std::fs::remove_dir_all(&d);
    }
}
