//! 백엔드 설정 데이터 모델.
//!
//! 사용자 설정 파일(`backends.toml`)에서 로드되는 형태.
//! 시크릿(API 키 등)은 `*_secret_id` 참조로만 보관하고, 평문은 keystore에서 따로 가져온다.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackendConfig {
    /// OpenAI 호환 엔드포인트 (OpenAI 본가, vLLM, TGI, Ollama OpenAI 엔드포인트 등).
    OpenAiCompatible(OpenAiCompatibleConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiCompatibleConfig {
    /// 사용자 식별자 (e.g. "openai-personal", "company-vllm").
    pub id: String,
    /// 표시용 이름.
    pub display_name: String,
    /// 베이스 URL (e.g. "https://api.openai.com/v1", "http://localhost:11434/v1").
    pub api_base: String,
    /// keystore에 저장된 API 키의 ID. 인증이 필요 없는 로컬 서버라면 `None`.
    pub api_key_secret_id: Option<String>,
    /// 기본 모델명.
    pub default_model: String,
}
