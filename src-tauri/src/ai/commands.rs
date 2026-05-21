//! AI 관련 Tauri command.

use tauri::State;

use crate::ai::registry::AiRegistry;
use crate::ai::types::{ChatRequest, ChatResponse};

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
