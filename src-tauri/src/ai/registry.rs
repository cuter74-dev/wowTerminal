//! 등록된 AI 백엔드 관리.
//!
//! 프론트엔드는 string id로만 백엔드를 지정한다. registry가 id → 구현체 매핑을 갖고,
//! 호출 시 trait 메서드를 dispatch.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::ai::types::{AiError, ChatRequest, ChatResponse};
use crate::ai::AiBackend;

#[derive(Default, Clone)]
pub struct AiRegistry {
    inner: Arc<RwLock<HashMap<String, Arc<dyn AiBackend>>>>,
}

impl AiRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, backend: Arc<dyn AiBackend>) {
        let id = backend.id().to_string();
        self.inner.write().await.insert(id, backend);
    }

    pub async fn unregister(&self, id: &str) -> bool {
        self.inner.write().await.remove(id).is_some()
    }

    pub async fn list_ids(&self) -> Vec<String> {
        self.inner.read().await.keys().cloned().collect()
    }

    pub async fn complete(&self, backend_id: &str, req: ChatRequest) -> Result<ChatResponse, AiError> {
        let backend = {
            let guard = self.inner.read().await;
            guard
                .get(backend_id)
                .cloned()
                .ok_or_else(|| AiError::Backend(format!("unknown backend: {backend_id}")))?
        };
        backend.complete(req).await
    }

    pub async fn complete_stream(
        &self,
        backend_id: &str,
        req: ChatRequest,
        on_delta: crate::ai::DeltaSink,
    ) -> Result<ChatResponse, AiError> {
        let backend = {
            let guard = self.inner.read().await;
            guard
                .get(backend_id)
                .cloned()
                .ok_or_else(|| AiError::Backend(format!("unknown backend: {backend_id}")))?
        };
        backend.complete_stream(req, on_delta).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::adapters::OpenAiCompatibleBackend;
    use crate::ai::types::{Message, Role};
    use async_trait::async_trait;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct DummyBackend(&'static str);

    #[async_trait]
    impl AiBackend for DummyBackend {
        fn id(&self) -> &str {
            self.0
        }

        async fn complete(&self, _req: ChatRequest) -> Result<ChatResponse, AiError> {
            Ok(ChatResponse {
                content: format!("dummy {}", self.0),
                model: "dummy".into(),
                usage: None,
            })
        }
    }

    #[tokio::test]
    async fn register_and_dispatch() {
        let reg = AiRegistry::new();
        reg.register(Arc::new(DummyBackend("alpha"))).await;
        reg.register(Arc::new(DummyBackend("beta"))).await;

        let mut ids = reg.list_ids().await;
        ids.sort();
        assert_eq!(ids, vec!["alpha".to_string(), "beta".to_string()]);

        let req = ChatRequest {
            model: "x".into(),
            messages: vec![Message {
                role: Role::User,
                content: "hi".into(),
            }],
            temperature: None,
            max_tokens: None,
            reasoning_effort: None,
        };
        let resp = reg.complete("alpha", req).await.unwrap();
        assert_eq!(resp.content, "dummy alpha");
    }

    #[tokio::test]
    async fn unknown_id_returns_backend_error() {
        let reg = AiRegistry::new();
        let req = ChatRequest {
            model: "x".into(),
            messages: vec![],
            temperature: None,
            max_tokens: None,
            reasoning_effort: None,
        };
        let err = reg.complete("nope", req).await.unwrap_err();
        match err {
            AiError::Backend(msg) => assert!(msg.contains("nope")),
            other => panic!("unexpected: {:?}", other),
        }
    }

    #[tokio::test]
    async fn integration_with_openai_compat_via_mock() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "model": "mock",
                "choices": [{"message": {"role": "assistant", "content": "registry works"}}]
            })))
            .mount(&server)
            .await;

        let backend = Arc::new(OpenAiCompatibleBackend::new("via-reg", server.uri(), None));
        let reg = AiRegistry::new();
        reg.register(backend).await;

        let req = ChatRequest {
            model: "mock".into(),
            messages: vec![Message {
                role: Role::User,
                content: "hi".into(),
            }],
            temperature: None,
            max_tokens: None,
            reasoning_effort: None,
        };
        let resp = reg.complete("via-reg", req).await.unwrap();
        assert_eq!(resp.content, "registry works");
    }
}
