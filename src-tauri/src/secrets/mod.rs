//! 시크릿 저장소.
//!
//! - [`KeyringStore`]: OS 키링 (Linux Secret Service / macOS Keychain / Windows Credential Manager).
//! - [`EncryptedFileStore`]: 사용자 패스프레이즈로 AES-256-GCM 암호화한 TOML 파일.
//!   키 유도는 Argon2id, AAD에 `id`를 묶어 ciphertext 바꿔치기를 차단한다.
//!
//! 모든 평문 시크릿은 [`Secret`] (= `Zeroizing<Vec<u8>>`)로 다뤄 drop 시 자동 zeroize.

pub mod encrypted_file;
pub mod keyring_store;

pub use encrypted_file::EncryptedFileStore;
pub use keyring_store::KeyringStore;

use thiserror::Error;
use zeroize::Zeroizing;

pub type Secret = Zeroizing<Vec<u8>>;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("secret not found: {0}")]
    NotFound(String),
    /// 패스프레이즈가 틀렸거나 디스크 데이터가 변조된 경우. 외부에서 두 경우를 구분하지 못 하도록
    /// 의도적으로 통합 — 사용자에게는 둘 다 같은 액션(패스프레이즈 재입력)이 자연스럽다.
    #[error("bad passphrase or tampered data")]
    BadPassphrase,
    #[error("io: {0}")]
    Io(String),
    #[error("backend: {0}")]
    Backend(String),
}

pub trait SecretStore: Send + Sync {
    fn save(&self, id: &str, value: &[u8]) -> Result<(), SecretError>;
    fn load(&self, id: &str) -> Result<Secret, SecretError>;
    /// 없는 키에 대해서도 Ok를 반환한다 (멱등).
    fn delete(&self, id: &str) -> Result<(), SecretError>;
}
