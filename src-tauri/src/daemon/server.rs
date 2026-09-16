//! 세션 데몬 서버 (#153). UI보다 오래 살며 PTY 세션을 소유한다.
//!
//! 앱이 업데이트로 `relaunch()`될 때 오늘 로컬 셸이 죽는 진짜 이유는 부모-자식 관계가 아니라
//! **앱이 죽으며 PTY master fd가 닫혀 셸에 SIGHUP이 가기 때문**이다. 데몬이 master fd를
//! 들고 있으면 UI가 재시작해도 셸(= Claude Code/Gemini)은 계속 돈다.
//!
//! 매니저(`PtyManager`)는 그대로 재사용하고, webview로 emit하던 sink 자리에 **브로드캐스트
//! 채널로 이벤트를 발행**하는 sink를 꽂는다. 연결된 모든 클라이언트가 그 이벤트를 받는다.

use std::path::Path;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::sync::{broadcast, mpsc};

use super::proto::{self, Envelope, Event, Msg, ReplyResult, Req};
use crate::pty::manager::{DataSink, HistoryStore, PtyDims, PtyManager};

/// 세션이 하나도 없고 클라이언트도 없을 때 이만큼 지나면 데몬을 종료한다.
/// (업데이트 중 UI가 잠깐 사라지는 구간에는 세션이 살아 있으므로 종료되지 않는다.)
const IDLE_EXIT: std::time::Duration = std::time::Duration::from_secs(120);

struct Daemon {
    pty: Arc<PtyManager>,
    history: Arc<HistoryStore>,
    events: broadcast::Sender<Event>,
    clients: Arc<std::sync::atomic::AtomicUsize>,
}

/// 데몬 실행 진입점. 소켓을 바인드하고 클라이언트를 받는다.
pub async fn run(socket: &Path) -> std::io::Result<()> {
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

    let daemon = Arc::new(Daemon {
        pty: Arc::new(PtyManager::with_closed(sink, Arc::clone(&history), closed)),
        history,
        events,
        clients: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    });

    // 유휴 감시: 세션 0 + 클라이언트 0이 IDLE_EXIT 동안 지속되면 종료.
    {
        let d = Arc::clone(&daemon);
        let sock = socket.to_path_buf();
        tokio::spawn(async move {
            let mut idle_since: Option<std::time::Instant> = None;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                let busy = !d.pty.list_sessions().is_empty()
                    || d.clients.load(std::sync::atomic::Ordering::Relaxed) > 0;
                if busy {
                    idle_since = None;
                    continue;
                }
                match idle_since {
                    None => idle_since = Some(std::time::Instant::now()),
                    Some(t) if t.elapsed() >= IDLE_EXIT => {
                        let _ = std::fs::remove_file(&sock);
                        std::process::exit(0);
                    }
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
                let _ = out_tx
                    .send(Msg::Reply {
                        id: 0,
                        result: ReplyResult::Err { message: e.to_string() },
                    })
                    .await;
                continue;
            }
        };
        let result = handle(&d, env.req);
        if out_tx.send(Msg::Reply { id: env.id, result }).await.is_err() {
            break;
        }
    }

    pump.abort();
    drop(out_tx);
    let _ = writer.await;
    Ok(())
}

fn handle(d: &Daemon, req: Req) -> ReplyResult {
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
                Err(e) => ReplyResult::Err { message: e.to_string() },
            }
        }
        Req::PtyWrite { session_id, data_b64 } => match B64.decode(data_b64.as_bytes()) {
            Ok(bytes) => match d.pty.write(&session_id, &bytes) {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => ReplyResult::Err { message: e.to_string() },
            },
            Err(e) => ReplyResult::Err { message: e.to_string() },
        },
        Req::PtyResize { session_id, cols, rows } => {
            match d.pty.resize(&session_id, PtyDims { cols, rows }) {
                Ok(()) => ReplyResult::ok(()),
                Err(e) => ReplyResult::Err { message: e.to_string() },
            }
        }
        Req::PtyKill { session_id } => match d.pty.kill(&session_id) {
            Ok(()) => ReplyResult::ok(()),
            Err(e) => ReplyResult::Err { message: e.to_string() },
        },
        Req::SessionHistory { session_id } => ReplyResult::ok(B64.encode(d.history.get(&session_id))),
        Req::ListSessions => ReplyResult::ok(d.pty.list_sessions()),
    }
}
