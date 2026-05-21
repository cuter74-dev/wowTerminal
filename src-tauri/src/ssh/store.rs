//! 호스트 프로필 영속화 (`hosts.toml`).
//!
//! 파일에는 메타데이터만 들어간다. 비밀번호/패스프레이즈 같은 시크릿은
//! `secret_id`만 적혀있고, 실제 값은 `secrets::SecretStore`가 가진다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::SshHost;

#[derive(Debug, thiserror::Error)]
pub enum HostStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("encoding error: {0}")]
    Encoding(String),

    #[error("host not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    hosts: Vec<SshHost>,
}

pub struct HostStore {
    path: PathBuf,
}

impl HostStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }

    fn load(&self) -> Result<OnDisk, HostStoreError> {
        if !self.path.exists() {
            return Ok(OnDisk::default());
        }
        let raw = fs::read_to_string(&self.path)?;
        toml::from_str(&raw).map_err(|e| HostStoreError::Encoding(e.to_string()))
    }

    fn save(&self, disk: &OnDisk) -> Result<(), HostStoreError> {
        let s = toml::to_string(disk).map_err(|e| HostStoreError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<SshHost>, HostStoreError> {
        Ok(self.load()?.hosts)
    }

    pub fn get(&self, id: &str) -> Result<SshHost, HostStoreError> {
        self.load()?
            .hosts
            .into_iter()
            .find(|h| h.id == id)
            .ok_or_else(|| HostStoreError::NotFound(id.into()))
    }

    /// `host.id`가 이미 있으면 업데이트, 없으면 추가.
    pub fn upsert(&self, host: SshHost) -> Result<(), HostStoreError> {
        let mut disk = self.load()?;
        if let Some(existing) = disk.hosts.iter_mut().find(|h| h.id == host.id) {
            *existing = host;
        } else {
            disk.hosts.push(host);
        }
        self.save(&disk)
    }

    pub fn delete(&self, id: &str) -> Result<(), HostStoreError> {
        let mut disk = self.load()?;
        let before = disk.hosts.len();
        disk.hosts.retain(|h| h.id != id);
        if disk.hosts.len() == before {
            return Err(HostStoreError::NotFound(id.into()));
        }
        self.save(&disk)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::{SshAuthMethod, SshHost};

    fn tmp_path() -> PathBuf {
        std::env::temp_dir().join(format!("wowterm-hosts-{}.toml", uuid::Uuid::new_v4()))
    }

    fn sample(id: &str, name: &str) -> SshHost {
        SshHost {
            id: id.into(),
            name: name.into(),
            host: "example.com".into(),
            port: 22,
            user: "root".into(),
            auth: SshAuthMethod::Agent,
            tags: vec!["prod".into()],
        }
    }

    #[test]
    fn empty_store_returns_no_hosts() {
        let path = tmp_path();
        let store = HostStore::new(&path);
        assert!(store.list().unwrap().is_empty());
        // get on empty → NotFound
        assert!(matches!(store.get("any").unwrap_err(), HostStoreError::NotFound(_)));
    }

    #[test]
    fn upsert_and_list_roundtrip() {
        let path = tmp_path();
        let store = HostStore::new(&path);

        store.upsert(sample("a", "Alpha")).unwrap();
        store.upsert(sample("b", "Bravo")).unwrap();

        let hosts = store.list().unwrap();
        assert_eq!(hosts.len(), 2);
        assert!(hosts.iter().any(|h| h.id == "a"));
        assert!(hosts.iter().any(|h| h.id == "b"));

        let a = store.get("a").unwrap();
        assert_eq!(a.name, "Alpha");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn upsert_replaces_existing() {
        let path = tmp_path();
        let store = HostStore::new(&path);

        let mut h = sample("x", "old");
        store.upsert(h.clone()).unwrap();

        h.name = "new".into();
        h.port = 2222;
        store.upsert(h).unwrap();

        let got = store.get("x").unwrap();
        assert_eq!(got.name, "new");
        assert_eq!(got.port, 2222);
        assert_eq!(store.list().unwrap().len(), 1);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn delete_removes_and_double_delete_errors() {
        let path = tmp_path();
        let store = HostStore::new(&path);
        store.upsert(sample("x", "X")).unwrap();
        store.delete("x").unwrap();
        assert!(store.list().unwrap().is_empty());
        let err = store.delete("x").unwrap_err();
        assert!(matches!(err, HostStoreError::NotFound(_)));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn auth_method_serde_roundtrip() {
        // 모든 SshAuthMethod 변형이 hosts.toml에 잘 직렬화되고 다시 읽히는지.
        let path = tmp_path();
        let store = HostStore::new(&path);

        let mut pw = sample("pw", "pw-host");
        pw.auth = SshAuthMethod::Password {
            secret_id: "pw_secret".into(),
        };
        let mut pk = sample("pk", "pk-host");
        pk.auth = SshAuthMethod::PrivateKey {
            key_id: "my_key".into(),
            passphrase_secret_id: Some("my_key_pass".into()),
        };
        let agent = sample("ag", "agent-host"); // 기본이 Agent

        store.upsert(pw).unwrap();
        store.upsert(pk).unwrap();
        store.upsert(agent).unwrap();

        let got_pw = store.get("pw").unwrap();
        match got_pw.auth {
            SshAuthMethod::Password { secret_id } => assert_eq!(secret_id, "pw_secret"),
            other => panic!("expected Password, got {:?}", other),
        }

        let got_pk = store.get("pk").unwrap();
        match got_pk.auth {
            SshAuthMethod::PrivateKey {
                key_id,
                passphrase_secret_id,
            } => {
                assert_eq!(key_id, "my_key");
                assert_eq!(passphrase_secret_id.as_deref(), Some("my_key_pass"));
            }
            other => panic!("expected PrivateKey, got {:?}", other),
        }

        let got_ag = store.get("ag").unwrap();
        assert!(matches!(got_ag.auth, SshAuthMethod::Agent));

        let _ = fs::remove_file(&path);
    }
}
