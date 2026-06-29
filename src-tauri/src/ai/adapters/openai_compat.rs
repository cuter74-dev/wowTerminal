//! OpenAI 호환 백엔드 어댑터.
//!
//! `/chat/completions` 엔드포인트를 따르는 모든 서버를 단일 구현체로 다룬다:
//! - OpenAI 본가 (`https://api.openai.com/v1`)
//! - 자체 호스팅 vLLM / TGI / Together AI 등
//! - Ollama의 OpenAI 엔드포인트 (`http://localhost:11434/v1`)

use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

use crate::ai::types::{AiError, ChatRequest, ChatResponse, Message, Role, TokenUsage};
use crate::ai::{AiBackend, DeltaSink};

pub struct OpenAiCompatibleBackend {
    id: String,
    api_base: String,
    api_key: Option<String>,
    /// 추론 모델용 사고력 강도(low/medium/high). None이면 요청에 안 보낸다(#123).
    reasoning_effort: Option<String>,
    http: Client,
}

impl OpenAiCompatibleBackend {
    pub fn new(id: impl Into<String>, api_base: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            id: id.into(),
            // 앞뒤 공백 + 끝 슬래시 제거 (사용자 입력에 trailing space가 흔함).
            api_base: api_base.into().trim().trim_end_matches('/').to_string(),
            api_key,
            reasoning_effort: None,
            http: Client::new(),
        }
    }

    /// 테스트 등에서 base URL을 동적으로 바꿔야 할 때 사용.
    pub fn with_client(mut self, client: Client) -> Self {
        self.http = client;
        self
    }

    /// 추론 모델용 사고력 강도 설정. 빈 문자열/None이면 미설정으로 둔다.
    pub fn with_reasoning_effort(mut self, effort: Option<String>) -> Self {
        self.reasoning_effort = effort.filter(|s| !s.trim().is_empty());
        self
    }

    fn chat_url(&self) -> String {
        // 사용자가 api_base에 `/chat/completions`까지 넣어둔 경우 중복 부착 방지.
        if self.api_base.ends_with("/chat/completions") {
            self.api_base.clone()
        } else {
            format!("{}/chat/completions", self.api_base)
        }
    }
}

#[async_trait]
impl AiBackend for OpenAiCompatibleBackend {
    fn id(&self) -> &str {
        &self.id
    }

    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, AiError> {
        let mut body = OpenAiChatRequest::from(&req);
        // 백엔드에 설정된 사고력 강도를 요청에 주입(#123). 추론 모델만 이 필드를 받는다.
        body.reasoning_effort = self.reasoning_effort.as_deref();

        let mut builder = self.http.post(self.chat_url()).json(&body);
        if let Some(key) = &self.api_key {
            builder = builder.bearer_auth(key);
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| AiError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(map_http_error(status, text));
        }

        let parsed: OpenAiChatResponse = resp
            .json()
            .await
            .map_err(|e| AiError::InvalidResponse(e.to_string()))?;

        let choice = parsed
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AiError::InvalidResponse("no choices in response".into()))?;

        Ok(ChatResponse {
            content: choice.message.content,
            model: parsed.model,
            usage: parsed.usage.map(|u| TokenUsage {
                prompt_tokens: u.prompt_tokens,
                completion_tokens: u.completion_tokens,
            }),
        })
    }

    async fn complete_stream(
        &self,
        req: ChatRequest,
        on_delta: DeltaSink,
    ) -> Result<ChatResponse, AiError> {
        use futures_util::StreamExt;

        let model = req.model.clone();
        let mut body = OpenAiChatRequest::from(&req);
        body.stream = Some(true);

        let mut builder = self.http.post(self.chat_url()).json(&body);
        if let Some(key) = &self.api_key {
            builder = builder.bearer_auth(key);
        }
        let resp = builder
            .send()
            .await
            .map_err(|e| AiError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(map_http_error(status, text));
        }

        // SSE: "data: {json}\n\n" 청크. 라인 단위로 모아 delta.content를 누적.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut full = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| AiError::Network(e.to_string()))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            loop {
                let Some(nl) = buf.find('\n') else { break };
                let line: String = buf.drain(..=nl).collect();
                let line = line.trim();
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(ev) = serde_json::from_str::<OpenAiStreamChunk>(data) {
                    if let Some(choice) = ev.choices.into_iter().next() {
                        if let Some(content) = choice.delta.content {
                            if !content.is_empty() {
                                full.push_str(&content);
                                on_delta(content);
                            }
                        }
                    }
                }
            }
        }

        Ok(ChatResponse {
            content: full,
            model,
            usage: None,
        })
    }
}

