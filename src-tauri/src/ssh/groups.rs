//! 호스트 그룹 영속화 (`groups.toml`). 단순한 flat 그룹 — 와이어프레임의 3단계 중첩은 후속.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::Group;

#[derive(Debug, thiserror::Error)]
pub enum GroupStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encoding error: {0}")]
    Encoding(String),
    #[error("group not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OnDisk {
    #[serde(default)]
    groups: Vec<Group>,
}

pub struct GroupStore {
    path: PathBuf,
}

impl GroupStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    fn load(&self) -> Result<OnDisk, GroupStoreError> {
        if !self.path.exists() {
            return Ok(OnDisk::default());
        }
        let raw = fs::read_to_string(&self.path)?;
        toml::from_str(&raw).map_err(|e| GroupStoreError::Encoding(e.to_string()))
    }

    fn save(&self, disk: &OnDisk) -> Result<(), GroupStoreError> {
        let s = toml::to_string(disk).map_err(|e| GroupStoreError::Encoding(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, s)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Group>, GroupStoreError> {
        let mut g = self.load()?.groups;
        g.sort_by_key(|x| x.sort_order);
        Ok(g)
    }

    pub fn upsert(&self, group: Group) -> Result<(), GroupStoreError> {
        let mut disk = self.load()?;
        if let Some(existing) = disk.groups.iter_mut().find(|g| g.id == group.id) {
            *existing = group;
        } else {
            disk.groups.push(group);
        }
        self.save(&disk)
    }

    pub fn delete(&self, id: &str) -> Result<(), GroupStoreError> {
        let mut disk = self.load()?;
        let before = disk.groups.len();
        disk.groups.retain(|g| g.id != id);
        if disk.groups.len() == before {
            return Err(GroupStoreError::NotFound(id.into()));
        }
        self.save(&disk)
    }
}
