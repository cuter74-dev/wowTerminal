//! 패스프레이즈 파생 키(KEK)로 AES-256-GCM 암호화한 TOML 시크릿 파일.
//!
//! - KEK = Argon2id(passphrase, salt, m=64MiB / t=3 / p=1, 32B)
//! - 시크릿마다 12B nonce, AAD = id (`id_a`의 ciphertext를 `id_b` 자리에 옮겨도 AEAD 실패).
//! - AEAD 실패는 "잘못된 패스프레이즈"와 "변조"를 외부에서 구분하지 못 하도록 [`SecretError::BadPassphrase`]로 통합.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{Secret, SecretError, SecretStore};

const FILE_VERSION: u32 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

pub struct EncryptedFileStore {
    path: PathBuf,
    kek: Zeroizing<Vec<u8>>,
    inner: Mutex<FileFormat>,
}

impl EncryptedFileStore {
    /// 파일이 없으면 새 salt를 만들어 빈 파일을 생성하고, 있으면 로드한다.
    /// 패스프레이즈 검증은 첫 [`load`]에서 AEAD 실패로 자연스럽게 일어난다.
    pub fn open_or_create(path: impl Into<PathBuf>, passphrase: &str) -> Result<Self, SecretError> {
        let path = path.into();
        let file = if path.exists() {
            let txt = fs::read_to_string(&path).map_err(|e| SecretError::Io(e.to_string()))?;
            toml::from_str::<FileFormat>(&txt)
                .map_err(|e| SecretError::Backend(format!("toml parse: {e}")))?
        } else {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent).map_err(|e| SecretError::Io(e.to_string()))?;
                }
            }
            let mut salt = vec![0u8; SALT_LEN];
            rand::thread_rng().fill_bytes(&mut salt);
            let f = FileFormat {
                version: FILE_VERSION,
                salt: B64.encode(&salt),
                entries: BTreeMap::new(),
            };
            write_file(&path, &f)?;
            f
        };

        let salt = B64
            .decode(file.salt.as_bytes())
            .map_err(|e| SecretError::Backend(format!("salt base64: {e}")))?;
        let kek = derive_kek(passphrase, &salt)?;

        Ok(Self {
            path,
            kek,
            inner: Mutex::new(file),
        })
    }

    fn cipher(&self) -> Result<Aes256Gcm, SecretError> {
        Aes256Gcm::new_from_slice(self.kek.as_slice())
            .map_err(|e| SecretError::Backend(format!("aes init: {e}")))
    }

    fn persist(&self, file: &FileFormat) -> Result<(), SecretError> {
        write_file(&self.path, file)
    }
}

impl SecretStore for EncryptedFileStore {
    fn save(&self, id: &str, value: &[u8]) -> Result<(), SecretError> {
        let cipher = self.cipher()?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: value,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| SecretError::Backend("aead encrypt failed".into()))?;

        let mut file = self.inner.lock().expect("secrets mutex poisoned");
        file.entries.insert(
            id.to_string(),
            EntryRecord {
                nonce: B64.encode(nonce_bytes),
                ciphertext: B64.encode(&ct),
            },
        );
        self.persist(&file)?;
        Ok(())
    }

    fn load(&self, id: &str) -> Result<Secret, SecretError> {
        let entry = {
            let file = self.inner.lock().expect("secrets mutex poisoned");
            file.entries
                .get(id)
                .cloned()
                .ok_or_else(|| SecretError::NotFound(id.to_string()))?
        };
        let nonce_bytes = B64
            .decode(entry.nonce.as_bytes())
            .map_err(|_| SecretError::BadPassphrase)?;
        if nonce_bytes.len() != NONCE_LEN {
            return Err(SecretError::BadPassphrase);
        }
        let ct = B64
            .decode(entry.ciphertext.as_bytes())
            .map_err(|_| SecretError::BadPassphrase)?;

        let cipher = self.cipher()?;
        let pt = cipher
            .decrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: &ct,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| SecretError::BadPassphrase)?;
        Ok(Zeroizing::new(pt))
    }

    fn delete(&self, id: &str) -> Result<(), SecretError> {
        let mut file = self.inner.lock().expect("secrets mutex poisoned");
        if file.entries.remove(id).is_some() {
            self.persist(&file)?;
        }
        Ok(())
    }
}

