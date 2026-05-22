//! known_hosts 저장소 (TOFU 정책용).
//!
//! 디스크 형식 (TOML):
//! ```toml
//! version = 1
//!
//! [entries."example.com:22"]
//! algorithm = "ssh-ed25519"
//! fingerprint = "SHA256:abc..."
//! added_at = "2026-05-22T10:00:00Z"
//! ```
//!
//! - 같은 (host, port) 키에 다른 fingerprint가 오면 [`MatchResult::Mismatch`]를 돌려준다.
//! - "처음 보는 호스트"는 [`MatchResult::FirstContact`]를 돌려준다 — 호출 측에서
//!   `record_first_contact`를 호출해 저장하는지는 정책에 따라 결정.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const FORMAT_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum KnownHostsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("encoding error: {0}")]
    Encoding(String),

    #[error("entry not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnownHostEntry {
    pub algorithm: String,
    pub fingerprint: String,
    pub added_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    version: u32,
    #[serde(default)]
    entries: BTreeMap<String, KnownHostEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchResult {
    /// 이 (host, port)는 저장된 적이 없다.
    FirstContact,
    /// 저장된 fingerprint와 일치.
    Match,
    /// 저장된 fingerprint와 다르다. (잠재적 MITM)
    Mismatch { stored: KnownHostEntry },
}

pub struct KnownHostsStore {
    path: PathBuf,
    /// 디스크 IO 직렬화. 멀티 세션 동시 connect 상황에서 race 방지.
    lock: Mutex<()>,
}

impl KnownHostsStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn key_of(host: &str, port: u16) -> String {
        format!("{host}:{port}")
    }

    fn load(&self) -> Result<OnDisk, KnownHostsError> {
        if !self.path.exists() {
            return Ok(OnDisk {
                version: FORMAT_VERSION,
                entries: BTreeMap::new(),
            });
        }
        let raw = fs::read_to_string(&self.path)?;
        let parsed: OnDisk = toml::from_str(&raw)
            .map_err(|e| KnownHostsError::Encoding(e.to_string()))?;
        if parsed.version != FORMAT_VERSION {
            return Err(KnownHostsError::Encoding(format!(
                "unsupported known_hosts version: {}",
                parsed.version
            )));
        }
        Ok(parsed)
    }

    fn save(&self, disk: &OnDisk) -> Result<(), KnownHostsError> {
        let s = toml::to_string(disk).map_err(|e| KnownHostsError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<(String, KnownHostEntry)>, KnownHostsError> {
        let _g = self.lock.lock().expect("known_hosts lock poisoned");
        let disk = self.load()?;
        Ok(disk.entries.into_iter().collect())
    }

    pub fn check(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<MatchResult, KnownHostsError> {
        let _g = self.lock.lock().expect("known_hosts lock poisoned");
        let disk = self.load()?;
        let key = Self::key_of(host, port);
        match disk.entries.get(&key) {
            None => Ok(MatchResult::FirstContact),
            Some(existing) => {
                if existing.algorithm == algorithm && existing.fingerprint == fingerprint {
                    Ok(MatchResult::Match)
                } else {
                    Ok(MatchResult::Mismatch {
                        stored: existing.clone(),
                    })
                }
            }
        }
    }

    /// 처음 보는 호스트를 저장. 이미 있는 호스트에 호출하면 덮어쓴다 (의도된 동작:
    /// `trust` 호출은 별도 명령으로 명시).
    pub fn record(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<KnownHostEntry, KnownHostsError> {
        let _g = self.lock.lock().expect("known_hosts lock poisoned");
        let mut disk = self.load()?;
        let entry = KnownHostEntry {
            algorithm: algorithm.into(),
            fingerprint: fingerprint.into(),
            added_at: now_iso8601(),
        };
        disk.entries.insert(Self::key_of(host, port), entry.clone());
        self.save(&disk)?;
        Ok(entry)
    }

    pub fn forget(&self, host: &str, port: u16) -> Result<(), KnownHostsError> {
        let _g = self.lock.lock().expect("known_hosts lock poisoned");
        let mut disk = self.load()?;
        let key = Self::key_of(host, port);
        if disk.entries.remove(&key).is_none() {
            return Err(KnownHostsError::NotFound(key));
        }
        self.save(&disk)
    }
}

fn now_iso8601() -> String {
    // 외부 chrono 의존성 추가 없이 epoch → 매우 단순한 ISO-like 표현.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@unix:{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("wowterm-known-{}.toml", uuid::Uuid::new_v4()))
    }

    #[test]
    fn first_contact_then_match() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);

        assert_eq!(
            s.check("h", 22, "ssh-ed25519", "SHA256:abc").unwrap(),
            MatchResult::FirstContact
        );

        s.record("h", 22, "ssh-ed25519", "SHA256:abc").unwrap();
        assert_eq!(
            s.check("h", 22, "ssh-ed25519", "SHA256:abc").unwrap(),
            MatchResult::Match
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mismatch_returns_stored_entry() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);
        s.record("h", 22, "ssh-ed25519", "SHA256:original").unwrap();

        let res = s
            .check("h", 22, "ssh-ed25519", "SHA256:DIFFERENT")
            .unwrap();
        match res {
            MatchResult::Mismatch { stored } => {
                assert_eq!(stored.fingerprint, "SHA256:original");
            }
            other => panic!("expected Mismatch, got {:?}", other),
        }

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn different_algorithm_is_mismatch() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);
        s.record("h", 22, "ssh-ed25519", "SHA256:abc").unwrap();
        match s.check("h", 22, "ssh-rsa", "SHA256:abc").unwrap() {
            MatchResult::Mismatch { .. } => {}
            other => panic!("expected Mismatch, got {:?}", other),
        }
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn port_distinguishes_entries() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);
        s.record("h", 22, "alg", "fp1").unwrap();
        s.record("h", 2222, "alg", "fp2").unwrap();
        assert_eq!(s.check("h", 22, "alg", "fp1").unwrap(), MatchResult::Match);
        assert_eq!(s.check("h", 2222, "alg", "fp2").unwrap(), MatchResult::Match);
        let list = s.list().unwrap();
        assert_eq!(list.len(), 2);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn forget_removes() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);
        s.record("h", 22, "alg", "fp").unwrap();
        s.forget("h", 22).unwrap();
        assert_eq!(
            s.check("h", 22, "alg", "fp").unwrap(),
            MatchResult::FirstContact
        );
        // 두 번째 forget은 NotFound
        let err = s.forget("h", 22).unwrap_err();
        assert!(matches!(err, KnownHostsError::NotFound(_)));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn record_overwrites_existing() {
        let path = tmp();
        let s = KnownHostsStore::new(&path);
        s.record("h", 22, "alg", "old").unwrap();
        s.record("h", 22, "alg", "new").unwrap();
        let list = s.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].1.fingerprint, "new");
        let _ = fs::remove_file(&path);
    }
}
