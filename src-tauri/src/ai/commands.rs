//! AI 관련 Tauri command.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::ai::adapters::OpenAiCompatibleBackend;
use crate::ai::config::{BackendConfig, OpenAiCompatibleConfig};
use crate::ai::registry::AiRegistry;
use crate::ai::store::{config_id, config_secret_id, BackendsStore};
use crate::ai::types::{ChatRequest, ChatResponse};
use crate::secrets::{KeyringStore, SecretStore};

const KEYRING_SERVICE: &str = "wowterminal-ai";

/// 앱 상태 — backends.toml store + secret store. Registry는 별도 manage.
pub struct AiState {
    pub backends: BackendsStore,
    pub secrets: Arc<dyn SecretStore>,
}

pub fn build_state(backends_path: std::path::PathBuf) -> AiState {
    AiState {
        backends: BackendsStore::new(backends_path),
        secrets: Arc::new(KeyringStore::new(KEYRING_SERVICE)),
    }
}

/// 등록된 백엔드 ID만 반환 (간단 호환용).
#[tauri::command]
pub async fn ai_list_backends(registry: State<'_, AiRegistry>) -> Result<Vec<String>, String> {
    Ok(registry.list_ids().await)
}

#[tauri::command]
pub async fn ai_complete(
    backend_id: String,
    request: ChatRequest,
    registry: State<'_, AiRegistry>,
) -> Result<ChatResponse, String> {
    registry
        .complete(&backend_id, request)
        .await
        .map_err(|e| e.to_string())
}

/// 스트리밍 응답 이벤트 — 프론트는 Channel로 받는다.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Delta { delta: String },
    Done { content: String },
    Error { message: String },
}

#[tauri::command]
pub async fn ai_complete_stream(
    backend_id: String,
    request: ChatRequest,
    on_event: Channel<StreamEvent>,
    registry: State<'_, AiRegistry>,
) -> Result<(), String> {
    let sink = on_event.clone();
    let on_delta: crate::ai::DeltaSink = Box::new(move |delta| {
        let _ = sink.send(StreamEvent::Delta { delta });
    });
    match registry.complete_stream(&backend_id, request, on_delta).await {
        Ok(resp) => {
            let _ = on_event.send(StreamEvent::Done {
                content: resp.content,
            });
        }
        Err(e) => {
            let _ = on_event.send(StreamEvent::Error {
                message: e.to_string(),
            });
        }
    }
    Ok(())
}

/// UI에 노출되는 백엔드 정보. api_key 자체는 절대 반환 안 함.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    pub id: String,
    pub display_name: String,
    pub api_base: String,
    pub default_model: String,
    /// API 키가 keyring에 저장되어 있으면 true.
    pub has_api_key: bool,
}

#[tauri::command]
pub async fn ai_list_backend_configs(
    state: State<'_, AiState>,
) -> Result<Vec<BackendInfo>, String> {
    let list = state.backends.list().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(list.len());
    for c in list {
        match c {
            BackendConfig::OpenAiCompatible(o) => {
                let has = o
                    .api_key_secret_id
                    .as_deref()
                    .map(|sid| state.secrets.load(sid).is_ok())
                    .unwrap_or(false);
                out.push(BackendInfo {
                    id: o.id,
                    display_name: o.display_name,
                    api_base: o.api_base,
                    default_model: o.default_model,
                    has_api_key: has,
                });
            }
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ModelsResp {
    data: Vec<ModelEntry>,
}
#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

/// OpenAI 호환 `/models` 엔드포인트로 사용 가능한 모델 목록을 가져온다.
/// Ollama(`http://localhost:11434/v1`)의 `/v1/models`로 로컬 설치 모델을 나열하는 용도.
#[tauri::command]
pub async fn ai_list_models(
    api_base: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let base = api_base.trim().trim_end_matches('/');
    let url = if base.ends_with("/models") {
        base.to_string()
    } else {
        format!("{base}/models")
    };
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if let Some(k) = api_key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("요청 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let parsed: ModelsResp = resp.json().await.map_err(|e| format!("파싱 실패: {e}"))?;
    let mut models: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    models.sort();
    Ok(models)
}

/// 프론트가 보내는 백엔드 저장 payload. apiKey가 비어있지 않으면 keyring에 저장한다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackendArgs {
    pub id: String,
    pub display_name: String,
    pub api_base: String,
    pub default_model: String,
    /// 평문. 받자마자 keyring에 저장하고 메모리에서는 잊는다.
    /// None / 빈 문자열이면 keyring을 건드리지 않음 (기존 키 유지).
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn ai_save_backend(
    args: SaveBackendArgs,
    state: State<'_, AiState>,
    registry: State<'_, AiRegistry>,
) -> Result<(), String> {
    // api_key가 들어왔으면 keyring에 저장. secret_id = backend id 그대로.
    let trimmed = args.api_key.as_deref().map(|s| s.trim()).unwrap_or("");
    let has_new_key = !trimmed.is_empty();
    if has_new_key {
        state
            .secrets
            .save(&args.id, trimmed.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    // 기존 config을 찾아 secret_id 결정. 새로 들어왔으면 args.id, 아니면 기존 유지.
    let existing = state
        .backends
        .list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|b| config_id(b) == args.id);
    let secret_id = if has_new_key {
        Some(args.id.clone())
    } else {
        existing
            .as_ref()
            .and_then(|c| config_secret_id(c).map(|s| s.to_string()))
    };

    let config = BackendConfig::OpenAiCompatible(OpenAiCompatibleConfig {
        id: args.id.clone(),
        display_name: args.display_name,
        api_base: args.api_base,
        api_key_secret_id: secret_id.clone(),
        default_model: args.default_model,
    });
    state.backends.upsert(config.clone()).map_err(|e| e.to_string())?;

    // registry에도 즉시 반영.
    register_backend(&registry, &config, state.secrets.as_ref()).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_delete_backend(
    id: String,
    state: State<'_, AiState>,
    registry: State<'_, AiRegistry>,
) -> Result<(), String> {
    let removed = state.backends.delete(&id).map_err(|e| e.to_string())?;
    if let Some(cfg) = removed {
        if let Some(sid) = config_secret_id(&cfg) {
            // 키는 best-effort 삭제. NotFound는 무시.
            let _ = state.secrets.delete(sid);
        }
    }
    registry.unregister(&id).await;
    Ok(())
}

/// 앱 시작 시 backends.toml의 모든 백엔드를 registry에 등록.
pub async fn bootstrap_registry(state: &AiState, registry: &AiRegistry) {
    let list = match state.backends.list() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ai] failed to load backends.toml: {e}");
            return;
        }
    };
    for c in list {
        if let Err(e) = register_backend(registry, &c, state.secrets.as_ref()).await {
            eprintln!("[ai] register {} failed: {e}", config_id(&c));
        }
    }
}

async fn register_backend(
    registry: &AiRegistry,
    cfg: &BackendConfig,
    secrets: &dyn SecretStore,
) -> Result<(), String> {
    match cfg {
        BackendConfig::OpenAiCompatible(o) => {
            let api_key = if let Some(sid) = o.api_key_secret_id.as_deref() {
                match secrets.load(sid) {
                    Ok(bytes) => Some(
                        std::str::from_utf8(bytes.as_slice())
                            .map_err(|_| "api key not utf-8".to_string())?
                            .to_string(),
                    ),
                    Err(_) => None,
                }
            } else {
                None
            };
            let backend =
                Arc::new(OpenAiCompatibleBackend::new(&o.id, &o.api_base, api_key));
            registry.register(backend).await;
            Ok(())
        }
    }
}
