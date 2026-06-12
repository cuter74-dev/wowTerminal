//! russh 클라이언트 + PTY 채널을 감싼 [`SshSession`].
//!
//! 채널 자체는 actor 태스크가 소유한다. 외부에서는 [`tokio::sync::mpsc`]로 명령
//! ([`SessionCmd`])을 보내고, 채널이 받은 데이터는 [`crate::pty::manager::DataSink`]
//! 콜백으로 흘러나간다.
//!
//! 호스트 키 검증은 [`TofuHandler`]가 담당. 첫 접속이면 저장, 일치하면 통과,
//! 불일치면 거절 + outcome 기록. 거절은 러닝 중인 connect()가 일반 에러로 반환되므로
//! 호출 측에서 outcome을 확인해 [`SshError::HostKeyMismatch`]로 변환한다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use russh::client::{self, Handler};
use russh::keys::ssh_key::{HashAlg, PrivateKey, PublicKey};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{Channel, ChannelMsg};
use tokio::sync::mpsc;

use crate::pty::manager::DataSink;

use super::known_hosts::{KnownHostsStore, MatchResult};
use super::manager::SshError;
use super::types::{SshAuthMethod, TmuxSessionInfo};

pub type SessionId = String;

/// 호스트 키 검증 결과 — TofuHandler가 connect 도중에 채워준다.
#[derive(Debug, Clone)]
enum TofuOutcome {
    Accepted,
    /// 처음 보는 호스트. 정책상 사용자 확인 전에는 저장하지 않고 거절한다.
    FirstContactPending {
        algorithm: String,
        fingerprint: String,
    },
    Mismatch {
        algorithm: String,
        stored_fingerprint: String,
        presented_fingerprint: String,
    },
    InternalError(String),
}

/// 원격 포워드(-R) 라우팅 표: 서버 바인드 포트 → 클라이언트 측 (host, port).
/// 서버가 forwarded-tcpip 채널을 열면 이 표를 보고 로컬 대상으로 연결한다.
pub type RemoteForwards = Arc<Mutex<HashMap<u16, (String, u16)>>>;

#[derive(Clone)]
struct TofuShared {
    store: Arc<KnownHostsStore>,
    host: String,
    port: u16,
    outcome: Arc<Mutex<Option<TofuOutcome>>>,
    /// -R 원격 포워드 라우팅(비어 있으면 forwarded-tcpip를 무시).
    remote_forwards: RemoteForwards,
}

/// TOFU 정책 핸들러.
pub struct TofuHandler {
    shared: TofuShared,
}

/// 점프 호스트(ProxyJump) 접속 사양 — establish_via에 전달.
pub struct JumpSpec {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: ResolvedAuth,
}

/// TOFU 핸들러 + 공유 상태를 만든다 (establish / establish_via 공용).
/// `remote_forwards`가 비면 -R 미사용(forwarded-tcpip 무시).
fn make_handler(
    store: Arc<KnownHostsStore>,
    host: &str,
    port: u16,
    remote_forwards: RemoteForwards,
) -> (TofuHandler, TofuShared) {
    let shared = TofuShared {
        store,
        host: host.to_string(),
        port,
        outcome: Arc::new(Mutex::new(None)),
        remote_forwards,
    };
    (
        TofuHandler {
            shared: shared.clone(),
        },
        shared,
    )
}

