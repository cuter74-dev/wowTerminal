//! 태그 영속화 (`tags.toml`). 색상은 hex `#RRGGBB`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::Tag;

#[derive(Debug, thiserror::Error)]
pub enum TagStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encoding error: {0}")]
    Encoding(String),
    #[error("tag not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    tags: Vec<Tag>,
}

pub struct TagStore {
    path: PathBuf,
}

impl TagStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    fn load(&self) -> Result<OnDisk, TagStoreError> {
        if !self.path.exists() {
            return Ok(OnDisk::default());
        }
        let raw = fs::read_to_string(&self.path)?;
        toml::from_str(&raw).map_err(|e| TagStoreError::Encoding(e.to_string()))
    }

    fn save(&self, disk: &OnDisk) -> Result<(), TagStoreError> {
        let s = toml::to_string(disk).map_err(|e| TagStoreError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Tag>, TagStoreError> {
        Ok(self.load()?.tags)
    }

    pub fn upsert(&self, tag: Tag) -> Result<(), TagStoreError> {
        let mut disk = self.load()?;
        if let Some(existing) = disk.tags.iter_mut().find(|t| t.id == tag.id) {
            *existing = tag;
        } else {
            disk.tags.push(tag);
        }
        self.save(&disk)
    }

    pub fn delete(&self, id: &str) -> Result<(), TagStoreError> {
        let mut disk = self.load()?;
        let before = disk.tags.len();
        disk.tags.retain(|t| t.id != id);
        if disk.tags.len() == before {
            return Err(TagStoreError::NotFound(id.into()));
        }
        self.save(&disk)
    }
}
