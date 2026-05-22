//! SSH 관련 Tauri command.

use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::DataSink;
use crate::secrets::{EncryptedFileStore, SecretStore};

use super::known_hosts::{KnownHostEntry, KnownHostsStore};
use super::manager::SshManager;
use super::session::{ResolvedAuth, SessionId};
use super::store::HostStore;
use super::types::{SshAuthMethod, SshHost};

pub struct SshState {
    pub manager: Arc<SshManager>,
    pub store: HostStore,
    pub known_hosts: Arc<KnownHostsStore>,
    /// 시크릿 저장소 핸들. 앱 시작 시 사용자 패스프레이즈로 열린 핸들이 들어간다.
    /// v1에서는 일단 옵션으로 두고, 없으면 password/key auth는 사용 불가.
    pub secrets: Option<Arc<dyn SecretStore>>,
}

pub fn build_state(
    app: &AppHandle,
    hosts_path: PathBuf,
    known_hosts_path: PathBuf,
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

    SshState {
        manager: Arc::new(SshManager::new(sink, Arc::clone(&known_hosts))),
        store: HostStore::new(hosts_path),
        known_hosts,
        secrets: None,
    }
}

#[derive(Clone, Serialize)]
struct SshOutput {
    session_id: SessionId,
    data_b64: String,
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
pub struct SshConnectArgs {
    pub host_id: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub async fn ssh_connect(
    args: SshConnectArgs,
    state: State<'_, SshState>,
) -> Result<SessionId, String> {
    let host = state.store.get(&args.host_id).map_err(|e| e.to_string())?;
    let cols = args.cols.unwrap_or(80);
    let rows = args.rows.unwrap_or(24);

    let auth = resolve_auth(&host.auth, state.secrets.as_deref())
        .map_err(|e| e.to_string())?;

    state
        .manager
        .connect(&host, auth, cols, rows)
        .await
        .map_err(|e| e.to_string())
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
) -> Result<ResolvedAuth, String> {
    match method {
        SshAuthMethod::Password { secret_id } => {
            let store = secrets.ok_or_else(|| "secret store not unlocked".to_string())?;
            let pw = store.load(secret_id).map_err(|e| e.to_string())?;
            ResolvedAuth::from_method(method, Some(pw.as_slice()), None, None).map_err(|e| e.to_string())
        }
        SshAuthMethod::PrivateKey {
            key_id,
            passphrase_secret_id,
        } => {
            let store = secrets.ok_or_else(|| "secret store not unlocked".to_string())?;
            let key_pem = store.load(key_id).map_err(|e| e.to_string())?;
            let passphrase = if let Some(pid) = passphrase_secret_id {
                Some(store.load(pid).map_err(|e| e.to_string())?)
            } else {
                None
            };
            ResolvedAuth::from_method(
                method,
                None,
                Some(key_pem.as_slice()),
                passphrase.as_ref().map(|p| p.as_slice()),
            )
            .map_err(|e| e.to_string())
        }
        SshAuthMethod::Agent => ResolvedAuth::from_method(method, None, None, None).map_err(|e| e.to_string()),
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