impl Handler for TofuHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let algorithm = server_public_key.algorithm().as_str().to_string();
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();

        let result = self.shared.store.check(
            &self.shared.host,
            self.shared.port,
            &algorithm,
            &fingerprint,
        );

        let (accept, outcome) = match result {
            Err(e) => (false, TofuOutcome::InternalError(e.to_string())),
            Ok(MatchResult::Match) => (true, TofuOutcome::Accepted),
            // 정책: 첫 접속에서는 자동 저장하지 않고 사용자 확인을 요구한다.
            // 사용자가 별도로 `ssh_trust_known_host`를 호출해 신뢰해야 재접속이 통과한다.
            Ok(MatchResult::FirstContact) => (
                false,
                TofuOutcome::FirstContactPending {
                    algorithm: algorithm.clone(),
                    fingerprint: fingerprint.clone(),
                },
            ),
            Ok(MatchResult::Mismatch { stored }) => (
                false,
                TofuOutcome::Mismatch {
                    algorithm: algorithm.clone(),
                    stored_fingerprint: stored.fingerprint,
                    presented_fingerprint: fingerprint,
                },
            ),
        };

        *self
            .shared
            .outcome
            .lock()
            .expect("tofu outcome mutex poisoned") = Some(outcome);
        Ok(accept)
    }

    /// 원격 포워드(-R): 서버가 바인드 포트로 들어온 연결을 forwarded-tcpip 채널로 보내면,
    /// 라우팅 표에서 클라이언트 측 대상을 찾아 로컬 TCP로 연결하고 양방향 펌프한다.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // 바인드 포트로 대상을 찾고, 없으면(예: 표에 1개뿐) 유일 항목으로 폴백.
        let target = {
            let map = self
                .shared
                .remote_forwards
                .lock()
                .expect("remote_forwards mutex poisoned");
            map.get(&(connected_port as u16))
                .cloned()
                .or_else(|| if map.len() == 1 { map.values().next().cloned() } else { None })
        };
        if let Some((lhost, lport)) = target {
            let mut stream = channel.into_stream();
            tokio::spawn(async move {
                if let Ok(mut local) =
                    tokio::net::TcpStream::connect((lhost.as_str(), lport)).await
                {
                    let _ = tokio::io::copy_bidirectional(&mut local, &mut stream).await;
                }
                // 대상 연결 실패 시 stream이 drop되며 채널이 닫힌다.
            });
        }
        Ok(())
    }
}

