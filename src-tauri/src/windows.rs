//! 멀티 윈도우 — 탭 분리(S-008/009)에 쓰이는 detached webview window 관리.
//!
//! 흐름:
//! 1. 프론트가 `open_detached_window(source, label_hint)`을 호출 → 백엔드가 새 윈도우 라벨을
//!    생성하고 source를 [`DetachedRegistry`]에 보관 → `WebviewWindowBuilder`로 빈 윈도우 생성.
//! 2. 새 윈도우의 React 앱이 mount 시 `detached_init()`를 호출 → registry에서 source를 꺼내
//!    반환하고 항목 제거. 새 윈도우는 그 source로 초기 탭을 구성.
//!
//! v1 한계: 기존 PTY/SSH 세션을 새 윈도우로 *인계하지 않음*. 새 윈도우는 받은 source로
//! 새 세션을 spawn한다. 와이어프레임의 "세션 유지" 시나리오는 후속에서 다룬다.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DetachedSource {
    Local,
    Ssh {
        #[serde(rename = "hostId")]
        host_id: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedInit {
    pub source: DetachedSource,
    pub label: String,
    /// 세션 인계용. Some이면 새 윈도우가 이 기존 sessionId에 attach (새 spawn 대신).
    pub session_id: Option<String>,
    /// 분리 직전 원본 화면 스냅샷(ANSI). 새 윈도우가 attach 시 복원해 이전 화면을 보존.
    pub screen: Option<String>,
    /// 인계할 AI 대화 세션 id. 새 윈도우 AIPanel이 localStorage에서 복원.
    pub ai_session_id: Option<String>,
}

#[derive(Default)]
pub struct DetachedRegistry {
    entries: Mutex<HashMap<String, DetachedInit>>,
}

#[tauri::command]
pub async fn open_detached_window(
    app: AppHandle,
    registry: State<'_, DetachedRegistry>,
    ssh_state: State<'_, crate::ssh::commands::SshState>,
    pty_state: State<'_, crate::pty::commands::PtyState>,
    source: DetachedSource,
    label_hint: String,
    session_id: Option<String>,
    screen: Option<String>,
    ai_session_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    // window label은 capability matcher와 맞춰 `detached-*` 패턴 유지.
    let window_label = format!("detached-{}", &id[..8]);

    // 세션 인계: 백엔드 매니저에 보호 등록 → 원본 창의 cleanup kill이 이 세션을 죽이지 않음.
    if let Some(sid) = &session_id {
        match &source {
            DetachedSource::Ssh { .. } => ssh_state.manager.mark_detached(sid).await,
            DetachedSource::Local => pty_state.0.mark_detached(sid),
        }
    }

    registry
        .entries
        .lock()
        .map_err(|_| "detached registry poisoned".to_string())?
        .insert(
            window_label.clone(),
            DetachedInit {
                source,
                label: label_hint.clone(),
                session_id,
                screen,
                ai_session_id,
            },
        );

    let mut builder = WebviewWindowBuilder::new(
        &app,
        window_label.clone(),
        WebviewUrl::App("index.html".into()),
    )
    .title(format!("wowTerminal — {label_hint}"))
    .inner_size(900.0, 650.0);
    // 드롭 위치가 주어지면 그 자리에 새 창을 띄운다 (탭을 창 밖으로 끌어다 놓은 지점).
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }
    builder
        .build()
    .map_err(|e| {
        // 윈도우 생성 실패 시 registry 항목 정리.
        if let Ok(mut g) = registry.entries.lock() {
            g.remove(&window_label);
        }
        e.to_string()
    })?;

    Ok(window_label)
}

/// 세션을 인계 보호 등록한다 (재결합용). 분리 창이 닫히며 일어나는 cleanup kill을
/// 백엔드가 1회 무시해 세션을 살려두고, 다른 창이 attach할 수 있게 한다.
/// open_detached_window와 동일한 detach_guard 메커니즘.
#[tauri::command]
pub async fn mark_session_detached(
    session_id: String,
    kind: String,
    ssh_state: State<'_, crate::ssh::commands::SshState>,
    pty_state: State<'_, crate::pty::commands::PtyState>,
) -> Result<(), String> {
    if kind == "ssh" {
        ssh_state.manager.mark_detached(&session_id).await;
    } else {
        pty_state.0.mark_detached(&session_id);
    }
    Ok(())
}

#[tauri::command]
pub fn detached_init(
    window: tauri::WebviewWindow,
    registry: State<'_, DetachedRegistry>,
) -> Result<Option<DetachedInit>, String> {
    let label = window.label().to_string();
    let mut g = registry
        .entries
        .lock()
        .map_err(|_| "detached registry poisoned".to_string())?;
    let entry = g.remove(&label);
    Ok(entry)
}
