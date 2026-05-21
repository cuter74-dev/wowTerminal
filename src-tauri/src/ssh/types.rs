//! SSH 매니저 데이터 모델.

use serde::{Deserialize, Serialize};

/// SSH 호스트 프로필. UI에 노출되는 식별자/접속정보를 담는다.
/// 개인키 자체는 별도 keystore에 저장되고, 여기서는 참조 ID만 갖는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHost {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthMethod,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuthMethod {
    /// 호스트별 비밀번호 (keystore에 저장된 비밀의 ID 참조).
    Password { secret_id: String },
    /// 개인키 (keystore에 저장된 키의 ID 참조).
    PrivateKey {
        key_id: String,
        passphrase_secret_id: Option<String>,
    },
    /// ssh-agent 위임.
    Agent,
}
