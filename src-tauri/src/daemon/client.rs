//! UI 프로세스 쪽 데몬 클라이언트 (#153).
//!
//! 소켓에 붙어 요청/응답을 id로 매칭하고, 데몬이 푸시하는 이벤트를 콜백으로 넘긴다.
//! 데몬이 없으면 **detached로 스폰**한 뒤 붙는다 — detached여야 앱이 `relaunch()`로
//! 죽어도 데몬이 함께 죽지 않는다(실측: 부모 종료 시 자식은 PID 1로 재부모화되어 생존).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

use super::proto::{self, Envelope, Event, Msg, Req};

/// 데몬이 푸시한 이벤트를 받는 콜백 (UI는 여기서 Tauri 이벤트로 다시 emit한다).
pub type EventSink = Arc<dyn Fn(Event) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>>;

pub struct DaemonClient {
    tx: mpsc::Sender<Envelope>,
    pending: Pending,
    next_id: AtomicU64,
}

impl DaemonClient {
    /// 데몬에 연결한다. 없으면 `exe`를 `--daemon`으로 detached 스폰한 뒤 재시도.
    /// 실패하면 `None` — 호출자는 인프로세스 폴백으로 동작한다(무회귀).
    pub async fn connect_or_spawn(exe: &Path, socket: &Path, events: EventSink) -> Option<Self> {
        if let Ok(s) = UnixStream::connect(socket).await {
            return Some(Self::attach(s, events));
        }
        if let Err(e) = spawn_detached(exe, socket) {
            eprintln!("[daemon] spawn failed: {e}");
            return None;
        }
        // 소켓이 뜰 때까지 짧게 폴링 (최대 ~3초).
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if let Ok(s) = UnixStream::connect(socket).await {
                return Some(Self::attach(s, events));
            }
        }
        eprintln!("[daemon] socket did not appear at {}", socket.display());
        None
    }

    fn attach(stream: UnixStream, events: EventSink) -> Self {
        let (mut rd, mut wr) = stream.into_split();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (tx, mut rx) = mpsc::channel::<Envelope>(1024);

        // 보내기 태스크.
        tokio::spawn(async move {
            while let Some(env) = rx.recv().await {
                if proto::write_json(&mut wr, &env).await.is_err() {
                    break;
                }
            }
        });

        // 받기 태스크: 응답은 pending으로, 이벤트는 sink로.
        let pend = Arc::clone(&pending);
        tokio::spawn(async move {
            loop {
                match proto::read_frame(&mut rd).await {
                    Ok(Some(frame)) => match serde_json::from_slice::<Msg>(&frame) {
                        Ok(Msg::Reply { id, result }) => {
                            if let Some(s) = pend.lock().expect("pending poisoned").remove(&id) {
                                let _ = s.send(result.into_result());
                            }
                        }
                        Ok(Msg::Event { ev }) => (events)(ev),
                        // 미래 버전 데몬이 보낸 모르는 메시지는 무시(전방호환).
                        Err(_) => continue,
                    },
                    // 연결 종료/오류: 대기 중인 요청을 모두 깨워 에러로 끝낸다.
                    _ => {
                        let mut g = pend.lock().expect("pending poisoned");
                        for (_, s) in g.drain() {
                            let _ = s.send(Err("daemon connection lost".into()));
                        }
                        break;
                    }
                }
            }
        });

        Self { tx, pending, next_id: AtomicU64::new(1) }
    }

    pub async fn call(&self, req: Req) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (s, r) = oneshot::channel();
        self.pending.lock().expect("pending poisoned").insert(id, s);
        if self.tx.send(Envelope { id, req }).await.is_err() {
            self.pending.lock().expect("pending poisoned").remove(&id);
            return Err("daemon connection closed".into());
        }
        match r.await {
            Ok(v) => v,
            Err(_) => Err("daemon reply dropped".into()),
        }
    }

    /// 핸드셰이크. 데몬 버전을 로그로 남긴다(버전 스큐 진단용).
    pub async fn hello(&self) -> Result<serde_json::Value, String> {
        self.call(Req::Hello { protocol: super::PROTOCOL_VERSION }).await
    }
}

/// 데몬을 **detached**로 띄운다. 앱의 프로세스 그룹/세션에서 떼어내야
/// `relaunch()`가 앱을 죽일 때 함께 죽지 않는다.
fn spawn_detached(exe: &Path, socket: &Path) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--daemon")
        .arg("--socket")
        .arg(socket)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        // setsid: 새 세션 리더가 되어 앱의 세션/프로세스 그룹에서 완전히 분리된다.
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().map(|_| ())
}

/// 데몬 소켓 경로. 설정 디렉터리 아래에 둔다(앱과 데몬이 같은 경로를 계산해야 하므로
/// UI가 스폰 시 `--socket`으로 넘겨준다).
pub fn socket_path(config_dir: &Path) -> PathBuf {
    config_dir.join("daemon.sock")
}