fn map_http_error(status: StatusCode, body: String) -> AiError {
    match status.as_u16() {
        401 | 403 => AiError::Auth,
        429 => AiError::RateLimited,
        s if s >= 500 => AiError::Backend(format!("server {}: {}", s, body)),
        s => AiError::Backend(format!("http {}: {}", s, body)),
    }
}

// ---- OpenAI wire format ----

#[derive(Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

impl<'a> From<&'a ChatRequest> for OpenAiChatRequest<'a> {
    fn from(req: &'a ChatRequest) -> Self {
        Self {
            model: &req.model,
            messages: req.messages.iter().map(OpenAiMessage::from).collect(),
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            reasoning_effort: None,
            stream: None,
        }
    }
}

#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'static str,
    content: &'a str,
}

impl<'a> From<&'a Message> for OpenAiMessage<'a> {
    fn from(m: &'a Message) -> Self {
        Self {
            role: match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
            },
            content: &m.content,
        }
    }
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    model: String,
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

// ---- streaming (SSE) wire format ----

#[derive(Deserialize)]
struct OpenAiStreamChunk {
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiDelta,
}

#[derive(Deserialize)]
struct OpenAiDelta {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample_request() -> ChatRequest {
        ChatRequest {
            model: "gpt-4o-mini".into(),
            messages: vec![
                Message {
                    role: Role::System,
                    content: "you are helpful".into(),
                },
                Message {
                    role: Role::User,
                    content: "hi".into(),
                },
            ],
            temperature: Some(0.2),
            max_tokens: Some(50),
        }
    }

    #[tokio::test]
    async fn happy_path_parses_response() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "model": "gpt-4o-mini",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "hello"}
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2}
            })))
            .expect(1)
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new(
            "test",
            server.uri(),
            Some("test-key".into()),
        );
        let resp = backend.complete(sample_request()).await.expect("should ok");
        assert_eq!(resp.content, "hello");
        assert_eq!(resp.model, "gpt-4o-mini");
        let usage = resp.usage.expect("usage present");
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.completion_tokens, 2);
    }

    #[tokio::test]
    async fn auth_error_mapped_correctly() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(401).set_body_string("invalid key"))
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new("t", server.uri(), Some("bad".into()));
        let err = backend.complete(sample_request()).await.unwrap_err();
        assert!(matches!(err, AiError::Auth), "got {:?}", err);
    }

    #[tokio::test]
    async fn rate_limit_error_mapped_correctly() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new("t", server.uri(), None);
        let err = backend.complete(sample_request()).await.unwrap_err();
        assert!(matches!(err, AiError::RateLimited), "got {:?}", err);
    }

    #[tokio::test]
    async fn server_error_mapped_correctly() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(503).set_body_string("upstream down"))
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new("t", server.uri(), None);
        let err = backend.complete(sample_request()).await.unwrap_err();
        match err {
            AiError::Backend(msg) => assert!(msg.contains("503")),
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[tokio::test]
    async fn no_choices_returns_invalid_response() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "model": "gpt-4o-mini",
                "choices": []
            })))
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new("t", server.uri(), None);
        let err = backend.complete(sample_request()).await.unwrap_err();
        assert!(matches!(err, AiError::InvalidResponse(_)), "got {:?}", err);
    }

    #[tokio::test]
    async fn no_api_key_means_no_auth_header() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "model": "local",
                "choices": [{"message": {"role": "assistant", "content": "ok"}}]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let backend = OpenAiCompatibleBackend::new("local", server.uri(), None);
        let resp = backend.complete(sample_request()).await.expect("ok");
        assert_eq!(resp.content, "ok");
    }
}
