//! AI 백엔드 추상 계층.
//!
//! 세 가지 백엔드 종류를 통일된 [`AiBackend`] 트레잇으로 다룬다:
//! - **External**: OpenAI, Anthropic, Google Gemini 등 클라우드 API
//! - **Local**: Ollama, llama.cpp 등 로컬 추론 엔진
//! - **SelfHosted**: 사용자가 직접 운영하는 OpenAI 호환 엔드포인트 (vLLM, TGI 등)
//!
//! 자세한 설계는 `docs/design/ai-backend.md` 참고.

pub mod adapters;
pub mod commands;
pub mod config;
pub mod registry;
pub mod store;
pub mod types;

pub use registry::AiRegistry;
pub use types::*;

use async_trait::async_trait;

/// 모든 AI 백엔드가 구현해야 하는 공통 인터페이스.
#[async_trait]
pub trait AiBackend: Send + Sync {
    /// 백엔드의 사람 친화적 식별자 (e.g. "openai", "ollama-local").
    fn id(&self) -> &str;

    /// 비-스트리밍 텍스트 완성.
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, AiError>;

    // TODO: 스트리밍 응답을 위한 `complete_stream` 추가.
    // TODO: 모델 목록 조회 `list_models` 추가.
}
