//! SFTP 세션 관리 (S-025~037). SSH 연결 위에 sftp subsystem 채널을 열어
//! 원격 디렉토리 리스팅 / 파일 전송을 수행한다.
//!
//! 연결은 호스트 ID별로 캐시한다 (PTY 세션과 별개의 채널).

use std::collections::HashMap;
use std::sync::Arc;

use russh_sftp::client::{RawSftpSession, SftpSession};
use serde::Serialize;
use tokio::sync::Mutex;

use super::files::{self, Fs as _};
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
    handle: russh::client::Handle<TofuHandler>,
    /// `posix-rename@openssh.com`을 보낼 두 번째 SFTP 채널(#166). 고수준 SftpSession은 확장
    /// 요청을 노출하지 않아 처음 저장할 때 따로 연다. 안쪽 None = 서버가 확장을 지원하지 않음.
    ext: tokio::sync::OnceCell<Option<Arc<RawSftpSession>>>,
    /// 접속한 사용자의 uid(홈 폴더 소유자로 추정) — 쓰기 가능 추정용.
    my_uid: tokio::sync::OnceCell<Option<u32>>,
}

/// 전송 진행 콜백: (transfer_id, transferred_bytes, total_bytes).
pub type ProgressSink = Arc<dyn Fn(String, u64, u64) + Send + Sync>;

/// 원격(신뢰 불가) readdir 이름이 로컬 경로에 안전하게 조인될 수 있는 **단일 경로
/// 구성요소**인지 검사한다. 빈 문자열/`.`/`..`/구분자 포함/절대경로/다중 컴포넌트를
/// 모두 거부해 경로 이탈(Zip-Slip류) 다운로드를 막는다(#136).
fn is_safe_component(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    // std 관점에서도 정확히 1개의 Normal 컴포넌트여야 한다(절대경로/RootDir/prefix 배제).
    let mut comps = std::path::Path::new(name).components();
    match (comps.next(), comps.next()) {
        (Some(std::path::Component::Normal(_)), None) => true,
        _ => false,
    }
}