fn derive_kek(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<Vec<u8>>, SecretError> {
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|e| SecretError::Backend(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new(vec![0u8; 32]);
    argon
        .hash_password_into(passphrase.as_bytes(), salt, out.as_mut_slice())
        .map_err(|e| SecretError::Backend(format!("argon2: {e}")))?;
    Ok(out)
}

fn write_file(path: &Path, file: &FileFormat) -> Result<(), SecretError> {
    let txt = toml::to_string_pretty(file)
        .map_err(|e| SecretError::Backend(format!("toml serialize: {e}")))?;
    fs::write(path, txt).map_err(|e| SecretError::Io(e.to_string()))
}

#[derive(Serialize, Deserialize, Default)]
struct FileFormat {
    #[serde(default)]
    version: u32,
    salt: String,
    #[serde(default)]
    entries: BTreeMap<String, EntryRecord>,
}

#[derive(Serialize, Deserialize, Clone)]
struct EntryRecord {
    nonce: String,
    ciphertext: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store(dir: &TempDir, name: &str, pw: &str) -> EncryptedFileStore {
        EncryptedFileStore::open_or_create(dir.path().join(name), pw).expect("open")
    }

    #[test]
    fn roundtrip() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir, "a.toml", "correct-horse-battery-staple");
        s.save("api", b"sk-abc123").unwrap();
        let got = s.load("api").unwrap();
        assert_eq!(got.as_slice(), b"sk-abc123");
    }

    #[test]
    fn overwrite_replaces_value() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir, "a.toml", "pw");
        s.save("k", b"v1").unwrap();
        s.save("k", b"v2").unwrap();
        assert_eq!(s.load("k").unwrap().as_slice(), b"v2");
    }

    #[test]
    fn delete_is_idempotent_and_clears_value() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir, "a.toml", "pw");
        s.save("k", b"v").unwrap();
        s.delete("k").unwrap();
        assert!(matches!(s.load("k"), Err(SecretError::NotFound(_))));
        // 없는 키 삭제도 OK
        s.delete("nope").unwrap();
    }

    #[test]
    fn reopen_with_wrong_passphrase_yields_bad_passphrase() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.toml");
        let s1 = EncryptedFileStore::open_or_create(&path, "right").unwrap();
        s1.save("k", b"v").unwrap();
        drop(s1);

        let s2 = EncryptedFileStore::open_or_create(&path, "wrong").unwrap();
        assert!(matches!(s2.load("k"), Err(SecretError::BadPassphrase)));
    }

    #[test]
    fn tampered_ciphertext_yields_bad_passphrase() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.toml");
        let s = EncryptedFileStore::open_or_create(&path, "pw").unwrap();
        s.save("k", b"v").unwrap();
        drop(s);

        // 디스크에서 ciphertext 1바이트만 변조.
        let raw = fs::read_to_string(&path).unwrap();
        let mut parsed: FileFormat = toml::from_str(&raw).unwrap();
        let entry = parsed.entries.get_mut("k").unwrap();
        let mut bytes = B64.decode(entry.ciphertext.as_bytes()).unwrap();
        bytes[0] ^= 0xFF;
        entry.ciphertext = B64.encode(&bytes);
        write_file(&path, &parsed).unwrap();

        let s2 = EncryptedFileStore::open_or_create(&path, "pw").unwrap();
        assert!(matches!(s2.load("k"), Err(SecretError::BadPassphrase)));
    }

    #[test]
    fn swapping_ciphertext_between_ids_fails_aad_check() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.toml");
        let s = EncryptedFileStore::open_or_create(&path, "pw").unwrap();
        s.save("id_a", b"value-a").unwrap();
        s.save("id_b", b"value-b").unwrap();
        drop(s);

        // id_a의 (nonce, ciphertext)를 id_b 자리에 복사 → AAD 불일치로 BadPassphrase.
        let raw = fs::read_to_string(&path).unwrap();
        let mut parsed: FileFormat = toml::from_str(&raw).unwrap();
        let from_a = parsed.entries.get("id_a").cloned().unwrap();
        parsed.entries.insert("id_b".into(), from_a);
        write_file(&path, &parsed).unwrap();

        let s2 = EncryptedFileStore::open_or_create(&path, "pw").unwrap();
        assert!(matches!(s2.load("id_b"), Err(SecretError::BadPassphrase)));
    }
}
