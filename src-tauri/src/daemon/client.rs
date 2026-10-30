//! UI 프로세스 쪽 데몬 클라이언트 (#153).
//!
//! 소켓에 붙어 요청/응답을 id로 매칭하고, 데몬이 푸시하는 이벤트를 콜백으로 넘긴다.
//! 데몬이 없으면 **detached로 스폰**한 뒤 붙는다 — detached여야 앱이 `relaunch()`로
//! 죽어도 데몬이 함께 죽지 않는다(실측: 부모 종료 시 자식은 PID 1로 재부모화되어 생존).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
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
    /// hello로 알게 된 데몬 프로토콜 버전(0 = 아직 모름). 구버전 데몬에는 모르는 요청을
    /// 보내지 않기 위해 쓴다(#160 — 업데이트 직후엔 구버전 데몬이 살아 있을 수 있다).
    protocol: AtomicU32,
    /// 소켓 상대(데몬) 프로세스 id. 종료 요청을 모르는 구버전 데몬을 교체할 때 쓴다.
    peer_pid: Option<i32>,
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

    /// 테스트용: 이미 연결된 스트림으로 클라이언트를 만든다.
    #[cfg(test)]
    pub fn from_stream_for_test(stream: UnixStream, events: EventSink) -> Self {
        Self::attach(stream, events)
    }

    fn attach(stream: UnixStream, events: EventSink) -> Self {
        let peer_pid = stream.peer_cred().ok().and_then(|c| c.pid());
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

        Self {
            tx,
            pending,
            next_id: AtomicU64::new(1),
            protocol: AtomicU32::new(0),
            peer_pid,
        }
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

    /// 핸드셰이크. 데몬 버전을 로그로 남기고(버전 스큐 진단용) 프로토콜 버전을 기억한다.
    pub async fn hello(&self) -> Result<serde_json::Value, String> {
        let v = self.call(Req::Hello { protocol: super::PROTOCOL_VERSION }).await?;
        let p = v.get("protocol").and_then(|p| p.as_u64()).unwrap_or(1) as u32;
        self.protocol.store(p, Ordering::Relaxed);
        Ok(v)
    }

    /// 데몬의 프로토콜 버전(hello 이후 유효).
    pub fn protocol(&self) -> u32 {
        self.protocol.load(Ordering::Relaxed)
    }
}

