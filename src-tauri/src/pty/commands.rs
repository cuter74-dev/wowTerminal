//! PTY 관련 Tauri command.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::{DataSink, PtyDims, PtyManager, SessionId};

/// Tauri state에 보관되는 매니저 핸들.
pub struct PtyState(pub Arc<PtyManager>);

/// 앱 시작 시 한 번 호출해 이벤트 sink를 AppHandle에 묶는다.
pub fn build_manager(app: &AppHandle) -> Arc<PtyManager> {
    let handle = app.clone();
    let sink: DataSink = Arc::new(move |session_id, data| {
        let payload = PtyOutput {
            session_id,
            data_b64: B64.encode(&data),
        };
        let _ = handle.emit("pty:output", payload);
    });
    Arc::new(PtyManager::new(sink))
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    session_id: SessionId,
    /// PTY 바이트는 base64로 보낸다 (JSON에 비-UTF8 바이트 안전 운반).
    data_b64: String,
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub program: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub fn pty_spawn(args: SpawnArgs, state: State<'_, PtyState>) -> Result<SessionId, String> {
    let dims = PtyDims {
        cols: args.cols.unwrap_or(80),
        rows: args.rows.unwrap_or(24),
    };
    state
        .0
        .spawn(args.program.as_deref(), dims)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(
    session_id: String,
    data_b64: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let bytes = B64.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    state.0.write(&session_id, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    state
        .0
        .resize(&session_id, PtyDims { cols, rows })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(session_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    state.0.kill(&session_id).map_err(|e| e.to_string())
}

