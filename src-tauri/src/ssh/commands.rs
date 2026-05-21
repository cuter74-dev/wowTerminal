//! SSH 관련 Tauri command.

use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::DataSink;
use crate::secrets::{EncryptedFileStore, SecretStore};

use super::manager::SshManager;
use super::session::{ResolvedAuth, SessionId};
use super::store::HostStore;
use super::types::{SshAuthMethod, SshHost};

pub struct SshState {
    pub manager: Arc<SshManager>,
    pub store: HostStore,
    /// 시크릿 저장소 핸들. 앱 시작 시 사용자 패스프레이즈로 열린 핸들이 들어간다.
    /// v1에서는 일단 옵션으로 두고, 없으면 password/key auth는 사용 불가.
    pub secrets: Option<Arc<dyn SecretStore>>,
}

pub fn build_state(app: &AppHandle, hosts_path: PathBuf) -> SshState {
    let handle = app.clone();
    let sink: DataSink = Arc::new(move |session_id, data| {
        let payload = SshOutput {
            session_id,
            data_b64: B64.encode(&data),
        };
        let _ = handle.emit("ssh:output", payload);
    });

    SshState {
        manager: Arc::new(SshManager::new(sink)),
        store: HostStore::new(hosts_path),
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

// 컴파일러가 미사용 import로 경고하지 않도록 명시적으로 참조.
#[allow(dead_code)]
fn _ensure_imports_used() {
    let _ = std::any::TypeId::of::<EncryptedFileStore>();
}
