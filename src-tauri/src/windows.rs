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
pub struct DetachedInit {
    pub source: DetachedSource,
    pub label: String,
}

#[derive(Default)]
pub struct DetachedRegistry {
    entries: Mutex<HashMap<String, DetachedInit>>,
}

#[tauri::command]
pub async fn open_detached_window(
    app: AppHandle,
    registry: State<'_, DetachedRegistry>,
    source: DetachedSource,
    label_hint: String,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    // window label은 capability matcher와 맞춰 `detached-*` 패턴 유지.
    let window_label = format!("detached-{}", &id[..8]);

    registry
        .entries
        .lock()
        .map_err(|_| "detached registry poisoned".to_string())?
        .insert(
            window_label.clone(),
            DetachedInit {
                source,
                label: label_hint.clone(),
            },
        );

    WebviewWindowBuilder::new(
        &app,
        window_label.clone(),
        WebviewUrl::App("index.html".into()),
    )
    .title(format!("wowTerminal — {label_hint}"))
    .inner_size(900.0, 650.0)
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
    Ok(g.remove(&label))
}
