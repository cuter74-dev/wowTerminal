//! SSH 키 관리 (S-019~024).
//!
//! - 메타데이터(`keys.toml`)는 [`KeyStore`]가 관리: id/name/algorithm/fingerprint/public_key.
//! - 개인키 원문(OpenSSH PEM)은 `SecretStore`(keyring)에 `id`를 secret_id로 저장.
//! - 키 생성/파싱은 `ssh-key` crate 사용.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use russh::keys::ssh_key::{HashAlg, PrivateKey};
use serde::{Deserialize, Serialize};

use super::types::SshKeyEntry;

#[derive(Debug, thiserror::Error)]
pub enum KeyStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encoding error: {0}")]
    Encoding(String),
    #[error("key not found: {0}")]
    NotFound(String),
    #[error("key error: {0}")]
    Key(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    keys: Vec<SshKeyEntry>,
}

pub struct KeyStore {
    path: PathBuf,
}

impl KeyStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    fn load(&self) -> Result<OnDisk, KeyStoreError> {
        if !self.path.exists() {
            return Ok(OnDisk::default());
        }
        let raw = fs::read_to_string(&self.path)?;
        toml::from_str(&raw).map_err(|e| KeyStoreError::Encoding(e.to_string()))
    }

    fn save(&self, disk: &OnDisk) -> Result<(), KeyStoreError> {
        let s = toml::to_string(disk).map_err(|e| KeyStoreError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<SshKeyEntry>, KeyStoreError> {
        Ok(self.load()?.keys)
    }

    pub fn get(&self, id: &str) -> Result<SshKeyEntry, KeyStoreError> {
        self.load()?
            .keys
            .into_iter()
            .find(|k| k.id == id)
            .ok_or_else(|| KeyStoreError::NotFound(id.into()))
    }

    pub fn upsert(&self, entry: SshKeyEntry) -> Result<(), KeyStoreError> {
        let mut disk = self.load()?;
        if let Some(existing) = disk.keys.iter_mut().find(|k| k.id == entry.id) {
            *existing = entry;
        } else {
            disk.keys.push(entry);
        }
        self.save(&disk)
    }

    pub fn delete(&self, id: &str) -> Result<(), KeyStoreError> {
        let mut disk = self.load()?;
        let before = disk.keys.len();
        disk.keys.retain(|k| k.id != id);
        if disk.keys.len() == before {
            return Err(KeyStoreError::NotFound(id.into()));
        }
        self.save(&disk)
    }
}

/// 새 개인키를 생성한다. 반환: (OpenSSH PEM 원문, 메타데이터 — id는 호출자가 부여).
///
/// 시스템 `ssh-keygen`으로 생성한다 — `ssh-key` crate가 의존하는 rand_core 0.10이
/// 안정적인 OsRng를 제공하지 않아, 키 생성은 외부 도구에 위임하고 파싱만 crate로 한다.
/// 생성된 임시 키 파일은 즉시 삭제하고 PEM은 메모리로만 반환한다.
pub fn generate(algorithm: &str, comment: &str) -> Result<(String, GeneratedMeta), KeyStoreError> {
    let algo_flag = match algorithm {
        "ed25519" | "ssh-ed25519" => "ed25519",
        "rsa" | "ssh-rsa" => "rsa",
        other => return Err(KeyStoreError::Key(format!("unsupported algorithm: {other}"))),
    };

    let dir = std::env::temp_dir().join(format!("wowterm-keygen-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir)?;
    let key_path = dir.join("id");

    let result = (|| {
        let status = Command::new("ssh-keygen")
            .arg("-t")
            .arg(algo_flag)
            .arg("-N")
            .arg("") // 패스프레이즈 없음 — 보호는 keyring이 담당
            .arg("-C")
            .arg(comment)
            .arg("-f")
            .arg(&key_path)
            .arg("-q")
            .status()
            .map_err(|e| KeyStoreError::Key(format!("ssh-keygen 실행 실패: {e}")))?;
        if !status.success() {
            return Err(KeyStoreError::Key("ssh-keygen이 실패했습니다".into()));
        }
        let pem = fs::read_to_string(&key_path)?;
        let meta = parse_imported(&pem, None)?;
        Ok((pem, meta))
    })();

    // 임시 키 파일은 어떤 경우에도 삭제.
    let _ = fs::remove_dir_all(&dir);
    result
}

/// 기존 OpenSSH 개인키 PEM을 파싱해 메타데이터를 뽑는다. 패스프레이즈가 있으면 복호화 시도.
pub fn parse_imported(pem: &str, passphrase: Option<&str>) -> Result<GeneratedMeta, KeyStoreError> {
    let key = PrivateKey::from_openssh(pem).map_err(|e| KeyStoreError::Key(e.to_string()))?;
    let encrypted = key.is_encrypted();
    let key = if encrypted {
        let pass = passphrase.ok_or_else(|| KeyStoreError::Key("passphrase required".into()))?;
        key.decrypt(pass.as_bytes())
            .map_err(|e| KeyStoreError::Key(format!("decrypt: {e}")))?
    } else {
        key
    };
    let mut meta = meta_from_key(&key)?;
    meta.encrypted = encrypted;
    Ok(meta)
}

pub struct GeneratedMeta {
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
    pub encrypted: bool,
}

fn meta_from_key(key: &PrivateKey) -> Result<GeneratedMeta, KeyStoreError> {
    let pubkey = key.public_key();
    let public_key = pubkey
        .to_openssh()
        .map_err(|e| KeyStoreError::Key(e.to_string()))?;
    Ok(GeneratedMeta {
        algorithm: pubkey.algorithm().as_str().to_string(),
        fingerprint: pubkey.fingerprint(HashAlg::Sha256).to_string(),
        public_key,
        encrypted: false,
    })
}