/// 외부 → actor 태스크로 보내는 명령.
enum SessionCmd {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

pub struct SshSession {
    tx: mpsc::UnboundedSender<SessionCmd>,
    /// 연결 핸들(Arc 공유). 드래그 업로드 시 별도 exec 채널을 열어 원격 셸 cwd를 조회하는 데 쓴다.
    /// (russh Handle은 Clone이 아니라 Arc로 공유 — channel_open_session은 &self라 문제없다.)
    handle: Arc<client::Handle<TofuHandler>>,
}

/// 원격 *대화형 셸*의 현재 작업 디렉터리를 화면 흔적/주입 없이 알아내는 POSIX sh 스크립트.
/// 원리: 같은 SSH 연결의 셸·exec 채널은 같은 "연결 sshd"를 공통 조상으로 갖는다(privsep 깊이 무관).
/// exec(이 스크립트)에서 자신의 조상 체인을 따라 연결 sshd를 찾고, 그 sshd를 조상으로 가지면서
/// tty를 가진(=대화형 셸) 프로세스의 `/proc/<pid>/cwd`를 읽는다. exec 자신은 tty가 없어 제외된다.
/// Linux(/proc)에서만 동작하며, 그 외(macOS/BSD·hidepid 등)에서는 아무것도 출력하지 않는다(홈 폴백).
const REMOTE_CWD_SCRIPT: &str = r#"sh -c 'ppidof(){ s=$(cat /proc/$1/stat 2>/dev/null)||return 1; r=${s##*\) }; set -- $r; printf %s "$2"; }; ttyof(){ s=$(cat /proc/$1/stat 2>/dev/null)||return 1; r=${s##*\) }; set -- $r; printf %s "$5"; }; self=$$; p=$self; ch=; while [ "$p" -gt 1 ] 2>/dev/null; do ch="$ch $p"; np=$(ppidof $p)||break; [ "$np" = "$p" ] && break; p=$np; done; conn=; prev=; for q in $ch; do [ "$(cat /proc/$q/comm 2>/dev/null)" = sshd ] || continue; pq=$(ppidof $q); [ "$(cat /proc/$pq/comm 2>/dev/null)" != sshd ] && { conn=$prev; break; }; prev=$q; done; [ -n "$conn" ] || exit 0; for d in /proc/[0-9]*; do pid=${d#/proc/}; [ "$pid" = "$self" ] && continue; t=$(ttyof $pid 2>/dev/null)||continue; [ -n "$t" ] && [ "$t" != 0 ] || continue; a=$pid; ok=0; while [ "$a" -gt 1 ] 2>/dev/null; do [ "$a" = "$conn" ] && { ok=1; break; }; na=$(ppidof $a)||break; [ "$na" = "$a" ] && break; a=$na; done; [ "$ok" = 1 ] || continue; cwd=$(readlink /proc/$pid/cwd 2>/dev/null) && { printf "%s\n" "$cwd"; exit 0; }; done'"#;

impl SshSession {
    /// SSH 핸드셰이크 + 인증까지 수행하고 연결 핸들을 반환. PTY 세션과 SFTP가 공유.
    pub async fn establish(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<client::Handle<TofuHandler>, SshError> {
        Self::establish_inner(host, port, user, auth, known_hosts, Default::default()).await
    }

    /// establish + 원격 포워드(-R) 라우팅 표를 핸들러에 심는다. -R 터널 전용.
    pub async fn establish_with_forwards(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        known_hosts: Arc<KnownHostsStore>,
        remote_forwards: RemoteForwards,
    ) -> Result<client::Handle<TofuHandler>, SshError> {
        Self::establish_inner(host, port, user, auth, known_hosts, remote_forwards).await
    }

    async fn establish_inner(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        known_hosts: Arc<KnownHostsStore>,
        remote_forwards: RemoteForwards,
    ) -> Result<client::Handle<TofuHandler>, SshError> {
        let (handler, shared) = make_handler(known_hosts, host, port, remote_forwards);
        let config = Arc::new({
            let mut c = client::Config::default();
            // 절전/네트워크 단절로 죽은 연결을 ~1분 내 감지한다 (#96). 응답 없는
            // keepalive가 keepalive_max회 누적되면 연결을 끊고 세션 종료가 전파된다.
            c.keepalive_interval = Some(std::time::Duration::from_secs(20));
            c.keepalive_max = 3;
            c
        });

        // 일부 macOS 환경에서 hostname을 직접 받는 ToSocketAddrs 경로가 IPv6/IPv4 fallback을
        // 깔끔히 처리하지 못해 ENETUNREACH가 발생하는 케이스가 있었다. 명시적으로 resolve해
        // IPv4를 먼저 시도하도록 정렬한 뒤 SocketAddr slice를 전달.
        let mut all_addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| SshError::Connect(format!("resolve {host}:{port}: {e}")))?
            .collect();
        if all_addrs.is_empty() {
            return Err(SshError::Connect(format!(
                "no addresses resolved for {host}:{port}"
            )));
        }
        all_addrs.sort_by_key(|a| if a.is_ipv4() { 0 } else { 1 });

        let connect_result = client::connect(config, &all_addrs[..], handler).await;

        let handle = match connect_result {
            Ok(h) => h,
            Err(e) => {
                // host key 거절로 인한 실패라면 더 구체적인 에러로 변환.
                if let Some(outcome) = shared.outcome.lock().expect("outcome lock").take() {
                    return Err(map_outcome_to_error(host, port, outcome).unwrap_or_else(|| {
                        SshError::Connect(e.to_string())
                    }));
                }
                return Err(SshError::Connect(e.to_string()));
            }
        };

        Self::auth_handle(handle, user, auth).await
    }

