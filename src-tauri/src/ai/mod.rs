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

/// 스트리밍 응답에서 토큰 delta를 받는 콜백. (dyn 호환을 위해 Box 콜백 사용)
pub type DeltaSink = Box<dyn Fn(String) + Send + Sync>;

/// 모든 AI 백엔드가 구현해야 하는 공통 인터페이스.
#[async_trait]
pub trait AiBackend: Send + Sync {
    /// 백엔드의 사람 친화적 식별자 (e.g. "openai", "ollama-local").
    fn id(&self) -> &str;

    /// 비-스트리밍 텍스트 완성.
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, AiError>;

    /// 스트리밍 텍스트 완성 — delta를 받을 때마다 `on_delta`를 호출하고,
    /// 완료 시 누적된 전체 응답을 반환한다.
    /// 기본 구현은 스트리밍을 지원하지 않는 백엔드용 폴백(완성본을 한 번에 전달).
    async fn complete_stream(
        &self,
        req: ChatRequest,
        on_delta: DeltaSink,
    ) -> Result<ChatResponse, AiError> {
        let resp = self.complete(req).await?;
        on_delta(resp.content.clone());
        Ok(resp)
    }

    // TODO: 모델 목록 조회 `list_models` 추가.
}
