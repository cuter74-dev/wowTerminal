//! 세션 데몬 서버 (#153, #160). UI보다 오래 살며 PTY·SSH 세션을 소유한다.
//!
//! 앱이 업데이트로 `relaunch()`될 때 오늘 로컬 셸이 죽는 진짜 이유는 부모-자식 관계가 아니라
//! **앱이 죽으며 PTY master fd가 닫혀 셸에 SIGHUP이 가기 때문**이다. 데몬이 master fd를
//! 들고 있으면 UI가 재시작해도 셸(= Claude Code/Gemini)은 계속 돈다. SSH도 같다 — TCP
//! 연결을 데몬이 들고 있으면 원격 셸이 끊기지 않는다(#160).
//!
//! 매니저(`PtyManager`·`SshManager`)는 그대로 재사용하고, webview로 emit하던 sink 자리에
//! **브로드캐스트 채널로 이벤트를 발행**하는 sink를 꽂는다. 연결된 모든 클라이언트가 그 이벤트를 받는다.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::sync::{broadcast, mpsc};

use super::proto::{self, Envelope, Event, Msg, ReplyResult, Req};
use crate::pty::manager::{DataSink, HistoryStore, PtyDims, PtyManager};
use crate::ssh::commands::SshConnectError;
use crate::ssh::known_hosts::KnownHostsStore;
use crate::ssh::manager::SshManager;

/// 세션이 하나도 없고 클라이언트도 없을 때 이만큼 지나면 데몬을 종료한다.
/// (업데이트 중 UI가 잠깐 사라지는 구간에는 세션이 살아 있으므로 종료되지 않는다.)
const IDLE_EXIT: std::time::Duration = std::time::Duration::from_secs(120);

struct Daemon {
    pty: Arc<PtyManager>,
    ssh: Arc<SshManager>,
    history: Arc<HistoryStore>,
    events: broadcast::Sender<Event>,
    clients: Arc<std::sync::atomic::AtomicUsize>,
    socket: PathBuf,
    /// 우리가 바인드한 소켓 파일의 inode. 종료 시 **우리 소켓일 때만** 지운다 — 그 사이 다음
    /// 데몬이 같은 경로에 새 소켓을 만들었으면 그것을 지우면 안 된다.
    socket_ino: u64,
}

impl Daemon {
    async fn session_count(&self) -> usize {
        self.pty.list_sessions().len() + self.ssh.session_count().await
    }

    fn exit(&self) -> ! {
        remove_own_socket(&self.socket, self.socket_ino);
        std::process::exit(0);
    }
}

#[cfg(unix)]
fn inode(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|m| m.ino())
}

fn remove_own_socket(path: &Path, ino: u64) {
    if inode(path) == Some(ino) {
        let _ = std::fs::remove_file(path);
    }
}