/// size 바이트를 최대 workers개의 **연속·비중첩** 구간 [start,end)으로 나눈다. 병렬 다운로드가
/// 각 구간을 별도 File 핸들로 스트리밍한다. 구간들은 정확히 [0,size) 전체를 덮는다(#151).
fn split_ranges(size: u64, workers: u64) -> Vec<(u64, u64)> {
    if size == 0 {
        return Vec::new();
    }
    let w = workers.max(1);
    let part = ((size + w - 1) / w).max(1);
    let mut ranges = Vec::new();
    let mut start = 0u64;
    while start < size {
        let end = (start + part).min(size);
        ranges.push((start, end));
        start = end;
    }
    ranges
}

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
            handle,
            ext: tokio::sync::OnceCell::new(),
            my_uid: tokio::sync::OnceCell::new(),
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

    /// 편집 탭 파일 연산용 원격 파일시스템(#166). 연결돼 있어야 한다(sftp_open 이후).
    pub async fn fs(&self, host_id: &str) -> Result<RemoteFs, SshError> {
        Ok(RemoteFs {
            conn: self.conn(host_id).await?,
        })
    }

    async fn conn(&self, host_id: &str) -> Result<Arc<SftpConn>, SshError> {
        self.conns
            .lock()
            .await
            .get(host_id)
            .cloned()
            .ok_or_else(|| SshError::NotFound(host_id.into()))
    }

    /// 원격 → 로컬. 파일이면 단일 스트리밍, 디렉토리면 재귀 다운로드(#135).
    /// 진행 이벤트는 전체 바이트 기준 누적으로 보고한다. 다운로드한 바이트 수 반환.
    pub async fn download(
        &self,
        host_id: &str,
        remote: &str,
        local: &str,
        transfer_id: &str,
    ) -> Result<u64, SshError> {
        let conn = self.conn(host_id).await?;
        let meta = conn
            .sftp
            .metadata(remote)
            .await
            .map_err(|e| SshError::Channel(format!("stat {remote}: {e}")))?;
        if meta.is_dir() {
            // 원격 트리를 훑어 (파일 목록, 총 바이트)을 먼저 수집한 뒤 순차 다운로드.
            // 악성 서버의 무한/과대 트리(심링크 루프 포함)로 인한 자원 고갈을 막기 위해
            // 깊이·엔트리 수에 상한을 둔다(#136). search()의 max_depth와 같은 방어.
            const MAX_DEPTH: usize = 64;
            const MAX_ENTRIES: usize = 200_000;
            let mut files: Vec<(String, String, u64)> = Vec::new();
            let mut seen: usize = 0;
            tokio::fs::create_dir_all(local)
                .await
                .map_err(|e| SshError::Io(format!("mkdir {local}: {e}")))?;
            let mut stack = vec![(remote.to_string(), local.to_string(), 0usize)];
            while let Some((rdir, ldir, depth)) = stack.pop() {
                let entries = conn
                    .sftp
                    .read_dir(&rdir)
                    .await
                    .map_err(|e| SshError::Channel(format!("read_dir {rdir}: {e}")))?;
                for e in entries {
                    let name = e.file_name();
                    // 보안(경로 이탈 방지): readdir 엔트리는 반드시 단일 경로 구성요소다.
                    // 악의적 SFTP 서버가 "..", "/etc/x", "a/../b" 같은 이름을 응답하면
                    // Path::join이 대상 폴더 밖(절대경로면 통째로 대체)에 파일을 쓰게 되는
                    // Zip-Slip류 취약점이 된다. 구성요소가 정확히 1개가 아니면 스킵한다(#136).
                    if !is_safe_component(&name) {
                        continue;
                    }
                    seen += 1;
                    if seen > MAX_ENTRIES {
                        return Err(SshError::Channel(format!(
                            "directory tree too large (> {MAX_ENTRIES} entries) — aborting"
                        )));
                    }
                    let rp = format!("{}/{}", rdir.trim_end_matches('/'), name);
                    let lp = std::path::Path::new(&ldir)
                        .join(&name)
                        .to_string_lossy()
                        .to_string();
                    let m = e.metadata();
                    if m.is_dir() {
                        // 깊이 상한 초과 시 더 내려가지 않는다(심링크 루프 방어).
                        if depth >= MAX_DEPTH {
                            continue;
                        }
                        tokio::fs::create_dir_all(&lp)
                            .await
                            .map_err(|e| SshError::Io(format!("mkdir {lp}: {e}")))?;
                        stack.push((rp, lp, depth + 1));
                    } else {
                        files.push((rp, lp, m.size.unwrap_or(0)));
                    }
                }
            }
            let total: u64 = files.iter().map(|f| f.2).sum();
            let mut done: u64 = 0;
            (self.progress)(transfer_id.to_string(), 0, total);
            for (rp, lp, sz) in files {
                done += self
                    .stream_download(&conn, &rp, &lp, transfer_id, done, total, sz)
                    .await?;
            }
            Ok(done)
        } else {
            let total = meta.size.unwrap_or(0);
            (self.progress)(transfer_id.to_string(), 0, total);
            self.stream_download(&conn, remote, local, transfer_id, 0, total, total)
                .await
        }
    }

    /// 단일 원격 파일을 로컬로 스트리밍. 진행은 (base + 파일내 누적) / total 로 보고.
    ///
    /// 파일이 충분히 크면 **연속 구간 N개를 동시에** 내려받아 SFTP READ를 파이프라인한다.
    /// russh_sftp의 File AsyncRead는 한 번에 요청이 하나뿐(순차)이라, 고지연 링크에서
    /// 처리량이 read_len/RTT로 묶인다(#151). 파일을 구간으로 나눠 각 구간을 별도 File
    /// 핸들로 스트리밍하면 동시에 N개의 READ가 떠서 파이프가 찬다. 작은/크기 미상 파일은
    /// 구간 분할 이득이 없으므로(미상이면 나눌 수도 없다) 순차 스트리밍으로 폴백한다.
    async fn stream_download(
        &self,
        conn: &Arc<SftpConn>,
        remote: &str,
        local: &str,
        transfer_id: &str,
        base: u64,
        total: u64,
        size: u64,
    ) -> Result<u64, SshError> {
        use std::sync::atomic::{AtomicU64, Ordering};
        use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

        const WORKERS: u64 = 8;
        const CHUNK: usize = 256 * 1024;
        const MIN_PARALLEL: u64 = 512 * 1024;

        if size < MIN_PARALLEL {
            return self
                .stream_download_seq(conn, remote, local, transfer_id, base, total)
                .await;
        }

        // 로컬 파일을 미리 size로 확장(각 워커가 자기 구간에만 순차 기록하므로 겹치지 않는다).
        let out = tokio::fs::File::create(local)
            .await
            .map_err(|e| SshError::Io(format!("create {local}: {e}")))?;
        out.set_len(size)
            .await
            .map_err(|e| SshError::Io(format!("alloc {local}: {e}")))?;
        drop(out);

        // WORKERS개 연속 구간으로 분할(겹침 없이 [0,size) 전체를 덮는다).
        let ranges = split_ranges(size, WORKERS);

        let done = Arc::new(AtomicU64::new(0));
        let mut handles = Vec::with_capacity(ranges.len());
        for (rstart, rend) in ranges {
            let conn = conn.clone();
            let remote = remote.to_string();
            let local = local.to_string();
            let done = done.clone();
            let progress = self.progress.clone();
            let tid = transfer_id.to_string();
            handles.push(tokio::spawn(async move {
                let mut rf = conn
                    .sftp
                    .open(&remote)
                    .await
                    .map_err(|e| SshError::Channel(format!("open {remote}: {e}")))?;
                rf.seek(std::io::SeekFrom::Start(rstart))
                    .await
                    .map_err(|e| SshError::Io(format!("seek {remote}: {e}")))?;
                let mut lf = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(&local)
                    .await
                    .map_err(|e| SshError::Io(format!("open {local}: {e}")))?;
                lf.seek(std::io::SeekFrom::Start(rstart))
                    .await
                    .map_err(|e| SshError::Io(format!("seek {local}: {e}")))?;
                let mut buf = vec![0u8; CHUNK];
                let mut pos = rstart;
                while pos < rend {
                    let want = ((rend - pos) as usize).min(CHUNK);
                    let n = rf
                        .read(&mut buf[..want])
                        .await
                        .map_err(|e| SshError::Io(format!("read {remote}: {e}")))?;
                    if n == 0 {
                        break; // 예기치 못한 EOF(원격 파일 축소 등) — 이 구간 종료.
                    }
                    lf.write_all(&buf[..n])
                        .await
                        .map_err(|e| SshError::Io(format!("write {local}: {e}")))?;
                    pos += n as u64;
                    let total_done = done.fetch_add(n as u64, Ordering::Relaxed) + n as u64;
                    progress(tid.clone(), base + total_done, total);
                }
                let _ = lf.flush().await;
                Ok::<(), SshError>(())
            }));
        }

        for h in handles {
            h.await
                .map_err(|e| SshError::Io(format!("download task join: {e}")))??;
        }
        Ok(done.load(Ordering::Relaxed))
    }

    /// 순차 스트리밍 폴백(작은/크기 미상 파일). EOF까지 읽어 크기를 몰라도 안전하다.
    async fn stream_download_seq(
        &self,
        conn: &Arc<SftpConn>,
        remote: &str,
        local: &str,
        transfer_id: &str,
        base: u64,
        total: u64,
    ) -> Result<u64, SshError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut rf = conn
            .sftp
            .open(remote)
            .await
            .map_err(|e| SshError::Channel(format!("open {remote}: {e}")))?;
        let mut out = tokio::fs::File::create(local)
            .await
            .map_err(|e| SshError::Io(format!("create {local}: {e}")))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut done: u64 = 0;
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
            (self.progress)(transfer_id.to_string(), base + done, total);
        }
        let _ = out.flush().await;
        Ok(done)
    }

    /// 로컬 → 원격. 파일이면 단일 스트리밍, 디렉토리면 재귀 업로드(#135).
    /// 진행 이벤트는 전체 바이트 기준 누적으로 보고한다. 업로드한 바이트 수 반환.
    pub async fn upload(
        &self,
        host_id: &str,
        local: &str,
        remote: &str,
        transfer_id: &str,
    ) -> Result<u64, SshError> {
        let conn = self.conn(host_id).await?;
        let meta = tokio::fs::metadata(local)
            .await
            .map_err(|e| SshError::Io(format!("stat {local}: {e}")))?;
        if meta.is_dir() {
            // 로컬 트리를 훑어 (파일 목록, 총 바이트)을 먼저 수집한 뒤 순차 업로드.
            let mut files: Vec<(String, String, u64)> = Vec::new();
            // 원격 루트 디렉토리 생성(이미 있으면 무시).
            let _ = conn.sftp.create_dir(remote).await;
            let mut stack = vec![(local.to_string(), remote.to_string())];
            while let Some((ldir, rdir)) = stack.pop() {
                let mut rd = tokio::fs::read_dir(&ldir)
                    .await
                    .map_err(|e| SshError::Io(format!("read_dir {ldir}: {e}")))?;
                while let Some(ent) = rd
                    .next_entry()
                    .await
                    .map_err(|e| SshError::Io(format!("read_dir {ldir}: {e}")))?
                {
                    let name = ent.file_name().to_string_lossy().to_string();
                    let lp = ent.path().to_string_lossy().to_string();
                    let rp = format!("{}/{}", rdir.trim_end_matches('/'), name);
                    let ft = ent
                        .file_type()
                        .await
                        .map_err(|e| SshError::Io(format!("stat {lp}: {e}")))?;
                    if ft.is_dir() {
                        let _ = conn.sftp.create_dir(&rp).await;
                        stack.push((lp, rp));
                    } else if ft.is_file() {
                        let sz = ent.metadata().await.map(|m| m.len()).unwrap_or(0);
                        files.push((lp, rp, sz));
                    }
                    // 심볼릭 링크 등은 건너뛴다.
                }
            }
            let total: u64 = files.iter().map(|f| f.2).sum();
            let mut done: u64 = 0;
            (self.progress)(transfer_id.to_string(), 0, total);
            for (lp, rp, _sz) in files {
                done += self
                    .stream_upload(&conn, &lp, &rp, transfer_id, done, total)
                    .await?;
            }
            Ok(done)
        } else {
            let total = meta.len();
            (self.progress)(transfer_id.to_string(), 0, total);
            self.stream_upload(&conn, local, remote, transfer_id, 0, total)
                .await
        }
    }

    /// 단일 로컬 파일을 원격으로 스트리밍. 진행은 (base + 파일내 누적) / total 로 보고.
    async fn stream_upload(
        &self,
        conn: &Arc<SftpConn>,
        local: &str,
        remote: &str,
        transfer_id: &str,
        base: u64,
        total: u64,
    ) -> Result<u64, SshError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut inp = tokio::fs::File::open(local)
            .await
            .map_err(|e| SshError::Io(format!("open {local}: {e}")))?;
        let mut rf = conn
            .sftp
            .create(remote)
            .await
            .map_err(|e| SshError::Channel(format!("create {remote}: {e}")))?;
        // russh_sftp File은 쓰기를 파이프라인하므로(write_nowait) 버퍼만 키우면 왕복이 준다.
        let mut buf = vec![0u8; 256 * 1024];
        let mut done: u64 = 0;
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
            (self.progress)(transfer_id.to_string(), base + done, total);
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
        // empty()에서 시작해야 한다: FileAttributes::default()는 size=0·uid/gid=0·mtime=0을 담아
        // 서버가 파일을 비우고 소유자·시각까지 바꾸려 든다(#167).
        let attrs = russh_sftp::protocol::FileAttributes {
            permissions: Some(mode),
            ..russh_sftp::protocol::FileAttributes::empty()
        };
        conn.sftp
            .set_metadata(path, attrs)
            .await
            .map_err(|e| SshError::Channel(format!("chmod {path}: {e}")))?;
        Ok(())
    }

    /// 파일 앞부분을 최대 max_bytes까지 바이트로 읽는다(편집용 판정은 textfile::classify).
    pub async fn read_prefix(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> Result<Vec<u8>, SshError> {
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
        Ok(buf)
    }

    /// 경로에 무엇이든(심볼릭 링크 포함) 있는지. 링크를 따라가지 않는다(lstat) — 끊긴 링크도
    /// "있음"으로 봐야 그 위로 create()해서 링크 너머에 쓰는 일이 없다(#165).
    pub async fn exists_nofollow(&self, host_id: &str, path: &str) -> Result<bool, SshError> {
        use russh_sftp::client::error::Error;
        use russh_sftp::protocol::StatusCode;
        let conn = self.conn(host_id).await?;
        match conn.sftp.symlink_metadata(path).await {
            Ok(_) => Ok(true),
            Err(Error::Status(st)) if st.status_code == StatusCode::NoSuchFile => Ok(false),
            Err(e) => Err(SshError::Channel(format!("lstat {path}: {e}"))),
        }
    }

    /// `dir/name`이 이미 있으면 "이름 (1).확장자"처럼 비어 있는 이름을 찾아 전체 경로를 돌려준다.
    /// 충돌 창 없이 올리는 경로(터미널 드롭)가 덮어쓰지 않게 한다(#165).
    pub async fn free_path(
        &self,
        host_id: &str,
        dir: &str,
        name: &str,
    ) -> Result<String, SshError> {
        let dir = dir.trim_end_matches('/');
        let mut path = format!("{dir}/{name}");
        let mut n = 0;
        while self.exists_nofollow(host_id, &path).await? {
            n += 1;
            if n > 999 {
                return Err(SshError::Channel(format!(
                    "no free name for {name:?} in {dir}"
                )));
            }
            path = format!("{dir}/{}", super::textfile::numbered_name(name, n));
        }
        Ok(path)
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

#[cfg(test)]
mod tests {
    use super::{is_safe_component, split_ranges};

    /// split_ranges는 [0,size)를 겹침 없이 빈틈없이 덮어야 한다(#151 — 병렬 다운로드 무결성).
    fn assert_covers(size: u64, workers: u64) {
        let r = split_ranges(size, workers);
        if size == 0 {
            assert!(r.is_empty());
            return;
        }
        assert_eq!(r.first().unwrap().0, 0, "first range must start at 0");
        assert_eq!(r.last().unwrap().1, size, "last range must end at size");
        assert!(r.len() as u64 <= workers.max(1), "no more than `workers` ranges");
        let mut prev_end = 0u64;
        let mut total = 0u64;
        for (s, e) in &r {
            assert_eq!(*s, prev_end, "ranges must be contiguous");
            assert!(*e > *s, "ranges must be non-empty");
            total += e - s;
            prev_end = *e;
        }
        assert_eq!(total, size, "ranges must cover exactly `size` bytes");
    }

    #[test]
    fn split_ranges_covers_without_gaps_or_overlap() {
        for &size in &[1u64, 2, 7, 8, 9, 1023, 1024, 1025, 100_000, 8 * 1024 * 1024 + 3] {
            for &workers in &[1u64, 2, 3, 4, 8, 16] {
                assert_covers(size, workers);
            }
        }
    }

    #[test]
    fn split_ranges_empty_for_zero_size() {
        assert!(split_ranges(0, 8).is_empty());
    }

    #[test]
    fn split_ranges_at_most_one_range_when_smaller_than_workers() {
        // size < workers: 각 구간 1바이트, 구간 수는 size개(=workers 이하).
        let r = split_ranges(3, 8);
        assert_eq!(r, vec![(0, 1), (1, 2), (2, 3)]);
    }

    #[test]
    fn safe_component_accepts_normal_names() {
        for ok in ["file.txt", "폴더", "a.tar.gz", "with space", ".hidden", "..foo", "foo.."] {
            assert!(is_safe_component(ok), "should accept {ok:?}");
        }
    }

    #[test]
    fn safe_component_rejects_traversal_and_separators() {
        for bad in [
            "", ".", "..",
            "../etc", "a/b", "foo/../bar",
            "/etc/passwd", "/", "\\", "a\\b", "C:\\x",
        ] {
            assert!(!is_safe_component(bad), "should reject {bad:?}");
        }
    }
}

/// SFTP 위의 [`files::Fs`] 구현(#166).
pub struct RemoteFs {
    conn: Arc<SftpConn>,
}

fn sftp_code(e: &russh_sftp::client::error::Error) -> Option<russh_sftp::protocol::StatusCode> {
    match e {
        russh_sftp::client::error::Error::Status(st) => Some(st.status_code),
        _ => None,
    }
}

fn remote_stat(m: &russh_sftp::protocol::FileAttributes) -> files::Stat {
    files::Stat {
        size: m.size.unwrap_or(0),
        mtime: m.mtime.map(|t| t as i64),
        mode: m.permissions,
        uid: m.uid,
        is_dir: m.is_dir(),
        is_symlink: m.is_symlink(),
        nlink: None,
    }
}

impl RemoteFs {
    fn missing_ok(
        r: Result<russh_sftp::protocol::FileAttributes, russh_sftp::client::error::Error>,
        path: &str,
    ) -> Result<Option<files::Stat>, String> {
        match r {
            Ok(m) => Ok(Some(remote_stat(&m))),
            Err(e) if sftp_code(&e) == Some(russh_sftp::protocol::StatusCode::NoSuchFile) => {
                Ok(None)
            }
            Err(e) => Err(format!("{path}: {e}")),
        }
    }

    async fn ext(&self) -> Option<Arc<RawSftpSession>> {
        self.conn
            .ext
            .get_or_init(|| async {
                let ch = self.conn.handle.channel_open_session().await.ok()?;
                ch.request_subsystem(true, "sftp").await.ok()?;
                let raw = RawSftpSession::new(ch.into_stream());
                let v = raw.init().await.ok()?;
                (v.extensions
                    .get("posix-rename@openssh.com")
                    .map(String::as_str)
                    == Some("1"))
                .then(|| Arc::new(raw))
            })
            .await
            .clone()
    }

    async fn my_uid(&self) -> Option<u32> {
        *self
            .conn
            .my_uid
            .get_or_init(|| async { self.conn.sftp.metadata(".").await.ok().and_then(|m| m.uid) })
            .await
    }

    /// 링크를 따라가지 않고 훑는다. (파일·링크 경로들, 폴더 경로들(발견 순), 잘렸는지)
    async fn walk(&self, root: &str) -> Result<(Vec<String>, Vec<String>, bool), String> {
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        let top = self
            .lstat(root)
            .await?
            .ok_or_else(|| format!("{root}: no such file"))?;
        if !top.is_dir {
            files.push(root.to_string());
            return Ok((files, dirs, false));
        }
        let mut stack = vec![(root.trim_end_matches('/').to_string(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            dirs.push(dir.clone());
            if (files.len() + dirs.len()) as u64 >= 200_000 || depth >= 64 {
                return Ok((files, dirs, true));
            }
            let entries = self
                .conn
                .sftp
                .read_dir(&dir)
                .await
                .map_err(|e| format!("{dir}: {e}"))?;
            for e in entries {
                let name = e.file_name();
                if !is_safe_component(&name) {
                    continue;
                }
                let child = format!("{dir}/{name}");
                let m = e.metadata();
                if m.is_dir() && !m.is_symlink() {
                    stack.push((child, depth + 1));
                } else {
                    files.push(child);
                }
            }
        }
        Ok((files, dirs, false))
    }
}

#[async_trait::async_trait]
impl files::Fs for RemoteFs {
    async fn stat(&self, path: &str) -> Result<Option<files::Stat>, String> {
        Self::missing_ok(self.conn.sftp.metadata(path).await, path)
    }
    async fn lstat(&self, path: &str) -> Result<Option<files::Stat>, String> {
        Self::missing_ok(self.conn.sftp.symlink_metadata(path).await, path)
    }
    async fn realpath(&self, path: &str) -> Result<String, String> {
        self.conn
            .sftp
            .canonicalize(path)
            .await
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn read(&self, path: &str, max: u64) -> Result<Vec<u8>, String> {
        use tokio::io::AsyncReadExt;
        let f = self
            .conn
            .sftp
            .open(path)
            .await
            .map_err(|e| format!("{path}: {e}"))?;
        let mut buf = Vec::new();
        f.take(max)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| format!("{path}: {e}"))?;
        Ok(buf)
    }
    async fn writable(&self, _path: &str, st: &files::Stat) -> bool {
        // SFTP로는 접근 권한을 직접 물을 수 없다(쓰기로 열어 보면 감시 도구에 close_write 이벤트가
        // 생긴다). 권한 비트로 추정하되 그룹 소속은 알 수 없어 낙관적으로 본다 — 틀리면 저장이
        // 실패할 뿐 내용은 그대로다(화면 기획서 SC-06).
        let mode = st.mode.unwrap_or(0o777);
        let me = self.my_uid().await;
        if me == Some(0) {
            return true;
        }
        match (st.uid, me) {
            (Some(owner), Some(me)) if owner == me => mode & 0o200 != 0,
            (Some(_), Some(_)) => mode & 0o022 != 0,
            _ => mode & 0o222 != 0,
        }
    }
    async fn create_new(&self, path: &str, data: &[u8]) -> Result<(), files::CreateErr> {
        use russh_sftp::protocol::{OpenFlags, StatusCode};
        use tokio::io::AsyncWriteExt;
        let mut f = self
            .conn
            .sftp
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| match sftp_code(&e) {
                Some(StatusCode::PermissionDenied) => files::CreateErr::Denied,
                _ => files::CreateErr::Other(format!("{path}: {e}")),
            })?;
        let r = async {
            f.write_all(data).await?;
            f.flush().await?;
            let _ = f.sync_all().await;
            f.shutdown().await
        }
        .await;
        r.map_err(|e| files::CreateErr::Other(format!("{path}: {e}")))
    }
    async fn write_truncate(&self, path: &str, data: &[u8]) -> Result<(), String> {
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::AsyncWriteExt;
        let mut f = self
            .conn
            .sftp
            .open_with_flags(path, OpenFlags::WRITE | OpenFlags::TRUNCATE)
            .await
            .map_err(|e| format!("{path}: {e}"))?;
        let r = async {
            f.write_all(data).await?;
            f.flush().await?;
            let _ = f.sync_all().await;
            f.shutdown().await
        }
        .await;
        r.map_err(|e| format!("{path}: {e}"))
    }
    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), String> {
        let attrs = russh_sftp::protocol::FileAttributes {
            permissions: Some(mode),
            ..russh_sftp::protocol::FileAttributes::empty()
        };
        self.conn
            .sftp
            .set_metadata(path, attrs)
            .await
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn replace(&self, from: &str, to: &str) -> Result<bool, String> {
        use russh_sftp::protocol::{Packet, StatusCode};
        let Some(raw) = self.ext().await else {
            return Ok(false);
        };
        let mut data = Vec::new();
        for s in [from, to] {
            data.extend_from_slice(&(s.len() as u32).to_be_bytes());
            data.extend_from_slice(s.as_bytes());
        }
        match raw.extended("posix-rename@openssh.com", data).await {
            Ok(Packet::Status(st)) if st.status_code == StatusCode::Ok => Ok(true),
            // 광고해 놓고 거부하는 서버 — 백업 이름을 거치는 교체로 넘어간다.
            Ok(Packet::Status(st)) if st.status_code == StatusCode::OpUnsupported => Ok(false),
            Ok(Packet::Status(st)) => Err(format!("{to}: {}", st.error_message)),
            Ok(_) => Err(format!("{to}: unexpected posix-rename reply")),
            Err(e) => Err(format!("{to}: {e}")),
        }
    }
    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.conn
            .sftp
            .rename(from, to)
            .await
            .map_err(|e| format!("{to}: {e}"))
    }
    async fn remove_file(&self, path: &str) -> Result<(), String> {
        self.conn
            .sftp
            .remove_file(path)
            .await
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn mkdir(&self, path: &str) -> Result<(), String> {
        self.conn
            .sftp
            .create_dir(path)
            .await
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn remove_tree(&self, path: &str) -> Result<(u64, u64), String> {
        let (files, dirs, truncated) = self.walk(path).await?;
        if truncated {
            return Err(format!("{path}: too many entries to delete safely"));
        }
        for f in &files {
            self.remove_file(f).await?;
        }
        // 발견 순의 역순 = 자식 폴더가 부모보다 먼저.
        for d in dirs.iter().rev() {
            self.conn
                .sftp
                .remove_dir(d)
                .await
                .map_err(|e| format!("{d}: {e}"))?;
        }
        Ok((files.len() as u64, dirs.len() as u64))
    }
    async fn count_tree(&self, path: &str) -> Result<(u64, u64, bool), String> {
        let (files, dirs, truncated) = self.walk(path).await?;
        Ok((files.len() as u64, dirs.len() as u64, truncated))
    }
}

/// 실제 SFTP 서버 대상 e2e (#165) — 기본 무시. 아무 비밀번호나 받는 로컬 SFTP 서버를 띄운 뒤
/// `WT_TEST_SFTP_PORT=<포트> WT_TEST_SFTP_ROOT=<서버 루트> cargo test --lib sftp_e2e -- --ignored`.
/// 서버 루트는 테스트가 직접 파일을 만들고 확인하는 로컬 디렉터리(서버가 chroot로 내보내는 곳)다.
#[cfg(test)]
mod e2e {
    use super::*;
    use crate::ssh::types::SshAuthMethod;

    async fn connect() -> (SftpManager, std::path::PathBuf, tempfile::TempDir) {
        let port: u16 = std::env::var("WT_TEST_SFTP_PORT").unwrap().parse().unwrap();
        let root = std::path::PathBuf::from(std::env::var("WT_TEST_SFTP_ROOT").unwrap());
        let dir = tempfile::tempdir().unwrap();
        let ks = Arc::new(KnownHostsStore::new(dir.path().join("known_hosts.toml")));
        let mgr = SftpManager::new(Arc::clone(&ks), Arc::new(|_, _, _| {}));
        let host = SshHost {
            id: "e2e".into(),
            name: "e2e".into(),
            host: "127.0.0.1".into(),
            port,
            user: "test".into(),
            auth: SshAuthMethod::PasswordPrompt,
            tags: vec![],
            group_id: None,
            proxy_jump: None,
            tmux_session: None,
        };
        let pw = || ResolvedAuth::Password("x".into());
        if let Err(SshError::FirstContactRequired {
            algorithm,
            fingerprint,
            ..
        }) = mgr.connect(&host, pw()).await
        {
            ks.record("127.0.0.1", port, &algorithm, &fingerprint)
                .unwrap();
        }
        mgr.connect(&host, pw()).await.expect("connect");
        (mgr, root, dir)
    }

    #[tokio::test]
    #[ignore]
    async fn sftp_e2e_free_path_never_overwrites() {
        let (mgr, root, _keep) = connect().await;
        let sub = root.join("drop");
        let _ = std::fs::remove_dir_all(&sub);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), "old").unwrap();
        std::fs::write(sub.join("a (1).txt"), "old1").unwrap();
        // 끊긴 심볼릭 링크도 "있음"이어야 링크 너머에 쓰지 않는다.
        std::os::unix::fs::symlink(root.join("outside.txt"), sub.join("b.txt")).unwrap();

        assert_eq!(
            mgr.free_path("e2e", "/drop/", "a.txt").await.unwrap(),
            "/drop/a (2).txt"
        );
        assert_eq!(
            mgr.free_path("e2e", "/drop", "b.txt").await.unwrap(),
            "/drop/b (1).txt"
        );
        assert_eq!(
            mgr.free_path("e2e", "/drop", "c.txt").await.unwrap(),
            "/drop/c.txt"
        );

        // 실제 업로드도 고른 이름으로 가고 원본은 그대로다.
        let local = _keep.path().join("a.txt");
        std::fs::write(&local, "new").unwrap();
        let dest = mgr.free_path("e2e", "/drop", "a.txt").await.unwrap();
        mgr.upload("e2e", local.to_str().unwrap(), &dest, "t")
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(sub.join("a.txt")).unwrap(), "old");
        assert_eq!(
            std::fs::read_to_string(sub.join("a (2).txt")).unwrap(),
            "new"
        );
        assert!(!root.join("outside.txt").exists());
    }

    #[tokio::test]
    #[ignore]
    async fn sftp_e2e_read_for_edit_flags_unsafe_files() {
        use crate::ssh::textfile::{classify, EDIT_LIMIT};
        let (mgr, root, _keep) = connect().await;
        let sub = root.join("edit");
        let _ = std::fs::remove_dir_all(&sub);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("big.txt"), vec![b'x'; EDIT_LIMIT + 10]).unwrap();
        std::fs::write(sub.join("crlf.txt"), "a\r\nb\r\n").unwrap();
        let read = |p: &'static str| {
            let mgr = &mgr;
            async move {
                classify(
                    mgr.read_prefix("e2e", p, EDIT_LIMIT as u64 + 1)
                        .await
                        .unwrap(),
                    EDIT_LIMIT,
                )
            }
        };
        let big = read("/edit/big.txt").await;
        assert_eq!(big.reason, Some("too_large"));
        assert!(!big.editable);
        let crlf = read("/edit/crlf.txt").await;
        assert!(crlf.editable);
        assert_eq!(crlf.eol, "crlf");
    }

    /// 편집 탭 저장(#166): 원자적 교체(또는 WT_TEST_SFTP_SWAP=1이면 posix-rename을 거부하는
    /// 서버에서 백업 이름 교체), 권한 유지, 임시 파일 정리, 충돌 감지, 링크.
    #[tokio::test]
    #[ignore]
    async fn sftp_e2e_editor_save() {
        use crate::ssh::files::{self, SaveMethod, SaveOutcome};
        use std::os::unix::fs::PermissionsExt;
        let (mgr, root, _keep) = connect().await;
        let swap = std::env::var("WT_TEST_SFTP_SWAP").is_ok();
        let sub = root.join("edit2");
        let _ = std::fs::remove_dir_all(&sub);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.conf"), "one\n").unwrap();
        std::fs::set_permissions(sub.join("a.conf"), std::fs::Permissions::from_mode(0o640))
            .unwrap();
        std::os::unix::fs::symlink("a.conf", sub.join("link.conf")).unwrap();
        let fs = mgr.fs("e2e").await.unwrap();

        let o = files::open(&fs, "/edit2/a.conf").await.unwrap();
        assert!(o.editable, "{:?}", o.reason);
        let r = files::save(&fs, &o.real_path, "two\n", false, &o.stamp, false)
            .await
            .unwrap();
        let SaveOutcome::Saved { stamp, method } = r else {
            panic!("{r:?}")
        };
        assert_eq!(
            method,
            if swap {
                SaveMethod::Swap
            } else {
                SaveMethod::Atomic
            }
        );
        assert_eq!(
            std::fs::read_to_string(sub.join("a.conf")).unwrap(),
            "two\n"
        );
        let mode = std::fs::metadata(sub.join("a.conf"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o640, "mode must be preserved");
        let mut names: Vec<String> = std::fs::read_dir(&sub)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec!["a.conf", "link.conf"],
            "no temp/backup files left"
        );

        // 같은 크기로 바깥에서 바꾸면 해시로 충돌을 잡고, 쓰지 않는다.
        std::fs::write(sub.join("a.conf"), "TWO\n").unwrap();
        let r = files::save(&fs, &o.real_path, "333\n", false, &stamp, false)
            .await
            .unwrap();
        assert!(
            matches!(r, SaveOutcome::Conflict { current: Some(_) }),
            "{r:?}"
        );
        assert_eq!(
            std::fs::read_to_string(sub.join("a.conf")).unwrap(),
            "TWO\n"
        );

        // 링크로 열면 실제 파일에 저장하고 링크는 링크로 남는다.
        let l = files::open(&fs, "/edit2/link.conf").await.unwrap();
        println!("link real_path = {}", l.real_path);
        files::save(&fs, &l.real_path, "via link\n", false, &l.stamp, false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(sub.join("a.conf")).unwrap(),
            "via link\n"
        );
        assert!(std::fs::symlink_metadata(sub.join("link.conf"))
            .unwrap()
            .file_type()
            .is_symlink());

        // 쓰기 권한이 없는 내 파일은 읽기 전용으로 열린다.
        std::fs::write(sub.join("ro.txt"), "r").unwrap();
        std::fs::set_permissions(sub.join("ro.txt"), std::fs::Permissions::from_mode(0o444))
            .unwrap();
        let ro = files::open(&fs, "/edit2/ro.txt").await.unwrap();
        assert_eq!(ro.reason, Some("no_permission"));

        // 재귀 개수·삭제(링크는 따라가지 않는다).
        std::fs::create_dir_all(sub.join("t/u")).unwrap();
        std::fs::write(sub.join("t/u/f"), "f").unwrap();
        std::os::unix::fs::symlink(&sub, sub.join("t/loop")).unwrap();
        use crate::ssh::files::Fs;
        assert_eq!(fs.count_tree("/edit2/t").await.unwrap(), (2, 2, false));
        assert_eq!(fs.remove_tree("/edit2/t").await.unwrap(), (2, 2));
        assert!(!sub.join("t").exists());
        assert!(sub.join("a.conf").exists(), "link target untouched");
    }

    /// 권한 변경이 권한만 바꾸는지(#167). FileAttributes::default()는 빈 값이 아니라
    /// size=0·uid/gid=0·mtime=0을 담아, 그대로 보내면 서버가 파일을 비우고 시각을 1970으로 바꾼다.
    #[tokio::test]
    #[ignore]
    async fn sftp_e2e_chmod_changes_only_mode() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let (mgr, root, _keep) = connect().await;
        let sub = root.join("chmod");
        let _ = std::fs::remove_dir_all(&sub);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("x.txt"), "hello").unwrap();
        let before = std::fs::metadata(sub.join("x.txt")).unwrap().mtime();
        let r = mgr.chmod("e2e", "/chmod/x.txt", 0o600).await;
        let m = std::fs::metadata(sub.join("x.txt")).unwrap();
        println!(
            "chmod result: {r:?}; size={} mode={:o} mtime={}",
            m.len(),
            m.permissions().mode() & 0o777,
            m.mtime()
        );
        assert_eq!(
            std::fs::read_to_string(sub.join("x.txt")).unwrap(),
            "hello",
            "content must survive"
        );
        assert_eq!(m.mtime(), before, "mtime must not change");
        r.expect("chmod");
        assert_eq!(m.permissions().mode() & 0o777, 0o600);
    }
}
