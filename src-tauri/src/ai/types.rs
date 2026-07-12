//! AI 백엔드에서 공통으로 사용하는 데이터 타입.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    /// 요청 단위 사고력 강도 오버라이드(#129). None이면 백엔드 등록값을 쓴다.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

#[derive(Debug, Error)]
pub enum AiError {
    #[error("network error: {0}")]
    Network(String),

    #[error("authentication failed")]
    Auth,

    #[error("rate limited")]
    RateLimited,

    #[error("invalid response: {0}")]
    InvalidResponse(String),

    #[error("backend error: {0}")]
    Backend(String),
}