/// 데몬 실행 진입점. 소켓을 바인드하고 클라이언트를 받는다.
pub async fn run(socket: &Path) -> std::io::Result<()> {
    // 데몬은 `lib::run()`을 거치지 않으므로 rustls 기본 CryptoProvider를 여기서 설치한다 —
    // 없으면 russh(SSH)가 provider를 자동 결정하지 못해 패닉한다(lib.rs와 같은 이유, #114).
    let _ = rustls::crypto::ring::default_provider().install_default();

    // 남아 있는 죽은 소켓 파일 정리 후 바인드. 바인드에 성공한 프로세스가 유일한 데몬이 된다
    // (동시 기동 경합은 bind 실패로 걸러진다 — 먼저 붙은 쪽이 이김).
    if socket.exists() {
        // 살아있는 데몬이 있으면 연결이 되므로, 연결되면 우리는 물러난다.
        if tokio::net::UnixStream::connect(socket).await.is_ok() {
            return Ok(());
        }
        let _ = std::fs::remove_file(socket);
    }
    if let Some(dir) = socket.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let listener = UnixListener::bind(socket)?;
    // 소유자만 접속(#160): SSH 인증 재료가 이 소켓으로 오간다. 디렉터리 권한에만 기대지 않는다.
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600));
    }
    let socket_ino = inode(socket).unwrap_or(0);

    let (events, _rx) = broadcast::channel::<Event>(4096);
    let history = Arc::new(HistoryStore::new(512 * 1024));

    // sink: webview emit 대신 브로드캐스트 발행. 히스토리 누적은 기존과 동일.
    let ev_out = events.clone();
    let hist = Arc::clone(&history);
    let sink: DataSink = Arc::new(move |session_id, data| {
        hist.append(&session_id, &data);
        let _ = ev_out.send(Event::PtyOutput {
            session_id,
            data_b64: B64.encode(&data),
        });
    });
    let ev_closed = events.clone();
    let closed: crate::pty::manager::ClosedSink = Arc::new(move |session_id| {
        let _ = ev_closed.send(Event::SessionClosed { session_id });
    });

    // SSH (#160): 출력은 SshOutput으로, 종료는 pty와 같은 SessionClosed로. 히스토리는 공유한다
    // (세션 id가 전부 UUID라 겹치지 않는다). 호스트 키 저장소는 UI와 **같은 파일**을 쓴다 —
    // 매 확인마다 파일을 새로 읽으므로 UI가 신뢰를 기록하면 데몬도 곧바로 본다.
    let ev_ssh = events.clone();
    let hist_ssh = Arc::clone(&history);
    let ssh_sink: DataSink = Arc::new(move |session_id, data| {
        hist_ssh.append(&session_id, &data);
        let _ = ev_ssh.send(Event::SshOutput {
            session_id,
            data_b64: B64.encode(&data),
        });
    });
    let ev_ssh_closed = events.clone();
    let ssh_closed: crate::pty::manager::ClosedSink = Arc::new(move |session_id| {
        let _ = ev_ssh_closed.send(Event::SessionClosed { session_id });
    });
    let config_dir = socket.parent().map(Path::to_path_buf).unwrap_or_default();
    let known_hosts = Arc::new(KnownHostsStore::new(config_dir.join("known_hosts.toml")));

    let daemon = Arc::new(Daemon {
        pty: Arc::new(PtyManager::with_closed(sink, Arc::clone(&history), closed)),
        ssh: Arc::new(SshManager::with_closed(
            ssh_sink,
            known_hosts,
            Arc::clone(&history),
            ssh_closed,
        )),
        history,
        events,
        clients: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        socket: socket.to_path_buf(),
        socket_ino,
    });

    // 유휴 감시: 세션 0 + 클라이언트 0이 IDLE_EXIT 동안 지속되면 종료.
    {
        let d = Arc::clone(&daemon);
        tokio::spawn(async move {
            let mut idle_since: Option<std::time::Instant> = None;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                let busy = d.session_count().await > 0
                    || d.clients.load(std::sync::atomic::Ordering::Relaxed) > 0;
                if busy {
                    idle_since = None;
                    continue;
                }
                match idle_since {
                    None => idle_since = Some(std::time::Instant::now()),
                    Some(t) if t.elapsed() >= IDLE_EXIT => d.exit(),
                    Some(_) => {}
                }
            }
        });
    }

    loop {
        let (stream, _) = listener.accept().await?;
        let d = Arc::clone(&daemon);
        tokio::spawn(async move {
            d.clients.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let _ = serve_client(d.clone(), stream).await;
            d.clients.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        });
    }
}