impl DaemonClient {
    /// 데몬에 붙되, **세션이 하나도 없는 구버전 데몬이면 교체**한다(#160).
    ///
    /// 업데이트 직후엔 이전 버전 앱이 띄운 데몬이 살아 있다. 그 데몬은 새 기능(SSH 세션 소유 등)을
    /// 모르고, 유휴 종료도 "세션 0 + 클라이언트 0"이라 앱이 붙어 있는 한 영영 오지 않는다. 그래서
    /// 세션이 없으면 내려보내고 현재 버전 데몬을 띄운다. **세션이 남아 있으면 그대로 쓴다** — 그
    /// 세션(실행 중인 로컬 셸)을 지키는 게 데몬의 존재 이유이고, 새 기능은 그 세션들이 끝난 뒤 켜진다.
    /// 교체 중 무엇이든 실패하면 그 자리에 있는 데몬에 붙는다(무회귀).
    pub async fn connect_current(exe: &Path, socket: &Path, events: EventSink) -> Option<Self> {
        let c = Self::connect_or_spawn(exe, socket, events.clone()).await?;
        c.hello().await.ok()?;
        if c.protocol() >= super::PROTOCOL_VERSION {
            return Some(c);
        }
        let idle = c
            .call(Req::ListSessions)
            .await
            .ok()
            .and_then(|v| v.as_array().map(|a| a.is_empty()))
            .unwrap_or(false);
        if !idle {
            eprintln!("[daemon] older daemon (protocol {}) has live sessions — keeping it", c.protocol());
            return Some(c);
        }
        let retired = if c.protocol() >= 2 {
            matches!(c.call(Req::Shutdown).await, Ok(serde_json::Value::Bool(true)))
        } else {
            // v1에는 종료 요청이 없다 — 소켓 상대 pid가 **이 소켓을 쓰는 우리 데몬**일 때만 종료한다.
            c.peer_pid.is_some_and(|pid| terminate_if_our_daemon(pid, socket))
        };
        if !retired {
            return Some(c);
        }
        drop(c);
        // 옛 데몬이 소켓을 놓을 때까지 기다린 뒤(최대 ~3초) 새로 띄운다.
        for _ in 0..60 {
            if UnixStream::connect(socket).await.is_err() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let fresh = Self::connect_or_spawn(exe, socket, events).await?;
        fresh.hello().await.ok()?;
        eprintln!("[daemon] replaced an idle older daemon (now protocol {})", fresh.protocol());
        Some(fresh)
    }
}

/// `pid`가 이 소켓으로 띄운 우리 데몬이면 SIGTERM을 보낸다. 명령줄로 확인한다 — 소켓 상대가
/// 엉뚱한 프로세스일 가능성(재사용된 pid 등)에 대비해 확인 없이는 절대 죽이지 않는다.
fn terminate_if_our_daemon(pid: i32, socket: &Path) -> bool {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
    else {
        return false;
    };
    let cmd = String::from_utf8_lossy(&out.stdout);
    let ours = cmd.contains("--daemon") && cmd.contains(&*socket.to_string_lossy());
    if !ours {
        return false;
    }
    unsafe { libc::kill(pid, libc::SIGTERM) == 0 }
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

/// 구버전 데몬 교체 e2e (#160) — 기본 무시. 실제 구버전(프로토콜 1) 바이너리와 현재 빌드가 필요하다:
/// `WT_TEST_V1_EXE=<구버전 wowterminal> WT_TEST_V2_EXE=<현재 target/debug/wowterminal> \
///  cargo test --lib retire -- --ignored --nocapture`
#[cfg(test)]
mod retire_e2e {
    use super::*;

    fn spawn_v1(sock: &Path) -> std::process::Child {
        let exe = std::env::var("WT_TEST_V1_EXE").expect("WT_TEST_V1_EXE");
        std::process::Command::new(exe)
            .args(["--daemon", "--socket"])
            .arg(sock)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn v1 daemon")
    }

    async fn wait_socket(sock: &Path) {
        for _ in 0..100 {
            if UnixStream::connect(sock).await.is_ok() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
        panic!("socket never came up");
    }

    fn alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[tokio::test]
    #[ignore]
    async fn idle_v1_daemon_is_replaced_by_current() {
        let v2 = PathBuf::from(std::env::var("WT_TEST_V2_EXE").expect("WT_TEST_V2_EXE"));
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("d.sock");
        let mut v1 = spawn_v1(&sock);
        wait_socket(&sock).await;
        let c = DaemonClient::connect_current(&v2, &sock, Arc::new(|_| {})).await.expect("connect");
        println!("protocol after connect_current: {}", c.protocol());
        assert_eq!(c.protocol(), super::super::PROTOCOL_VERSION, "idle v1 must be replaced");
        let _ = v1.wait(); // SIGTERM으로 종료돼 있어야 한다(좀비 회수)
        assert!(!alive(v1.id()), "old daemon process must be gone");
        // 새 데몬은 세션이 없으니 종료 요청으로 정리.
        assert_eq!(c.call(Req::Shutdown).await.unwrap(), serde_json::Value::Bool(true));
    }

    #[tokio::test]
    #[ignore]
    async fn v1_daemon_with_sessions_is_kept() {
        let v2 = PathBuf::from(std::env::var("WT_TEST_V2_EXE").expect("WT_TEST_V2_EXE"));
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("d.sock");
        let mut v1 = spawn_v1(&sock);
        wait_socket(&sock).await;
        // 구버전 데몬에 로컬 셸 하나를 띄운다(= 업데이트 전부터 돌던 셸).
        let pre = DaemonClient::connect_or_spawn(&v2, &sock, Arc::new(|_| {})).await.unwrap();
        pre.hello().await.unwrap();
        let sid = pre
            .call(Req::PtySpawn {
                program: Some("/bin/sh".into()),
                cols: Some(80),
                rows: Some(24),
                cwd: None,
                attach: None,
            })
            .await
            .unwrap();
        let c = DaemonClient::connect_current(&v2, &sock, Arc::new(|_| {})).await.expect("connect");
        println!("protocol with a live v1 session: {}", c.protocol());
        assert_eq!(c.protocol(), 1, "v1 with live sessions must be kept");
        assert!(alive(v1.id()), "old daemon must keep running");
        let live = c.call(Req::ListSessions).await.unwrap();
        assert!(live.as_array().unwrap().contains(&sid), "the pre-update shell survives");
        let _ = c.call(Req::PtyKill { session_id: sid.as_str().unwrap().into() }).await;
        let _ = v1.kill();
        let _ = v1.wait();
    }
}
