# AI Backend Abstraction Design (v0.1 draft)

## Goal
wowTerminal treats three kinds of AI backends equally.

1. **External** — cloud APIs (OpenAI, Anthropic, Google Gemini, etc.)
2. **Local** — local inference engines (Ollama, llama.cpp, mlc-llm, etc.)
3. **SelfHosted** — user-operated OpenAI-compatible endpoints (vLLM, TGI, Together AI, etc.)

Users should be able to register multiple backends at once and switch freely per chat.

## Core Trait

```rust
#[async_trait]
pub trait AiBackend: Send + Sync {
    fn id(&self) -> &str;
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse, AiError>;
    // Planned: complete_stream, list_models, estimate_tokens
}
```

Every adapter (`OpenAiBackend`, `AnthropicBackend`, `OllamaBackend`, `OpenAiCompatibleBackend`, …) implements this trait. The frontend only selects a backend by `id`; the adapter absorbs the internal call differences.

## Data Model

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

## Config Schema (example)

`~/.config/wowterminal/backends.toml` (keys protected separately by the OS keyring or passphrase encryption are NOT stored here in plaintext — only a `secret_id` is referenced).

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

## Module Structure

```
src-tauri/src/ai/
├── mod.rs            # trait definitions, prelude
├── types.rs          # Message, ChatRequest, ChatResponse, AiError, TokenUsage
├── registry.rs       # list of registered backends + dispatch by id (TODO)
├── config.rs         # load/save backends.toml (TODO)
└── adapters/         # each adapter (TODO)
    ├── openai.rs
    ├── anthropic.rs
    ├── ollama.rs
    └── openai_compat.rs
```

## Security / Key Management
- Secrets such as API keys are stored via the `keyring` crate (Linux: Secret Service, macOS: Keychain, Windows: Credential Manager).
- In environments without a keyring (SSH-only Linux, etc.), a `secrets.bin` encrypted with AES-256-GCM from the user passphrase is placed in the data directory.
- In no case is a plaintext key kept in the config file (`backends.toml`).

## Open Questions
- Decide whether to deliver streaming tokens via Tauri events or a channel/IPC channel.
- Decide whether to include multi-backend simultaneous calls (e.g., "ask the same question to two models and compare") in the v1 UI.
- Decide whether the app manages local-model auto-start (Ollama daemon lifecycle) or leaves it to the user.

## Next Steps (TODO)
- [ ] Write `registry.rs`, `config.rs`
- [ ] Implement the `OpenAiBackend` adapter (including HTTP/SSE streaming)
- [ ] Implement the `OllamaBackend` adapter
- [ ] Implement the `OpenAiCompatibleBackend` adapter (for self-hosting)
- [ ] Implement the keyring-based secret store
