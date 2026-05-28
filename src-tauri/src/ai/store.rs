//! AI 백엔드 설정 영속화 (`backends.toml`).
//!
//! 파일에는 메타데이터(id, display_name, api_base, default_model)만 들어간다.
//! API 키는 `api_key_secret_id`만 참조로 저장되고, 실제 값은 OS 키링에 보관.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::config::{BackendConfig, OpenAiCompatibleConfig};

#[derive(Debug, thiserror::Error)]
pub enum BackendsStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encoding error: {0}")]
    Encoding(String),
    #[error("backend not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    backends: Vec<BackendConfig>,
}

pub struct BackendsStore {
    path: PathBuf,
}

impl BackendsStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    fn load(&self) -> Result<OnDisk, BackendsStoreError> {
        if !self.path.exists() {
            return Ok(OnDisk::default());
        }
        let raw = fs::read_to_string(&self.path)?;
        toml::from_str(&raw).map_err(|e| BackendsStoreError::Encoding(e.to_string()))
    }

    fn save(&self, disk: &OnDisk) -> Result<(), BackendsStoreError> {
        let s = toml::to_string(disk).map_err(|e| BackendsStoreError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<BackendConfig>, BackendsStoreError> {
        Ok(self.load()?.backends)
    }

    pub fn upsert(&self, cfg: BackendConfig) -> Result<(), BackendsStoreError> {
        let mut disk = self.load()?;
        let id = config_id(&cfg).to_string();
        if let Some(existing) = disk.backends.iter_mut().find(|b| config_id(b) == id) {
            *existing = cfg;
        } else {
            disk.backends.push(cfg);
        }
        self.save(&disk)
    }

    pub fn delete(&self, id: &str) -> Result<Option<BackendConfig>, BackendsStoreError> {
        let mut disk = self.load()?;
        let pos = disk.backends.iter().position(|b| config_id(b) == id);
        let removed = pos.map(|i| disk.backends.remove(i));
        if removed.is_some() {
            self.save(&disk)?;
        }
        Ok(removed)
    }
}

pub fn config_id(c: &BackendConfig) -> &str {
    match c {
        BackendConfig::OpenAiCompatible(o) => &o.id,
    }
}

pub fn config_secret_id(c: &BackendConfig) -> Option<&str> {
    match c {
        BackendConfig::OpenAiCompatible(o) => o.api_key_secret_id.as_deref(),
    }
}

pub fn make_openai_compat(c: OpenAiCompatibleConfig) -> OpenAiCompatibleConfig {
    c
}