async fn serve_client(d: Arc<Daemon>, stream: tokio::net::UnixStream) -> std::io::Result<()> {
    let (mut rd, mut wr) = stream.into_split();

    // 나가는 프레임은 전부 이 채널을 거쳐 한 태스크가 쓴다(응답과 이벤트가 섞이지 않게).
    let (out_tx, mut out_rx) = mpsc::channel::<Msg>(1024);
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if proto::write_json(&mut wr, &msg).await.is_err() {
                break;
            }
        }
        let _ = wr.shutdown().await;
    });

    // 이벤트 구독 → 이 클라이언트로 전달.
    let mut sub = d.events.subscribe();
    let ev_tx = out_tx.clone();
    let pump = tokio::spawn(async move {
        loop {
            match sub.recv().await {
                Ok(ev) => {
                    if ev_tx.send(Msg::Event { ev }).await.is_err() {
                        break;
                    }
                }
                // 느린 클라이언트가 밀리면 일부 이벤트를 놓친다 — 연결은 유지한다.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    while let Some(frame) = proto::read_frame(&mut rd).await? {
        let env: Envelope = match serde_json::from_slice(&frame) {
            Ok(e) => e,
            Err(e) => {
                // 모르는 op 등 해석 실패라도 **요청 id로** 답한다 — id 0으로 답하면 클라이언트의
                // 그 요청이 영영 응답을 못 받는다(#160 이전 데몬의 결함).
                let id = serde_json::from_slice::<serde_json::Value>(&frame)
                    .ok()
                    .and_then(|v| v.get("id").and_then(|i| i.as_u64()))
                    .unwrap_or(0);
                let _ = out_tx
                    .send(Msg::Reply {
                        id,
                        result: ReplyResult::Err { message: e.to_string() },
                    })
                    .await;
                continue;
            }
        };
        // 오래 걸릴 수 있는 요청(SSH 접속·원격 조회)은 별도 태스크로 — 기다리는 동안 다른 세션의
        // 입력이 막히지 않게. 나머지(쓰기 등)는 도착 순서대로 처리해 입력 순서를 지킨다.
        if is_slow(&env.req) {
            let (d2, tx2) = (Arc::clone(&d), out_tx.clone());
            tokio::spawn(async move {
                let result = handle(&d2, env.req).await;
                let _ = tx2.send(Msg::Reply { id: env.id, result }).await;
            });
            continue;
        }
        let shutdown = matches!(env.req, Req::Shutdown);
        let result = handle(&d, env.req).await;
        let exiting = shutdown && matches!(&result, ReplyResult::Ok { value } if value == &serde_json::Value::Bool(true));
        if out_tx.send(Msg::Reply { id: env.id, result }).await.is_err() {
            break;
        }
        if exiting {
            // 응답이 나갈 시간을 준 뒤 종료한다.
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            d.exit();
        }
    }

    pump.abort();
    drop(out_tx);
    let _ = writer.await;
    Ok(())
}

fn is_slow(req: &Req) -> bool {
    matches!(
        req,
        Req::SshConnect { .. }
            | Req::SshRemoteCwd { .. }
            | Req::SshTmuxSessions { .. }
            | Req::SshProbeSystem { .. }
    )
}

fn err(e: impl std::fmt::Display) -> ReplyResult {
    ReplyResult::Err { message: e.to_string() }
}

async fn handle(d: &Daemon, req: Req) -> ReplyResult {
    match req {
        Req::Hello { protocol } => ReplyResult::ok(serde_json::json!({
            "protocol": super::PROTOCOL_VERSION,
            "client_protocol": protocol,
            "daemon_version": env!("CARGO_PKG_VERSION"),
        })),
        Req::PtySpawn { program, cols, rows, cwd, attach } => {
            // 재attach: 힌트로 준 세션이 아직 살아있으면 스폰하지 않고 그대로 돌려준다.
            // (UI가 업데이트로 재시작된 경우 — 셸은 데몬 안에서 계속 돌고 있었다.)
            if let Some(id) = attach {
                if d.pty.list_sessions().iter().any(|s| s == &id) {
                    // 새 UI의 창 크기에 맞춰 준다.
                    let _ = d.pty.resize(
                        &id,
                        PtyDims { cols: cols.unwrap_or(80), rows: rows.unwrap_or(24) },
                    );
                    return ReplyResult::ok(id);
                }
            }
            let dims = PtyDims {
                cols: cols.unwrap_or(80),
                rows: rows.unwrap_or(24),
            };
            match d.pty.spawn(program.as_deref(), dims, cwd.as_deref()) {
                Ok(id) => ReplyResult::ok(id),
                Err(e) => err(e),
            }
        }
        Req::PtyWrite { session_id, data_b64 } => match B64.decode(data_b64.as_bytes()) {
            Ok(bytes) => match d.pty.write(&session_id, &bytes) {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => err(e),
            },
            Err(e) => err(e),
        },
        Req::PtyResize { session_id, cols, rows } => {
            match d.pty.resize(&session_id, PtyDims { cols, rows }) {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => err(e),
            }
        }
        Req::PtyKill { session_id } => match d.pty.kill(&session_id) {
            Ok(()) => ReplyResult::ok(()),
            Err(e) => err(e),
        },
        Req::SessionHistory { session_id } => ReplyResult::ok(B64.encode(d.history.get(&session_id))),
        Req::ListSessions => {
            let mut ids = d.pty.list_sessions();
            ids.extend(d.ssh.list_sessions().await);
            ReplyResult::ok(ids)
        }
        // ── v2 (#160) ─────────────────────────────────────────────────────────
        Req::SshConnect { host, port, user, auth, cols, rows, jump } => {
            let outcome: Result<String, SshConnectError> = async {
                let auth = auth.into_resolved()?;
                let jump = jump.map(|j| j.into_spec()).transpose()?;
                d.ssh.connect_addr(&host, port, &user, auth, cols, rows, jump).await
            }
            .await
            .map_err(SshConnectError::from);
            match outcome {
                Ok(id) => ReplyResult::ok(serde_json::json!({ "ok": id })),
                Err(e) => ReplyResult::ok(serde_json::json!({ "err": e })),
            }
        }
        Req::SshWrite { session_id, data_b64 } => match B64.decode(data_b64.as_bytes()) {
            Ok(bytes) => match d.ssh.write(&session_id, &bytes).await {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => err(e),
            },
            Err(e) => err(e),
        },
        Req::SshResize { session_id, cols, rows } => {
            match d.ssh.resize(&session_id, cols, rows).await {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => err(e),
            }
        }
        Req::SshKill { session_id } => match d.ssh.kill(&session_id).await {
            Ok(()) => ReplyResult::ok(()),
            Err(e) => err(e),
        },
        Req::SshRemoteCwd { session_id } => ReplyResult::ok(d.ssh.remote_cwd(&session_id).await),
        Req::SshTmuxSessions { session_id } => {
            ReplyResult::ok(d.ssh.tmux_sessions(&session_id).await)
        }
        Req::SshProbeSystem { session_id } => {
            ReplyResult::ok(d.ssh.probe_system(&session_id).await)
        }
        Req::MarkDetached { session_id } => {
            // 세션 id만 보고는 종류를 모르니 양쪽 모두에 표시한다(없는 쪽은 무해 — 다음 kill이
            // 그 종류로 오지 않으므로 소비되지 않고 남을 뿐, 세션 id는 재사용되지 않는다).
            d.pty.mark_detached(&session_id);
            d.ssh.mark_detached(&session_id).await;
            ReplyResult::ok(())
        }
        Req::Shutdown => ReplyResult::ok(d.session_count().await == 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::client::{DaemonClient, EventSink};

    /// 임시 디렉터리에 데몬을 띄우고 붙는다. (Shutdown은 세션이 0이면 테스트 프로세스를
    /// 종료시키므로 테스트에서는 세션이 있을 때만 보낸다.)
    async fn start() -> (tempfile::TempDir, std::path::PathBuf, DaemonClient) {
        let dir = tempfile::tempdir().expect("tempdir");
        let sock = dir.path().join("daemon.sock");
        let s2 = sock.clone();
        tokio::spawn(async move {
            let _ = run(&s2).await;
        });
        for _ in 0..100 {
            if sock.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let stream = tokio::net::UnixStream::connect(&sock).await.expect("connect");
        let sink: EventSink = Arc::new(|_| {});
        let client = DaemonClient::from_stream_for_test(stream, sink);
        client.hello().await.expect("hello");
        (dir, sock, client)
    }

    #[tokio::test]
    async fn hello_reports_protocol_2_and_socket_is_owner_only() {
        let (_dir, sock, client) = start().await;
        assert_eq!(client.protocol(), 2);
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "socket must be owner-only");
    }

    /// 탭 분리(#153 회귀, #160 수정): MarkDetached 직후의 kill 1회는 무시되고 세션은 살아 있어야
    /// 한다. 예전엔 보호 표시가 인프로세스 매니저에만 가서 데몬 세션이 그대로 죽었다.
    #[tokio::test]
    async fn mark_detached_protects_a_pty_session_from_the_next_kill() {
        let (_dir, _sock, client) = start().await;
        let id = client
            .call(Req::PtySpawn {
                program: Some("/bin/sh".into()),
                cols: Some(80),
                rows: Some(24),
                cwd: None,
                attach: None,
            })
            .await
            .expect("spawn");
        let id = id.as_str().unwrap().to_string();
        let alive = |v: serde_json::Value, id: &str| {
            v.as_array().unwrap().iter().any(|x| x.as_str() == Some(id))
        };

        client.call(Req::MarkDetached { session_id: id.clone() }).await.expect("mark");
        client.call(Req::PtyKill { session_id: id.clone() }).await.expect("guarded kill");
        let v = client.call(Req::ListSessions).await.unwrap();
        assert!(alive(v, &id), "guarded kill must not end the session");
        // 세션이 남아 있으면 Shutdown은 거절된다(false) — 다음 버전 UI가 안전하게 교체 시도 가능.
        let v = client.call(Req::Shutdown).await.unwrap();
        assert_eq!(v, serde_json::Value::Bool(false));

        client.call(Req::PtyKill { session_id: id.clone() }).await.expect("kill");
        let v = client.call(Req::ListSessions).await.unwrap();
        assert!(!alive(v, &id), "second kill ends the session");
    }

    /// 모르는 요청에도 **그 요청 id로** 오류를 돌려줘야 한다(아니면 클라이언트가 영영 기다린다).
    #[tokio::test]
    async fn unknown_op_gets_an_error_reply_with_its_own_id() {
        let (_dir, sock, _client) = start().await;
        let mut s = tokio::net::UnixStream::connect(&sock).await.unwrap();
        let req = serde_json::json!({"id": 4242, "op": "from_the_future", "x": 1});
        proto::write_json(&mut s, &req).await.unwrap();
        let (mut rd, _wr) = s.into_split();
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let f = proto::read_frame(&mut rd).await.unwrap().unwrap();
                if let Ok(Msg::Reply { id, result }) = serde_json::from_slice::<Msg>(&f) {
                    return (id, result);
                }
            }
        })
        .await
        .expect("reply within 5s");
        assert_eq!(frame.0, 4242);
        assert!(matches!(frame.1, ReplyResult::Err { .. }));
    }

    /// SSH 접속 실패는 구조화된 오류로 돌아온다 — UI가 종전과 같은 방식으로 처리한다.
    #[tokio::test]
    async fn ssh_connect_failure_is_a_structured_error() {
        let (_dir, _sock, client) = start().await;
        // 바인드만 하고 받지 않는 포트 대신, 닫힌 포트(연결 거부)를 쓴다.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let v = client
            .call(Req::SshConnect {
                host: "127.0.0.1".into(),
                port,
                user: "nobody".into(),
                auth: crate::ssh::session::WireAuth::Password { password: "x".into() },
                cols: 80,
                rows: 24,
                jump: None,
            })
            .await
            .expect("reply");
        assert!(v.get("ok").is_none(), "must not connect: {v}");
        assert_eq!(v["err"]["kind"], "other", "{v}");
    }
}

/// 실제 SSH 서버 대상 e2e (#160) — 기본 무시. 로컬 테스트 SSH 서버(아무 비밀번호나 받는)를 띄운 뒤
/// `WT_TEST_SSH_PORT=<포트> cargo test --lib ssh_session_survives -- --ignored --nocapture`로 돌린다.
/// UI(클라이언트)가 끊겼다 다시 붙어도 같은 원격 셸이 살아 있는지 본다.
#[cfg(test)]
mod e2e {
    use super::*;
    use crate::daemon::client::{DaemonClient, EventSink};

    #[tokio::test]
    #[ignore]
    async fn ssh_session_survives_client_restart() {
        let port: u16 = std::env::var("WT_TEST_SSH_PORT").expect("WT_TEST_SSH_PORT").parse().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("d.sock");
        let s2 = sock.clone();
        tokio::spawn(async move {
            let _ = run(&s2).await;
        });
        for _ in 0..100 {
            if sock.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        // 이 테스트 데몬의 known_hosts는 임시 디렉터리 — 첫 접속은 TOFU 확인이 필요하므로 먼저 신뢰를 기록한다.
        let first = {
            let c = DaemonClient::from_stream_for_test(
                tokio::net::UnixStream::connect(&sock).await.unwrap(),
                Arc::new(|_| {}),
            );
            c.hello().await.unwrap();
            let v = c
                .call(Req::SshConnect {
                    host: "127.0.0.1".into(),
                    port,
                    user: "test".into(),
                    auth: crate::ssh::session::WireAuth::Password { password: "x".into() },
                    cols: 80,
                    rows: 24,
                    jump: None,
                })
                .await
                .unwrap();
            assert_eq!(v["err"]["kind"], "first_contact", "{v}");
            let ks = KnownHostsStore::new(dir.path().join("known_hosts.toml"));
            ks.record(
                "127.0.0.1",
                port,
                v["err"]["algorithm"].as_str().unwrap(),
                v["err"]["fingerprint"].as_str().unwrap(),
            )
            .unwrap();
            let v = c
                .call(Req::SshConnect {
                    host: "127.0.0.1".into(),
                    port,
                    user: "test".into(),
                    auth: crate::ssh::session::WireAuth::Password { password: "x".into() },
                    cols: 80,
                    rows: 24,
                    jump: None,
                })
                .await
                .unwrap();
            let id = v["ok"].as_str().expect("connected").to_string();
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let data = B64.encode(b"before-restart\r");
            c.call(Req::SshWrite { session_id: id.clone(), data_b64: data }).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            id
            // c(첫 클라이언트)가 여기서 drop → 소켓이 닫힌다 = UI가 업데이트로 종료된 상황.
        };
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // 새 UI가 붙는다.
        let got: Arc<std::sync::Mutex<Vec<u8>>> = Arc::default();
        let g2 = Arc::clone(&got);
        let sink: EventSink = Arc::new(move |ev| {
            if let Event::SshOutput { data_b64, .. } = ev {
                g2.lock().unwrap().extend(B64.decode(data_b64).unwrap());
            }
        });
        let c2 = DaemonClient::from_stream_for_test(
            tokio::net::UnixStream::connect(&sock).await.unwrap(),
            sink,
        );
        c2.hello().await.unwrap();
        let live = c2.call(Req::ListSessions).await.unwrap();
        assert!(
            live.as_array().unwrap().iter().any(|x| x.as_str() == Some(first.as_str())),
            "SSH session must survive the client going away: {live}"
        );
        let hist = c2.call(Req::SessionHistory { session_id: first.clone() }).await.unwrap();
        let hist = String::from_utf8_lossy(&B64.decode(hist.as_str().unwrap()).unwrap()).to_string();
        println!("HISTORY: {hist:?}");
        assert!(hist.contains("before-restart"), "scrollback must include pre-restart output");
        c2.call(Req::SshWrite {
            session_id: first.clone(),
            data_b64: B64.encode(b"after-restart\r"),
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let out = String::from_utf8_lossy(&got.lock().unwrap()).to_string();
        println!("LIVE OUTPUT: {out:?}");
        assert!(out.contains("after-restart"), "new input reaches the same remote shell");
        c2.call(Req::SshKill { session_id: first }).await.unwrap();
    }
}