    /// 점프 호스트(ProxyJump)를 통해 대상 호스트에 접속한다 (#61). 먼저 점프 호스트와
    /// 연결한 뒤 그 위에 direct-tcpip 채널을 열고, 그 스트림을 전송로로 대상 호스트와
    /// 새 SSH 세션을 협상한다. 반환값의 두 번째 핸들(점프)은 대상 세션이 살아 있는 동안
    /// 함께 유지되어야 한다 — drop되면 터널이 끊긴다.
    pub async fn establish_via(
        jump: JumpSpec,
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<(client::Handle<TofuHandler>, client::Handle<TofuHandler>), SshError> {
        let jump_handle = Self::establish(
            &jump.host,
            jump.port,
            &jump.user,
            jump.auth,
            Arc::clone(&known_hosts),
        )
        .await?;

        let channel = jump_handle
            .channel_open_direct_tcpip(host.to_string(), port as u32, "127.0.0.1".to_string(), 0)
            .await
            .map_err(|e| {
                SshError::Channel(format!("proxyjump direct-tcpip {host}:{port}: {e}"))
            })?;
        let stream = channel.into_stream();

        let (handler, shared) = make_handler(known_hosts, host, port, Default::default());
        let config = Arc::new({
            let mut c = client::Config::default();
            // 절전/네트워크 단절로 죽은 연결을 ~1분 내 감지한다 (#96). 응답 없는
            // keepalive가 keepalive_max회 누적되면 연결을 끊고 세션 종료가 전파된다.
            c.keepalive_interval = Some(std::time::Duration::from_secs(20));
            c.keepalive_max = 3;
            c
        });
        let handle = match client::connect_stream(config, stream, handler).await {
            Ok(h) => h,
            Err(e) => {
                if let Some(outcome) = shared.outcome.lock().expect("outcome lock").take() {
                    return Err(map_outcome_to_error(host, port, outcome)
                        .unwrap_or_else(|| SshError::Connect(e.to_string())));
                }
                return Err(SshError::Connect(format!("proxyjump connect {host}:{port}: {e}")));
            }
        };
        let handle = Self::auth_handle(handle, user, auth).await?;
        Ok((handle, jump_handle))
    }

    /// 연결된 핸들에 대해 인증을 수행한다 (establish / establish_via 공용).
    async fn auth_handle(
        mut handle: client::Handle<TofuHandler>,
        user: &str,
        auth: ResolvedAuth,
    ) -> Result<client::Handle<TofuHandler>, SshError> {
        let auth_ok = match auth {
            ResolvedAuth::Password(pw) => handle
                .authenticate_password(user, pw)
                .await
                .map_err(|e| SshError::Auth(e.to_string()))?
                .success(),
            ResolvedAuth::PrivateKey(key) => {
                let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                handle
                    .authenticate_publickey(user, key_with_alg)
                    .await
                    .map_err(|e| SshError::Auth(e.to_string()))?
                    .success()
            }
            ResolvedAuth::Agent => authenticate_with_agent(&mut handle, user).await?,
        };
        if !auth_ok {
            return Err(SshError::Auth("authentication rejected".into()));
        }
        Ok(handle)
    }

    /// 호스트에 연결하고 PTY 채널을 연 뒤 actor 태스크를 띄운다.
    /// `known_hosts`는 TOFU 정책에 사용된다.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        cols: u16,
        rows: u16,
        session_id: SessionId,
        sink: DataSink,
        closed: crate::pty::manager::ClosedSink,
        known_hosts: Arc<KnownHostsStore>,
        jump: Option<JumpSpec>,
    ) -> Result<Self, SshError> {
        // ProxyJump이 지정되면 점프 호스트를 통해 접속하고, 점프 핸들을 actor 태스크에서
        // 유지한다(아래 spawn으로 move). 그렇지 않으면 직접 접속.
        let (handle, jump_keepalive) = match jump {
            Some(j) => {
                let (h, jk) =
                    Self::establish_via(j, host, port, user, auth, known_hosts).await?;
                (h, Some(jk))
            }
            None => (Self::establish(host, port, user, auth, known_hosts).await?, None),
        };

        // 핸들을 Arc로 감싸 세션에 보관 — 드래그 업로드 시 별도 exec 채널로 원격 cwd를 조회한다.
        // 원본 Arc는 아래 actor 태스크로 move되어 세션 수명 동안 연결을 유지한다.
        let handle = Arc::new(handle);
        let handle_for_session = Arc::clone(&handle);

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| SshError::Channel(e.to_string()))?;

        channel
            .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
            .await
            .map_err(|e| SshError::Channel(e.to_string()))?;
        channel
            .request_shell(false)
            .await
            .map_err(|e| SshError::Channel(e.to_string()))?;

        let (tx, mut rx) = mpsc::unbounded_channel::<SessionCmd>();
        let sink_for_pump = sink.clone();
        let id_for_pump = session_id.clone();

