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
    /// 호스트가 속한 그룹의 ID. 미분류는 None.
    #[serde(default)]
    pub group_id: Option<String>,
    /// ProxyJump 점프 호스트의 ID (#61). 지정되면 이 호스트를 거쳐 접속. None이면 직접.
    #[serde(default)]
    pub proxy_jump: Option<String>,
}

/// 호스트를 묶는 단순 그룹. v1은 flat (parent 없음); 와이어프레임의 3단계 중첩은 후속.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    /// 정렬 순서 (작을수록 먼저). 사용자가 변경 가능.
    #[serde(default)]
    pub sort_order: i32,
}

/// 호스트에 붙는 태그. 색상은 hex `#RRGGBB`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// SSH 키 메타데이터 (S-019~024). 개인키 원문은 keyring에 `id`로 저장되고,
/// 여기에는 공개 정보만. `auth = PrivateKey{key_id}`에서 key_id = 이 id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeyEntry {
    pub id: String,
    pub name: String,
    /// 예: "ssh-ed25519", "ssh-rsa".
    pub algorithm: String,
    /// SHA256 fingerprint (`SHA256:...`).
    pub fingerprint: String,
    /// OpenSSH 공개키 한 줄.
    pub public_key: String,
    /// 개인키가 패스프레이즈로 암호화되어 keyring에 저장됐는지.
    #[serde(default)]
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuthMethod {
    /// 호스트별 비밀번호 (keystore에 저장된 비밀의 ID 참조).
    Password { secret_id: String },
    /// 접속 시점에 사용자에게 password를 입력받음. 저장하지 않고 메모리에서만 사용.
    PasswordPrompt,
    /// 개인키 (keystore에 저장된 키의 ID 참조).
    PrivateKey {
        key_id: String,
        passphrase_secret_id: Option<String>,
    },
    /// ssh-agent 위임.
    Agent,
}
