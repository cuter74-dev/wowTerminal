//! SFTP 세션 관리 (S-025~037). SSH 연결 위에 sftp subsystem 채널을 열어
//! 원격 디렉토리 리스팅 / 파일 전송을 수행한다.
//!
//! 연결은 호스트 ID별로 캐시한다 (PTY 세션과 별개의 채널).

use std::collections::HashMap;
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tokio::sync::Mutex;

use super::known_hosts::KnownHostsStore;
use super::manager::SshError;
use super::session::{ResolvedAuth, SshSession, TofuHandler};
use super::types::SshHost;

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// unix epoch (초). 없으면 None.
    pub modified: Option<i64>,
    /// POSIX 권한 비트 (예: 0o755). 없으면 None.
    pub permissions: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

struct SftpConn {
    sftp: SftpSession,
    /// 연결 유지용 — drop되면 SSH 세션이 닫힌다.
    _handle: russh::client::Handle<TofuHandler>,
}

/// 전송 진행 콜백: (transfer_id, transferred_bytes, total_bytes).
pub type ProgressSink = Arc<dyn Fn(String, u64, u64) + Send + Sync>;

pub struct SftpManager {
    conns: Mutex<HashMap<String, Arc<SftpConn>>>,
    known_hosts: Arc<KnownHostsStore>,
    progress: ProgressSink,
}

impl SftpManager {
    pub fn new(known_hosts: Arc<KnownHostsStore>, progress: ProgressSink) -> Self {
        Self {
            conns: Mutex::new(HashMap::new()),
            known_hosts,
            progress,
        }
    }

