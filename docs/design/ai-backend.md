# AI 백엔드 추상 설계 (v0.1 draft)

## 목적
wowTerminal은 세 종류의 AI 백엔드를 동등하게 다룬다.

1. **External** — 클라우드 API (OpenAI, Anthropic, Google Gemini 등)
2. **Local** — 로컬 추론 엔진 (Ollama, llama.cpp, mlc-llm 등)
3. **SelfHosted** — 사용자가 운영하는 OpenAI 호환 엔드포인트 (vLLM, TGI, Together AI 등)

사용자는 여러 백엔드를 동시에 등록해두고 채팅마다 자유롭게 전환할 수 있어야 한다.

## 핵심 트레잇

```rust
#[async_trait]
pub trait AiBackend: Send + Sync {
    fn id(&self) -> &str;
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, AiError>;
    // 추가 예정: complete_stream, list_models, estimate_tokens
}
```

모든 어댑터(`OpenAiBackend`, `AnthropicBackend`, `OllamaBackend`, `OpenAiCompatibleBackend` …)는 위 트레잇을 구현한다. 프론트엔드는 `id`로만 백엔드를 선택하면 되고, 내부 호출 차이는 어댑터가 흡수한다.

## 데이터 모델

```rust
enum Role { System, User, Assistant }

struct Message { role: Role, content: String }

struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
}

struct ChatResponse {
    content: String,
    model: String,
    usage: Option<TokenUsage>,
}

struct TokenUsage { prompt_tokens: u32, completion_tokens: u32 }
```

## 설정 스키마 (예시)

`~/.config/wowterminal/backends.toml` (사용자 키링 또는 패스프레이즈 암호화로 별도 보호되는 키는 여기에 평문 저장하지 않는다 — `secret_id`만 참조).

```toml
[[backend]]
id = "openai-personal"
kind = "external"
provider = "openai"
api_base = "https://api.openai.com/v1"
api_key_secret_id = "openai_personal_key"
default_model = "gpt-4o"

[[backend]]
id = "ollama-local"
kind = "local"
provider = "ollama"
endpoint = "http://localhost:11434"
default_model = "llama3.1:8b"

[[backend]]
id = "company-vllm"
kind = "self_hosted"
provider = "openai_compatible"
api_base = "https://vllm.internal.company/v1"
api_key_secret_id = "company_vllm_token"
default_model = "qwen2.5-coder-32b"
```

## 모듈 구조

```
src-tauri/src/ai/
├── mod.rs            # 트레잇 정의, prelude
├── types.rs          # Message, ChatRequest, ChatResponse, AiError, TokenUsage
├── registry.rs       # 등록된 백엔드 목록 + id로 dispatch (TODO)
├── config.rs         # backends.toml 로드/저장 (TODO)
└── adapters/         # 각 어댑터 (TODO)
    ├── openai.rs
    ├── anthropic.rs
    ├── ollama.rs
    └── openai_compat.rs
```

## 보안 / 키 관리
- API 키 등 시크릿은 `keyring` crate (Linux: Secret Service, macOS: Keychain, Windows: Credential Manager)로 저장.
- 키링 사용 불가 환경(SSH-only 리눅스 등)에서는 사용자 패스프레이즈로 AES-256-GCM 암호화한 `secrets.bin`을 데이터 디렉토리에 둔다.
- 어떤 경우에도 설정 파일(`backends.toml`)에 평문 키를 두지 않는다.

## 열린 질문 (Open Questions)
- 스트리밍 토큰 전달을 Tauri event로 보낼 것인지, 채널/IPC channel을 쓸 것인지 결정 필요.
- 멀티 백엔드 동시 호출 (예: "두 모델에 같은 질문 후 비교") UI를 v1에 포함할지.
- 로컬 모델 자동 시작 (Ollama 데몬 라이프사이클)을 앱이 관리할지, 사용자에게 맡길지.

## 다음 단계 (TODO)
- [ ] `registry.rs`, `config.rs` 작성
- [ ] `OpenAiBackend` 어댑터 구현 (HTTP/SSE 스트리밍 포함)
- [ ] `OllamaBackend` 어댑터 구현
- [ ] `OpenAiCompatibleBackend` (자체 호스팅용) 어댑터 구현
- [ ] keyring 기반 secret store 구현
