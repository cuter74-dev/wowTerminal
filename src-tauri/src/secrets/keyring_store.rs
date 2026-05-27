//! OS 키링(Secret Service / Keychain / Credential Manager) 기반 시크릿 저장소.
//!
//! `keyring` crate는 문자열만 다루기 때문에 임의 바이트는 base64로 감싸 저장한다.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use keyring::{Entry, Error as KeyringError};
use zeroize::Zeroizing;

use super::{Secret, SecretError, SecretStore};

pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self, id: &str) -> Result<Entry, SecretError> {
        Entry::new(&self.service, id).map_err(map_err)
    }
}

impl SecretStore for KeyringStore {
    fn save(&self, id: &str, value: &[u8]) -> Result<(), SecretError> {
        let encoded = B64.encode(value);
        self.entry(id)?.set_password(&encoded).map_err(map_err)
    }

    fn load(&self, id: &str) -> Result<Secret, SecretError> {
        let encoded = self.entry(id)?.get_password().map_err(map_err)?;
        let bytes = B64
            .decode(encoded.as_bytes())
            .map_err(|e| SecretError::Backend(format!("base64: {e}")))?;
        Ok(Zeroizing::new(bytes))
    }

    fn delete(&self, id: &str) -> Result<(), SecretError> {
        match self.entry(id)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(map_err(e)),
        }
    }
}

fn map_err(e: KeyringError) -> SecretError {
    match e {
        KeyringError::NoEntry => SecretError::NotFound("keyring entry".into()),
        other => SecretError::Backend(other.to_string()),
    }
}