    async fn get_or_connect(
        &self,
        host: &SshHost,
        auth: ResolvedAuth,
    ) -> Result<Arc<SftpConn>, SshError> {
        {
            let guard = self.conns.lock().await;
            if let Some(c) = guard.get(&host.id) {
                return Ok(c.clone());
            }
        }

        let handle = SshSession::establish(
            &host.host,
            host.port,
            &host.user,
            auth,
            Arc::clone(&self.known_hosts),
        )
        .await?;

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| SshError::Channel(e.to_string()))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| SshError::Channel(e.to_string()))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| SshError::Channel(format!("sftp init: {e}")))?;

        let conn = Arc::new(SftpConn {
            sftp,
            _handle: handle,
        });
        self.conns
            .lock()
            .await
            .insert(host.id.clone(), conn.clone());
        Ok(conn)
    }

    /// 연결만 보장 (디렉토리 리스팅 전에 호출).
    pub async fn connect(&self, host: &SshHost, auth: ResolvedAuth) -> Result<(), SshError> {
        self.get_or_connect(host, auth).await?;
        Ok(())
    }

    pub async fn list_dir(&self, host_id: &str, path: &str) -> Result<Vec<FileEntry>, SshError> {
        let conn = {
            let guard = self.conns.lock().await;
            guard
                .get(host_id)
                .cloned()
                .ok_or_else(|| SshError::NotFound(host_id.into()))?
        };
        let entries = conn
            .sftp
            .read_dir(path)
            .await
            .map_err(|e| SshError::Channel(format!("read_dir {path}: {e}")))?;

        let mut out = Vec::new();
        for entry in entries {
            let meta = entry.metadata();
            out.push(FileEntry {
                name: entry.file_name(),
                is_dir: meta.is_dir(),
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.map(|m| m as i64),
                permissions: meta.permissions,
            });
        }
        Ok(out)
    }

    /// 원격 홈 또는 시작 디렉토리 (canonicalize)를 반환.
    pub async fn canonicalize(&self, host_id: &str, path: &str) -> Result<String, SshError> {
        let conn = self.conn(host_id).await?;
        conn.sftp
            .canonicalize(path)
            .await
            .map_err(|e| SshError::Channel(format!("canonicalize: {e}")))
    }

    async fn conn(&self, host_id: &str) -> Result<Arc<SftpConn>, SshError> {
        self.conns
            .lock()
            .await
            .get(host_id)
            .cloned()
            .ok_or_else(|| SshError::NotFound(host_id.into()))
    }

    /// 원격 → 로컬. 64KB 청크 스트리밍 + 진행 이벤트. 다운로드한 바이트 수 반환.
    pub async fn download(
        &self,
        host_id: &str,
        remote: &str,
        local: &str,
        transfer_id: &str,
    ) -> Result<u64, SshError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let conn = self.conn(host_id).await?;
        let total = conn
            .sftp
            .metadata(remote)
            .await
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0);
        let mut rf = conn
            .sftp
            .open(remote)
            .await
            .map_err(|e| SshError::Channel(format!("open {remote}: {e}")))?;
        let mut out = tokio::fs::File::create(local)
            .await
            .map_err(|e| SshError::Io(format!("create {local}: {e}")))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut done: u64 = 0;
        (self.progress)(transfer_id.to_string(), 0, total);
        loop {
            let n = rf
                .read(&mut buf)
                .await
                .map_err(|e| SshError::Io(format!("read {remote}: {e}")))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .await
                .map_err(|e| SshError::Io(format!("write {local}: {e}")))?;
            done += n as u64;
            (self.progress)(transfer_id.to_string(), done, total);
        }
        let _ = out.flush().await;
        Ok(done)
    }

    /// 로컬 → 원격. 64KB 청크 스트리밍 + 진행 이벤트. 업로드한 바이트 수 반환.
    pub async fn upload(
        &self,
        host_id: &str,
        local: &str,
        remote: &str,
        transfer_id: &str,
    ) -> Result<u64, SshError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let conn = self.conn(host_id).await?;
        let total = tokio::fs::metadata(local)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let mut inp = tokio::fs::File::open(local)
            .await
            .map_err(|e| SshError::Io(format!("open {local}: {e}")))?;
        let mut rf = conn
            .sftp
            .create(remote)
            .await
            .map_err(|e| SshError::Channel(format!("create {remote}: {e}")))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut done: u64 = 0;
        (self.progress)(transfer_id.to_string(), 0, total);
        loop {
            let n = inp
                .read(&mut buf)
                .await
                .map_err(|e| SshError::Io(format!("read {local}: {e}")))?;
            if n == 0 {
                break;
            }
            rf.write_all(&buf[..n])
                .await
                .map_err(|e| SshError::Channel(format!("write {remote}: {e}")))?;
            done += n as u64;
            (self.progress)(transfer_id.to_string(), done, total);
        }
        let _ = rf.flush().await;
        let _ = rf.shutdown().await;
        Ok(done)
    }

    /// 원격 파일/빈 디렉토리 삭제.
    pub async fn remove(&self, host_id: &str, path: &str, is_dir: bool) -> Result<(), SshError> {
        let conn = self.conn(host_id).await?;
        if is_dir {
            conn.sftp
                .remove_dir(path)
                .await
                .map_err(|e| SshError::Channel(format!("rmdir {path}: {e}")))
        } else {
            conn.sftp
                .remove_file(path)
                .await
                .map_err(|e| SshError::Channel(format!("rm {path}: {e}")))
        }
    }

    pub async fn rename(&self, host_id: &str, from: &str, to: &str) -> Result<(), SshError> {
        let conn = self.conn(host_id).await?;
        conn.sftp
            .rename(from, to)
            .await
            .map_err(|e| SshError::Channel(format!("rename: {e}")))
    }

    pub async fn mkdir(&self, host_id: &str, path: &str) -> Result<(), SshError> {
        let conn = self.conn(host_id).await?;
        conn.sftp
            .create_dir(path)
            .await
            .map_err(|e| SshError::Channel(format!("mkdir {path}: {e}")))
    }

    /// 빈 파일 생성 (touch). 이미 있으면 truncate.
    pub async fn touch(&self, host_id: &str, path: &str) -> Result<(), SshError> {
        use tokio::io::AsyncWriteExt;
        let conn = self.conn(host_id).await?;
        let mut f = conn
            .sftp
            .create(path)
            .await
            .map_err(|e| SshError::Channel(format!("touch {path}: {e}")))?;
        let _ = f.flush().await;
        let _ = f.shutdown().await;
        Ok(())
    }

    /// POSIX 권한 변경 (chmod). mode는 8진수 비트 (예: 0o755).
    pub async fn chmod(&self, host_id: &str, path: &str, mode: u32) -> Result<(), SshError> {
        let conn = self.conn(host_id).await?;
        let attrs = russh_sftp::protocol::FileAttributes {
            permissions: Some(mode),
            ..Default::default()
        };
        conn.sftp
            .set_metadata(path, attrs)
            .await
            .map_err(|e| SshError::Channel(format!("chmod {path}: {e}")))?;
        Ok(())
    }

    /// 텍스트 미리보기용. 최대 max_bytes까지 읽어 UTF-8(lossy)로 반환 (바이너리도 안전).
    pub async fn read_text(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> Result<String, SshError> {
        use tokio::io::AsyncReadExt;
        let conn = self.conn(host_id).await?;
        let rf = conn
            .sftp
            .open(path)
            .await
            .map_err(|e| SshError::Channel(format!("open {path}: {e}")))?;
        let mut buf = Vec::new();
        rf.take(max_bytes)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| SshError::Io(format!("read {path}: {e}")))?;
        Ok(String::from_utf8_lossy(&buf).to_string())
    }

    /// 텍스트를 원격 파일에 쓴다 (빠른 편집 저장용). 기존 내용을 덮어쓴다(truncate).
    pub async fn write_text(
        &self,
        host_id: &str,
        path: &str,
        content: &str,
    ) -> Result<(), SshError> {
        use tokio::io::AsyncWriteExt;
        let conn = self.conn(host_id).await?;
        let mut rf = conn
            .sftp
            .create(path)
            .await
            .map_err(|e| SshError::Channel(format!("create {path}: {e}")))?;
        rf.write_all(content.as_bytes())
            .await
            .map_err(|e| SshError::Channel(format!("write {path}: {e}")))?;
        let _ = rf.flush().await;
        let _ = rf.shutdown().await;
        Ok(())
    }

    /// 원격 파일을 최대 max_bytes까지 읽어 base64로 반환 (이미지 미리보기용).
    /// 파일이 max_bytes보다 크면 too-large 에러.
    pub async fn read_bytes_base64(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> Result<String, SshError> {
        use base64::Engine;
        use tokio::io::AsyncReadExt;
        let conn = self.conn(host_id).await?;
        let rf = conn
            .sftp
            .open(path)
            .await
            .map_err(|e| SshError::Channel(format!("open {path}: {e}")))?;
        // max_bytes+1까지 읽어 초과 여부를 판별.
        let mut buf = Vec::new();
        rf.take(max_bytes + 1)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| SshError::Io(format!("read {path}: {e}")))?;
        if buf.len() as u64 > max_bytes {
            return Err(SshError::Io(format!(
                "file too large to preview (> {} bytes)",
                max_bytes
            )));
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
    }

    pub async fn disconnect(&self, host_id: &str) {
        self.conns.lock().await.remove(host_id);
    }

    /// root에서 이름에 query(대소문자 무시 substring)가 포함된 항목을 검색.
    /// recursive면 하위 디렉토리도 BFS로 탐색 (깊이/결과 수 제한). 권한 없는 디렉토리는 skip.
    pub async fn search(
        &self,
        host_id: &str,
        root: &str,
        query: &str,
        recursive: bool,
        max_results: usize,
    ) -> Result<Vec<SearchHit>, SshError> {
        let conn = self.conn(host_id).await?;
        let q = query.to_lowercase();
        let max_depth = if recursive { 8 } else { 0 };
        let mut hits: Vec<SearchHit> = Vec::new();
        let mut queue: Vec<(String, usize)> = vec![(root.to_string(), 0)];

        while let Some((dir, depth)) = queue.pop() {
            if hits.len() >= max_results {
                break;
            }
            let entries = match conn.sftp.read_dir(&dir).await {
                Ok(e) => e,
                Err(_) => continue, // 권한 없는 디렉토리 등은 건너뜀
            };
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let meta = entry.metadata();
                let is_dir = meta.is_dir();
                let path = if dir.ends_with('/') {
                    format!("{dir}{name}")
                } else {
                    format!("{dir}/{name}")
                };
                if !q.is_empty() && name.to_lowercase().contains(&q) {
                    hits.push(SearchHit {
                        path: path.clone(),
                        name: name.clone(),
                        is_dir,
                        size: meta.size.unwrap_or(0),
                    });
                    if hits.len() >= max_results {
                        break;
                    }
                }
                if is_dir && depth < max_depth {
                    queue.push((path, depth + 1));
                }
            }
        }
        Ok(hits)
    }
}
