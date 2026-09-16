//! PTY 관련 Tauri command.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::{DataSink, HistoryStore, PtyDims, PtyManager, SessionId};

/// Tauri state에 보관되는 세션 백엔드 (#153).
///
/// `daemon`이 있으면 모든 PTY 조작을 **세션 데몬**에 위임한다 — 데몬이 PTY master fd를
/// 들고 있어야 앱이 업데이트로 `relaunch()`될 때 셸(Claude Code/Gemini 등)이 죽지 않는다.
/// 데몬 연결/스폰에 실패하면 `None`이 되어 기존 인프로세스 매니저로 동작한다(무회귀 폴백).
pub struct PtyState {
    pub manager: Arc<PtyManager>,
    #[cfg(unix)]
    pub daemon: Option<Arc<crate::daemon::client::DaemonClient>>,
}

/// 세션 데몬에 연결한다(없으면 detached로 스폰). 데몬이 푸시하는 이벤트를 받아
/// **기존과 동일한 이름의 Tauri 이벤트**로 다시 emit하므로 프론트 계약은 바뀌지 않는다.
#[cfg(unix)]
pub fn connect_daemon(
    app: &AppHandle,
    config_dir: &std::path::Path,
) -> Option<Arc<crate::daemon::client::DaemonClient>> {
    use crate::daemon::client::{socket_path, DaemonClient, EventSink};
    use crate::daemon::proto::Event;

    let _ = std::fs::create_dir_all(config_dir);
    let exe = std::env::current_exe().ok()?;
    let socket = socket_path(config_dir);

    let handle = app.clone();
    let sink: EventSink = Arc::new(move |ev| match ev {
        Event::PtyOutput { session_id, data_b64 } => {
            let _ = handle.emit("pty:output", PtyOutput { session_id, data_b64 });
        }
        Event::SessionClosed { session_id } => {
            let _ = handle.emit("session:closed", SessionClosed { session_id });
        }
    });

    let client = tauri::async_runtime::block_on(DaemonClient::connect_or_spawn(
        &exe, &socket, sink,
    ))?;
    match tauri::async_runtime::block_on(client.hello()) {
        Ok(info) => eprintln!("[daemon] connected: {info}"),
        Err(e) => {
            eprintln!("[daemon] handshake failed: {e} — falling back to in-process sessions");
            return None;
        }
    }
    Some(Arc::new(client))
}

/// 세션 출력 ring buffer 핸들 (pty/ssh 공유). 세션 인계 시 스크롤백 복원용.
pub struct HistoryState(pub Arc<HistoryStore>);

/// 세션의 누적 출력(스크롤백)을 base64로 반환. 분리된 새 창이 attach 시 재생한다.
/// pty/ssh 세션 id는 모두 고유 UUID라 단일 store로 처리.
#[tauri::command]
pub async fn session_history(
    session_id: String,
    history: State<'_, HistoryState>,
    pty: State<'_, PtyState>,
) -> Result<String, ()> {
    // 데몬 모드에선 스크롤백도 데몬이 들고 있다 — 재attach 시 거기서 받아 재생한다.
    // 실패하면 빈 문자열(프론트는 화면 스냅샷으로 폴백).
    #[cfg(unix)]
    if let Some(d) = &pty.daemon {
        let v = d
            .call(crate::daemon::proto::Req::SessionHistory { session_id })
            .await
            .unwrap_or_default();
        return Ok(v.as_str().unwrap_or_default().to_string());
    }
    let _ = &pty;
    Ok(B64.encode(history.0.get(&session_id)))
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
    // 세션 종료 알림 (#96) — 프론트 Terminal이 듣고 "끊김/재접속" UI를 띄운다.
    let closed_handle = app.clone();
    let closed: crate::pty::manager::ClosedSink = Arc::new(move |session_id| {
        let _ = closed_handle.emit("session:closed", SessionClosed { session_id });
    });
    Arc::new(PtyManager::with_closed(sink, history, closed))
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    session_id: SessionId,
    /// PTY 바이트는 base64로 보낸다 (JSON에 비-UTF8 바이트 안전 운반).
    data_b64: String,
}

/// `session:closed` 이벤트 payload (#96). pty/ssh 공용 — 세션 ID는 전역 고유.
#[derive(Clone, Serialize)]
pub struct SessionClosed {
    pub session_id: SessionId,
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub program: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    /// 시작 디렉터리 (#90 세션 복원). 존재하지 않으면 무시하고 기본(홈)에서 시작.
    pub cwd: Option<String>,
    /// 재attach 힌트 (#153). 복원 스냅샷이 기억한 세션 id — 데몬에 아직 살아있으면
    /// 새로 스폰하지 않고 그 세션에 다시 붙는다(프론트는 반환된 id가 힌트와 같으면
    /// "재attach됨"으로 보고 스크롤백을 재생한다).
    #[serde(default)]
    pub attach: Option<String>,
}

#[tauri::command]
pub async fn pty_spawn(args: SpawnArgs, state: State<'_, PtyState>) -> Result<SessionId, String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d
            .call(crate::daemon::proto::Req::PtySpawn {
                program: args.program.clone(),
                cols: args.cols,
                rows: args.rows,
                cwd: args.cwd.clone(),
                attach: args.attach.clone(),
            })
            .await?;
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    let dims = PtyDims {
        cols: args.cols.unwrap_or(80),
        rows: args.rows.unwrap_or(24),
    };
    state
        .manager
        .spawn(args.program.as_deref(), dims, args.cwd.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data_b64: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::PtyWrite { session_id, data_b64 })
            .await?;
        return Ok(());
    }
    let bytes = B64.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    state
        .manager
        .write(&session_id, &bytes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::PtyResize { session_id, cols, rows })
            .await?;
        return Ok(());
    }
    state
        .manager
        .resize(&session_id, PtyDims { cols, rows })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_kill(session_id: String, state: State<'_, PtyState>) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        d.call(crate::daemon::proto::Req::PtyKill { session_id }).await?;
        return Ok(());
    }
    state.manager.kill(&session_id).map_err(|e| e.to_string())
}

/// 데몬에 살아있는 세션 id 목록 (#153). UI가 재시작 후 복원 스냅샷과 대조해
/// **재attach할 세션**을 고른다. 데몬이 없으면 빈 목록(= 전부 새로 스폰).
#[tauri::command]
pub async fn daemon_live_sessions(state: State<'_, PtyState>) -> Result<Vec<String>, String> {
    #[cfg(unix)]
    if let Some(d) = &state.daemon {
        let v = d.call(crate::daemon::proto::Req::ListSessions).await?;
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    let _ = &state;
    Ok(Vec::new())
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

/// 로컬 머신 시스템 요약(OS/arch/셸/유저) — AI 어시스턴트 컨텍스트용 (#103).
/// 앱과 같은 머신이라 서브프로세스 없이 std로 충분하다(unix는 uname으로 커널 버전까지 보강).
#[tauri::command]
pub async fn local_system_info() -> Option<String> {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "?".into());

    #[cfg(target_family = "unix")]
    {
        // uname -srm 으로 OS/커널/머신을 받아오고(없으면 OS 상수로 폴백), 셸을 덧붙인다.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "?".into());
        let uname = tokio::process::Command::new("uname")
            .arg("-srm")
            .output()
            .await
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| std::env::consts::OS.to_string());
        Some(format!("{uname} shell={shell} user={user}"))
    }
    #[cfg(target_family = "windows")]
    {
        let arch = std::env::consts::ARCH;
        let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        Some(format!("Windows {arch} shell={shell} user={user}"))
    }
}