        // 주의: 접속 직후 원격 셸에 OSC 7 cwd 훅을 자동 주입하던 코드를 제거했다.
        // 주입 끝의 Ctrl-L(\x0c)가 배너/MOTD를 포함한 화면 전체를 지워(접속 첫 화면이 사라지고
        // 빈 줄만 남는 문제) — 로컬 셸에서 #37로 이미 폐기한 것과 동일한 취약점이다.
        // OSC 7 *수신* 핸들러는 유지되므로, 사용자가 원격 rc에 훅 한 줄을 추가하면 cwd 동기화는
        // 그대로 동작한다. 자동 주입이 없으면 SSH 파일 드래그 업로드는 원격 홈으로 폴백한다.

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    cmd = rx.recv() => {
                        match cmd {
                            Some(SessionCmd::Write(bytes)) => {
                                if channel.data(&bytes[..]).await.is_err() {
                                    break;
                                }
                            }
                            Some(SessionCmd::Resize { cols, rows }) => {
                                let _ = channel
                                    .window_change(cols.into(), rows.into(), 0, 0)
                                    .await;
                            }
                            Some(SessionCmd::Close) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { ref data }) => {
                                (sink_for_pump)(id_for_pump.clone(), data.to_vec());
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                (sink_for_pump)(id_for_pump.clone(), data.to_vec());
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            _ => {}
                        }
                    }
                }
            }
            drop(handle);
            // 점프 핸들도 여기서 함께 정리(세션 종료 시점). 이 태스크가 살아 있는 동안
            // jump_keepalive를 잡고 있어 ProxyJump 터널이 유지된다.
            drop(jump_keepalive);
            // 채널/연결 종료 — 프론트에 알린다 (#96, 끊김 표시·재접속 UI).
            (closed)(id_for_pump);
        });

        Ok(Self {
            tx,
            handle: handle_for_session,
        })
    }

    /// 원격 셸의 현재 작업 디렉터리를 조회한다(주입·화면 흔적 없음, Linux 원격 전용).
    /// 별도 exec 채널에서 `REMOTE_CWD_SCRIPT`를 실행해 stdout의 cwd 한 줄을 읽는다.
    /// 실패/타임아웃/비-Linux 원격이면 None → 호출자가 원격 홈으로 폴백한다.
    pub async fn remote_cwd(&self) -> Option<String> {
        let text = self.exec_capture(REMOTE_CWD_SCRIPT).await?;
        text.lines()
            .map(|l| l.trim())
            .find(|l| l.starts_with('/'))
            .map(|l| l.to_string())
    }

    /// 원격 tmux 세션 목록 (#89). 별도 exec 채널에서 `tmux list-sessions`를 실행해 파싱.
    /// tmux 미설치/서버 없음(목록 없음)/타임아웃이면 None.
    pub async fn tmux_sessions(&self) -> Option<Vec<TmuxSessionInfo>> {
        let out = self
            .exec_capture(
                "tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}' 2>/dev/null",
            )
            .await?;
        let list = TmuxSessionInfo::parse_lines(&out);
        if list.is_empty() {
            None
        } else {
            Some(list)
        }
    }

    /// 별도 exec 채널에서 명령을 실행하고 stdout 전체를 돌려준다(2초 상한).
    /// 대화형 셸 화면에 흔적을 남기지 않는다 — remote_cwd/tmux 목록 조회 공용.
    async fn exec_capture(&self, cmd: &str) -> Option<String> {
        let fut = async {
            let mut ch = self.handle.channel_open_session().await.ok()?;
            ch.exec(true, cmd.as_bytes()).await.ok()?;
            let mut out: Vec<u8> = Vec::new();
            while let Some(msg) = ch.wait().await {
                match msg {
                    ChannelMsg::Data { ref data } => out.extend_from_slice(&data[..]),
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Some(String::from_utf8_lossy(&out).to_string())
        };
        // 원격이 응답 안 해도 호출 UI가 멈추지 않도록 2초 상한.
        tokio::time::timeout(std::time::Duration::from_secs(2), fut)
            .await
            .ok()
            .flatten()
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), SshError> {
        self.tx
            .send(SessionCmd::Write(data.to_vec()))
            .map_err(|_| SshError::Channel("session terminated".into()))
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        self.tx
            .send(SessionCmd::Resize { cols, rows })
            .map_err(|_| SshError::Channel("session terminated".into()))
    }

    pub async fn close(&self) -> Result<(), SshError> {
        let _ = self.tx.send(SessionCmd::Close);
        Ok(())
    }
}

/// $SSH_AUTH_SOCK의 ssh-agent에 위임해 인증을 시도한다. 등록된 키를 차례로 시도하고
/// 첫 성공이면 통과.
///
/// ssh-agent 위임은 Unix 도메인 소켓($SSH_AUTH_SOCK) 기반이라 Unix 전용이다.
/// Windows에서는 named pipe 기반 agent를 후속에서 다루고, 지금은 미지원 에러를 반환한다.
#[cfg(unix)]
async fn authenticate_with_agent(
    handle: &mut client::Handle<TofuHandler>,
    user: &str,
) -> Result<bool, SshError> {
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::AgentIdentity;

    let sock_path = std::env::var("SSH_AUTH_SOCK")
        .map_err(|_| SshError::Auth("SSH_AUTH_SOCK not set — ssh-agent unavailable".into()))?;
    let stream = tokio::net::UnixStream::connect(&sock_path)
        .await
        .map_err(|e| SshError::Auth(format!("agent connect: {e}")))?;
    let mut agent = AgentClient::connect(stream);

    let identities = agent
        .request_identities()
        .await
        .map_err(|e| SshError::Auth(format!("agent identities: {e}")))?;

    if identities.is_empty() {
        return Err(SshError::Auth(
            "ssh-agent has no identities — run `ssh-add` to load a key".into(),
        ));
    }

    for identity in identities {
        let pubkey = match identity {
            AgentIdentity::PublicKey { key, .. } => key,
            // 인증서 자격증명은 v1에서 미지원 — 건너뛰고 다음 identity 시도.
            AgentIdentity::Certificate { .. } => continue,
        };
        let result = handle
            .authenticate_publickey_with(user, pubkey, None, &mut agent)
            .await
            .map_err(|e| SshError::Auth(format!("agent auth: {e}")))?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Windows 등 비-Unix 플랫폼: ssh-agent(UnixStream) 미지원 → 키/비밀번호 인증을 쓰도록 안내.
#[cfg(not(unix))]
async fn authenticate_with_agent(
    _handle: &mut client::Handle<TofuHandler>,
    _user: &str,
) -> Result<bool, SshError> {
    Err(SshError::Auth(
        "ssh-agent delegation is not supported on this platform yet — use a key or password".into(),
    ))
}

fn map_outcome_to_error(host: &str, port: u16, outcome: TofuOutcome) -> Option<SshError> {
    match outcome {
        TofuOutcome::Mismatch {
            algorithm,
            stored_fingerprint,
            presented_fingerprint,
        } => Some(SshError::HostKeyMismatch {
            host: host.into(),
            port,
            algorithm,
            stored: stored_fingerprint,
            presented: presented_fingerprint,
        }),
        TofuOutcome::FirstContactPending {
            algorithm,
            fingerprint,
        } => Some(SshError::FirstContactRequired {
            host: host.into(),
            port,
            algorithm,
            fingerprint,
        }),
        TofuOutcome::InternalError(msg) => Some(SshError::Connect(format!("known_hosts: {msg}"))),
        TofuOutcome::Accepted => None,
    }
}

/// `SshAuthMethod` + 비밀(`SecretStore`에서 조회한 평문) 조합으로 만들어지는
/// "실제로 russh가 받아먹는" 인증 자료. Agent variant는 connect 단계에서 $SSH_AUTH_SOCK 통해
/// ssh-agent에 위임된다 — secret store unlock 없이도 동작.
pub enum ResolvedAuth {
    Password(String),
    PrivateKey(PrivateKey),
    Agent,
}

impl std::fmt::Debug for ResolvedAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolvedAuth::Password(_) => f.write_str("ResolvedAuth::Password(<redacted>)"),
            ResolvedAuth::PrivateKey(_) => f.write_str("ResolvedAuth::PrivateKey(<redacted>)"),
            ResolvedAuth::Agent => f.write_str("ResolvedAuth::Agent"),
        }
    }
}

