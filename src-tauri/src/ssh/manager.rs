//! 활성 SSH 세션 관리. PtyManager와 같은 패턴.

use std::collections::HashMap;
use std::sync::Arc;

use thiserror::Error;
use tokio::sync::Mutex;

use crate::pty::manager::DataSink;

use super::known_hosts::KnownHostsStore;
use super::session::{ResolvedAuth, SessionId, SshSession};
use super::types::SshHost;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("session not found: {0}")]
    NotFound(SessionId),

    #[error("connect: {0}")]
    Connect(String),

    #[error("auth: {0}")]
    Auth(String),

    #[error("channel: {0}")]
    Channel(String),

    #[error("io: {0}")]
    Io(String),

    #[error("host key mismatch for {host}:{port} (stored={stored}, presented={presented})")]
    HostKeyMismatch {
        host: String,
        port: u16,
        algorithm: String,
        stored: String,
        presented: String,
    },

    #[error("first contact with {host}:{port} requires user confirmation (fingerprint={fingerprint})")]
    FirstContactRequired {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },

    /// password 즉석 입력이 필요. UI가 모달로 받아 retry로 다시 ssh_connect 호출.
    #[error("password required for {user}@{host}:{port}")]
    PasswordRequired {
        host: String,
        port: u16,
        user: String,
    },
}

pub struct SshManager {
    sessions: Mutex<HashMap<SessionId, Arc<SshSession>>>,
    sink: DataSink,
    known_hosts: Arc<KnownHostsStore>,
}

impl SshManager {
    pub fn new(sink: DataSink, known_hosts: Arc<KnownHostsStore>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sink,
            known_hosts,
        }
    }

    pub fn known_hosts(&self) -> Arc<KnownHostsStore> {
        Arc::clone(&self.known_hosts)
    }

    pub async fn connect(
        &self,
        host: &SshHost,
        auth: ResolvedAuth,
        cols: u16,
        rows: u16,
    ) -> Result<SessionId, SshError> {
        let session_id: SessionId = uuid::Uuid::new_v4().to_string();
        let session = SshSession::connect(
            &host.host,
            host.port,
            &host.user,
            auth,
            cols,
            rows,
            session_id.clone(),
            self.sink.clone(),
            Arc::clone(&self.known_hosts),
        )
        .await?;

        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), Arc::new(session));

        Ok(session_id)
    }

    pub async fn write(&self, id: &str, data: &[u8]) -> Result<(), SshError> {
        let session = {
            let guard = self.sessions.lock().await;
            guard
                .get(id)
                .cloned()
                .ok_or_else(|| SshError::NotFound(id.into()))?
        };
        session.write(data).await
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), SshError> {
        let session = {
            let guard = self.sessions.lock().await;
            guard
                .get(id)
                .cloned()
                .ok_or_else(|| SshError::NotFound(id.into()))?
        };
        session.resize(cols, rows).await
    }

    pub async fn kill(&self, id: &str) -> Result<(), SshError> {
        let session = {
            let mut guard = self.sessions.lock().await;
            guard.remove(id).ok_or_else(|| SshError::NotFound(id.into()))?
        };
        session.close().await
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.lock().await.len()
    }
}
