//! PTY 세션 매니저.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type SessionId = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PtyDims {
    pub cols: u16,
    pub rows: u16,
}

impl Default for PtyDims {
    fn default() -> Self {
        Self { cols: 80, rows: 24 }
    }
}

impl From<PtyDims> for PtySize {
    fn from(d: PtyDims) -> Self {
        PtySize {
            cols: d.cols,
            rows: d.rows,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("session not found: {0}")]
    NotFound(SessionId),

    #[error("pty io: {0}")]
    Io(String),

    #[error("backend: {0}")]
    Backend(String),
}

/// 데이터 송신 콜백 — Tauri 환경에서는 event emit으로 연결되지만,
/// 테스트에서는 채널이나 버퍼에 모을 수 있도록 추상화.
pub type DataSink = Arc<dyn Fn(SessionId, Vec<u8>) + Send + Sync>;

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<SessionId, Session>>,
    sink: DataSink,
}

impl PtyManager {
    pub fn new(sink: DataSink) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sink,
        }
    }

    /// 새 PTY 세션을 시작한다. 셸 미지정 시 OS 기본 (Linux: $SHELL or /bin/bash, Windows: cmd.exe).
    pub fn spawn(
        &self,
        program: Option<&str>,
        dims: PtyDims,
    ) -> Result<SessionId, PtyError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(dims.into())
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let prog = program.map(|s| s.to_string()).unwrap_or_else(default_shell);
        let cmd = CommandBuilder::new(prog);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Backend(e.to_string()))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let session_id: SessionId = uuid::Uuid::new_v4().to_string();
        let session = Session {
            writer,
            master: pair.master,
            child,
        };
        self.sessions
            .lock()
            .expect("sessions mutex poisoned")
            .insert(session_id.clone(), session);

        // reader 스레드: master에서 읽은 바이트를 sink로 전달.
        let sink = Arc::clone(&self.sink);
        let id_for_thread = session_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => (sink)(id_for_thread.clone(), buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
        });

        Ok(session_id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut guard = self.sessions.lock().expect("sessions mutex poisoned");
        let session = guard
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound(id.into()))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::Io(e.to_string()))?;
        session
            .writer
            .flush()
            .map_err(|e| PtyError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, dims: PtyDims) -> Result<(), PtyError> {
        let guard = self.sessions.lock().expect("sessions mutex poisoned");
        let session = guard.get(id).ok_or_else(|| PtyError::NotFound(id.into()))?;
        session
            .master
            .resize(dims.into())
            .map_err(|e| PtyError::Backend(e.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let mut guard = self.sessions.lock().expect("sessions mutex poisoned");
        let mut session = guard
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.into()))?;
        let _ = session.child.kill();
        let _ = session.child.wait();
        Ok(())
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .expect("sessions mutex poisoned")
            .len()
    }
}

#[cfg(target_family = "unix")]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}

#[cfg(target_family = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
}

#[cfg(test)]
#[cfg(target_family = "unix")]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect_sink() -> (DataSink, mpsc::Receiver<(SessionId, Vec<u8>)>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: DataSink = Arc::new(move |id, data| {
            let _ = tx
                .lock()
                .expect("collect_sink tx poisoned")
                .send((id, data));
        });
        (sink, rx)
    }

    fn read_until_marker(
        rx: &mpsc::Receiver<(SessionId, Vec<u8>)>,
        marker: &str,
        timeout: Duration,
    ) -> String {
        let start = std::time::Instant::now();
        let mut acc = String::new();
        while start.elapsed() < timeout {
            match rx.recv_timeout(Duration::from_millis(300)) {
                Ok((_, bytes)) => {
                    acc.push_str(&String::from_utf8_lossy(&bytes));
                    if acc.contains(marker) {
                        return acc;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        acc
    }

    #[test]
    fn spawn_write_read_echo() {
        // /bin/sh로 단순한 echo를 시킨다. PTY 라인 에코 + 셸 출력 둘 다 잡아도 OK.
        let (sink, rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let id = mgr
            .spawn(Some("/bin/sh"), PtyDims { cols: 80, rows: 24 })
            .expect("spawn");
        assert_eq!(mgr.session_count(), 1);

        mgr.write(&id, b"echo wowterm-hello\nexit\n").expect("write");
        let out = read_until_marker(&rx, "wowterm-hello", Duration::from_secs(5));
        assert!(out.contains("wowterm-hello"), "no marker, got: {out}");

        // 자식 프로세스가 exit하면 reader 스레드는 자연 종료. kill은 멱등.
        let _ = mgr.kill(&id);
    }

    #[test]
    fn resize_unknown_session_returns_not_found() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let err = mgr
            .resize("nope", PtyDims { cols: 100, rows: 30 })
            .unwrap_err();
        assert!(matches!(err, PtyError::NotFound(_)));
    }

    #[test]
    fn write_unknown_session_returns_not_found() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let err = mgr.write("nope", b"x").unwrap_err();
        assert!(matches!(err, PtyError::NotFound(_)));
    }

    #[test]
    fn kill_removes_session() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let id = mgr
            .spawn(Some("/bin/sh"), PtyDims::default())
            .expect("spawn");
        assert_eq!(mgr.session_count(), 1);
        mgr.kill(&id).expect("kill");
        assert_eq!(mgr.session_count(), 0);
    }
}