impl ResolvedAuth {
    pub fn from_method(
        method: &SshAuthMethod,
        password: Option<&[u8]>,
        key_pem: Option<&[u8]>,
        key_passphrase: Option<&[u8]>,
    ) -> Result<Self, SshError> {
        match method {
            SshAuthMethod::Password { .. } => {
                let pw = password.ok_or_else(|| SshError::Auth("missing password secret".into()))?;
                let s = std::str::from_utf8(pw)
                    .map_err(|_| SshError::Auth("password is not UTF-8".into()))?;
                Ok(ResolvedAuth::Password(s.to_string()))
            }
            SshAuthMethod::PrivateKey { .. } => {
                let pem = key_pem.ok_or_else(|| SshError::Auth("missing private key secret".into()))?;
                let pem_str = std::str::from_utf8(pem)
                    .map_err(|_| SshError::Auth("private key is not UTF-8".into()))?;
                let key = if let Some(pass) = key_passphrase {
                    let pass_str = std::str::from_utf8(pass)
                        .map_err(|_| SshError::Auth("passphrase is not UTF-8".into()))?;
                    PrivateKey::from_openssh(pem_str)
                        .and_then(|k| k.decrypt(pass_str.as_bytes()))
                        .map_err(|e| SshError::Auth(format!("key decrypt: {e}")))?
                } else {
                    PrivateKey::from_openssh(pem_str)
                        .map_err(|e| SshError::Auth(format!("key parse: {e}")))?
                };
                Ok(ResolvedAuth::PrivateKey(key))
            }
            SshAuthMethod::Agent => Ok(ResolvedAuth::Agent),
            SshAuthMethod::PasswordPrompt => Err(SshError::Auth(
                "PasswordPrompt must be resolved with explicit password via ssh_connect args"
                    .into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;
    use tokio::time::timeout;

    fn empty_sink() -> DataSink {
        Arc::new(|_, _| {})
    }

    fn tmp_known_hosts() -> PathBuf {
        std::env::temp_dir().join(format!("wowterm-kh-{}.toml", uuid::Uuid::new_v4()))
    }

    // 사전 생성한 ed25519 공개키 두 개 (테스트 픽스처).
    // ssh-keygen -t ed25519 -N "" -f /tmp/k 로 만들 수 있음.
    const TEST_PUB_A: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDiudAQkXZMAdKJhwZgnibeqjsLtEaZJxlFb4/xZac2Q test-a";
    const TEST_PUB_B: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6spJMgmrofylWwA6O6qyEpLySKJO/0WId5B1NFxn2D test-b";

    fn test_public_key(which: char) -> PublicKey {
        let s = if which == 'a' { TEST_PUB_A } else { TEST_PUB_B };
        PublicKey::from_openssh(s).expect("parse fixture key")
    }

    fn make_handler(store: Arc<KnownHostsStore>, host: &str, port: u16) -> (TofuHandler, TofuShared) {
        let shared = TofuShared {
            store,
            host: host.into(),
            port,
            outcome: Arc::new(Mutex::new(None)),
            remote_forwards: Default::default(),
        };
        (TofuHandler { shared: shared.clone() }, shared)
    }

    #[tokio::test]
    async fn first_contact_requires_confirmation() {
        // 새 정책: 첫 접속은 자동 저장 X. 거절 + FirstContactPending outcome.
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pubkey = test_public_key('a');
        let (mut handler, shared) = make_handler(store.clone(), "h", 22);

        let accepted = handler.check_server_key(&pubkey).await.unwrap();
        assert!(!accepted, "first contact must require explicit user trust");

        let outcome = shared.outcome.lock().unwrap().clone().unwrap();
        match outcome {
            TofuOutcome::FirstContactPending {
                algorithm,
                fingerprint,
            } => {
                assert_eq!(algorithm, "ssh-ed25519");
                assert!(fingerprint.starts_with("SHA256:"));
            }
            other => panic!("expected FirstContactPending, got {:?}", other),
        }

        // 자동 저장되지 않았는지 확인.
        let list = store.list().unwrap();
        assert!(list.is_empty(), "store must not record on silent first contact");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn user_trust_after_first_contact_then_match() {
        // 시나리오: 첫 접속(거절) → 사용자가 trust(=store.record) → 재접속 통과.
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pubkey = test_public_key('a');

        let (mut h1, _) = make_handler(store.clone(), "h", 22);
        assert!(!h1.check_server_key(&pubkey).await.unwrap());

        // 사용자가 모달에서 trust 클릭 → ssh_trust_known_host → record.
        let algo = pubkey.algorithm().as_str().to_string();
        let fp = pubkey.fingerprint(HashAlg::Sha256).to_string();
        store.record("h", 22, &algo, &fp).unwrap();

        let (mut h2, shared2) = make_handler(store.clone(), "h", 22);
        let accepted = h2.check_server_key(&pubkey).await.unwrap();
        assert!(accepted);
        let outcome = shared2.outcome.lock().unwrap().clone().unwrap();
        assert!(matches!(outcome, TofuOutcome::Accepted));

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn different_key_is_rejected_with_mismatch() {
        // 시나리오: trust로 키 A를 등록한 뒤, 다른 키 B로 접속 시도 → Mismatch.
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pub_old = test_public_key('a');
        let pub_new = test_public_key('b');

        // 사용자가 trust로 첫 키를 등록한 상태를 시뮬레이션.
        let algo = pub_old.algorithm().as_str().to_string();
        let fp = pub_old.fingerprint(HashAlg::Sha256).to_string();
        store.record("h", 22, &algo, &fp).unwrap();

        let (mut h2, shared2) = make_handler(store.clone(), "h", 22);
        let accepted = h2.check_server_key(&pub_new).await.unwrap();
        assert!(!accepted, "different key must be rejected");

        let outcome = shared2.outcome.lock().unwrap().clone().unwrap();
        match outcome {
            TofuOutcome::Mismatch {
                algorithm,
                stored_fingerprint,
                presented_fingerprint,
            } => {
                assert_eq!(algorithm, "ssh-ed25519");
                assert!(stored_fingerprint.starts_with("SHA256:"));
                assert!(presented_fingerprint.starts_with("SHA256:"));
                assert_ne!(stored_fingerprint, presented_fingerprint);
            }
            other => panic!("expected Mismatch, got {:?}", other),
        }

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn map_outcome_translates_mismatch() {
        let outcome = TofuOutcome::Mismatch {
            algorithm: "ssh-ed25519".into(),
            stored_fingerprint: "SHA256:a".into(),
            presented_fingerprint: "SHA256:b".into(),
        };
        let err = map_outcome_to_error("h", 22, outcome).unwrap();
        match err {
            SshError::HostKeyMismatch {
                host,
                port,
                algorithm,
                stored,
                presented,
            } => {
                assert_eq!(host, "h");
                assert_eq!(port, 22);
                assert_eq!(algorithm, "ssh-ed25519");
                assert_eq!(stored, "SHA256:a");
                assert_eq!(presented, "SHA256:b");
            }
            other => panic!("expected HostKeyMismatch, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn map_outcome_translates_first_contact() {
        let outcome = TofuOutcome::FirstContactPending {
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:xyz".into(),
        };
        let err = map_outcome_to_error("h", 22, outcome).unwrap();
        match err {
            SshError::FirstContactRequired {
                host,
                port,
                algorithm,
                fingerprint,
            } => {
                assert_eq!(host, "h");
                assert_eq!(port, 22);
                assert_eq!(algorithm, "ssh-ed25519");
                assert_eq!(fingerprint, "SHA256:xyz");
            }
            other => panic!("expected FirstContactRequired, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn connect_to_unreachable_port_returns_connect_error() {
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));

        let result = SshSession::connect(
            "127.0.0.1",
            1,
            "nobody",
            ResolvedAuth::Password("x".into()),
            80,
            24,
            "test-session".into(),
            empty_sink(),
            store,
            None,
        );
        let result = timeout(Duration::from_secs(5), result)
            .await
            .expect("connect should fail fast, not hang");
        match result {
            Err(SshError::Connect(_)) | Err(SshError::Auth(_)) => {}
            other => panic!("expected Connect or Auth error, got {:?}", other.is_ok()),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn resolved_auth_password_requires_password_bytes() {
        let m = SshAuthMethod::Password { secret_id: "x".into() };
        let err = ResolvedAuth::from_method(&m, None, None, None).unwrap_err();
        assert!(matches!(err, SshError::Auth(_)));
    }

    #[test]
    fn resolved_auth_password_decodes_utf8() {
        let m = SshAuthMethod::Password { secret_id: "x".into() };
        let auth = ResolvedAuth::from_method(&m, Some(b"hello"), None, None).unwrap();
        match auth {
            ResolvedAuth::Password(s) => assert_eq!(s, "hello"),
            _ => panic!("expected Password"),
        }
    }

    #[test]
    fn resolved_auth_agent_returns_agent_variant() {
        let m = SshAuthMethod::Agent;
        let auth = ResolvedAuth::from_method(&m, None, None, None).unwrap();
        assert!(matches!(auth, ResolvedAuth::Agent));
    }

    #[test]
    fn resolved_auth_private_key_invalid_pem_fails() {
        let m = SshAuthMethod::PrivateKey {
            key_id: "x".into(),
            passphrase_secret_id: None,
        };
        let err = ResolvedAuth::from_method(&m, None, Some(b"not a key"), None).unwrap_err();
        assert!(matches!(err, SshError::Auth(_)));
    }
}
