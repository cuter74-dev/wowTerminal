//! PTY 관련 Tauri command.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::{DataSink, HistoryStore, PtyDims, PtyManager, SessionId};

/// Tauri state에 보관되는 매니저 핸들.
pub struct PtyState(pub Arc<PtyManager>);

/// 세션 출력 ring buffer 핸들 (pty/ssh 공유). 세션 인계 시 스크롤백 복원용.
pub struct HistoryState(pub Arc<HistoryStore>);

/// 세션의 누적 출력(스크롤백)을 base64로 반환. 분리된 새 창이 attach 시 재생한다.
/// pty/ssh 세션 id는 모두 고유 UUID라 단일 store로 처리.
#[tauri::command]
pub fn session_history(session_id: String, history: State<'_, HistoryState>) -> String {
    B64.encode(history.0.get(&session_id))
}

/// 앱 시작 시 한 번 호출해 이벤트 sink를 AppHandle에 묶는다.
pub fn build_manager(
    app: &AppHandle,
    history: Arc<crate::pty::manager::HistoryStore>,
) -> Arc<PtyManager> {
    let handle = app.clone();
    let hist = Arc::clone(&history);
    let sink: DataSink = Arc::new(move |session_id, data| {
        // 출력 ring buffer에 누적(세션 인계 시 스크롤백 복원용) 후 프론트로 emit.
        hist.append(&session_id, &data);
        let payload = PtyOutput {
            session_id,
            data_b64: B64.encode(&data),
        };
        let _ = handle.emit("pty:output", payload);
    });
    Arc::new(PtyManager::with_history(sink, history))
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



/// 로컬 머신의 tmux 세션 목록 (#89). 로그인 셸을 거쳐 실행해 Homebrew 등 PATH를 잡는다.
/// tmux 미설치/서버 없음이면 None. Windows에는 tmux가 없으므로 항상 None.
#[tauri::command]
pub async fn local_tmux_sessions() -> Option<Vec<crate::ssh::types::TmuxSessionInfo>> {
    #[cfg(target_family = "unix")]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let out = tokio::process::Command::new(shell)
            .arg("-lc")
            .arg("tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}' 2>/dev/null")
            .output()
            .await
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let list = crate::ssh::types::TmuxSessionInfo::parse_lines(&text);
        if list.is_empty() {
            None
        } else {
            Some(list)
        }
    }
    #[cfg(target_family = "windows")]
    {
        None
    }
}
