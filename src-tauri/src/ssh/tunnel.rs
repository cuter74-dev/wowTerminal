//! 포트 포워딩 (#60). SSH 연결 위에 로컬(-L)/다이내믹(-D SOCKS5) 터널을 연다.
//!
//! 각 터널은 전용 SSH 핸들을 establish하고 로컬 TCP 리스너를 띄운다. 리스너가
//! 받은 연결마다 `direct-tcpip` 채널을 열어 양방향으로 바이트를 펌프한다.
//! 원격(-R)은 서버가 채널을 여는 방향이라 Handler 확장이 필요 — 후속 과제.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use super::known_hosts::KnownHostsStore;
use super::manager::SshError;
use super::session::{RemoteForwards, ResolvedAuth, SshSession, TofuHandler};
use super::types::SshHost;

type Handle = russh::client::Handle<TofuHandler>;

#[derive(Clone, serde::Serialize)]
pub struct TunnelInfo {
    pub id: String,
    pub host_id: String,
    /// "local" | "dynamic"
    pub kind: String,
    pub local_host: String,
    pub local_port: u16,
    /// dynamic이면 빈 문자열.
    pub remote_host: String,
    /// dynamic이면 0.
    pub remote_port: u16,
}

struct Tunnel {
    info: TunnelInfo,
    /// 리스너 태스크 중단 핸들. drop/abort 시 SSH 핸들도 함께 정리된다.
    abort: tokio::task::AbortHandle,
}

pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, Tunnel>>,
    known_hosts: Arc<KnownHostsStore>,
}

impl TunnelManager {
    pub fn new(known_hosts: Arc<KnownHostsStore>) -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
            known_hosts,
        }
    }

    async fn establish(&self, host: &SshHost, auth: ResolvedAuth) -> Result<Handle, SshError> {
        SshSession::establish(
            &host.host,
            host.port,
            &host.user,
            auth,
            Arc::clone(&self.known_hosts),
        )
        .await
    }

    /// 로컬 포워드(-L): local_host:local_port 로 들어온 연결을 SSH 너머
    /// remote_host:remote_port 로 전달. 실제 바인딩된 포트를 담은 TunnelInfo 반환.
    pub async fn start_local(
        &self,
        id: String,
        host: SshHost,
        auth: ResolvedAuth,
        local_host: String,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
    ) -> Result<TunnelInfo, SshError> {
        let handle = Arc::new(self.establish(&host, auth).await?);
        let listener = TcpListener::bind((local_host.as_str(), local_port))
            .await
            .map_err(|e| SshError::Io(format!("bind {local_host}:{local_port}: {e}")))?;
        let bound = listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(local_port);

        let rhost = remote_host.clone();
        let task = tokio::spawn(async move {
            loop {
                let (socket, peer) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let h = handle.clone();
                let target = rhost.clone();
                tokio::spawn(async move {
                    let ch = match h
                        .channel_open_direct_tcpip(
                            target,
                            remote_port as u32,
                            peer.ip().to_string(),
                            peer.port() as u32,
                        )
                        .await
                    {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    let mut stream = ch.into_stream();
                    let mut sock = socket;
                    let _ = tokio::io::copy_bidirectional(&mut sock, &mut stream).await;
                });
            }
            // 리스너가 끝나면 handle을 drop해 SSH 세션 정리.
            drop(handle);
        });

        let info = TunnelInfo {
            id: id.clone(),
            host_id: host.id.clone(),
            kind: "local".into(),
            local_host,
            local_port: bound,
            remote_host,
            remote_port,
        };
        self.tunnels.lock().await.insert(
            id,
            Tunnel {
                info: info.clone(),
                abort: task.abort_handle(),
            },
        );
        Ok(info)
    }

    /// 다이내믹 포워드(-D): 로컬 SOCKS5 프록시. 클라이언트가 요청한 목적지로
    /// SSH 너머 direct-tcpip 채널을 연다.
    pub async fn start_dynamic(
        &self,
        id: String,
        host: SshHost,
        auth: ResolvedAuth,
        local_host: String,
        local_port: u16,
    ) -> Result<TunnelInfo, SshError> {
        let handle = Arc::new(self.establish(&host, auth).await?);
        let listener = TcpListener::bind((local_host.as_str(), local_port))
            .await
            .map_err(|e| SshError::Io(format!("bind {local_host}:{local_port}: {e}")))?;
        let bound = listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(local_port);

        let task = tokio::spawn(async move {
            loop {
                let (socket, peer) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let h = handle.clone();
                tokio::spawn(async move {
                    let mut sock = socket;
                    let (dst_host, dst_port) = match socks5_handshake(&mut sock).await {
                        Ok(v) => v,
                        Err(_) => return,
                    };
                    let ch = match h
                        .channel_open_direct_tcpip(
                            dst_host,
                            dst_port as u32,
                            peer.ip().to_string(),
                            peer.port() as u32,
                        )
                        .await
                    {
                        Ok(c) => c,
                        Err(_) => {
                            // 연결 실패 응답(REP=0x05 connection refused).
                            let _ = sock
                                .write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
                                .await;
                            return;
                        }
                    };
                    // 성공 응답(REP=0x00).
                    if sock
                        .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
                        .await
                        .is_err()
                    {
                        return;
                    }
                    let mut stream = ch.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut sock, &mut stream).await;
                });
            }
            drop(handle);
        });

        let info = TunnelInfo {
            id: id.clone(),
            host_id: host.id.clone(),
            kind: "dynamic".into(),
            local_host,
            local_port: bound,
            remote_host: String::new(),
            remote_port: 0,
        };
        self.tunnels.lock().await.insert(
            id,
            Tunnel {
                info: info.clone(),
                abort: task.abort_handle(),
            },
        );
        Ok(info)
    }

    /// 원격 포워드(-R): 서버의 bind_host:bind_port 로 들어온 연결을 SSH 너머
    /// 클라이언트 측 local_host:local_port 로 전달. tcpip_forward로 서버에 리스닝을 요청하고
    /// forwarded-tcpip 채널은 핸들러(server_channel_open_forwarded_tcpip)가 처리한다.
    pub async fn start_remote(
        &self,
        id: String,
        host: SshHost,
        auth: ResolvedAuth,
        bind_host: String,
        bind_port: u16,
        local_host: String,
        local_port: u16,
    ) -> Result<TunnelInfo, SshError> {
        let forwards: RemoteForwards = Arc::new(std::sync::Mutex::new(HashMap::new()));
        forwards
            .lock()
            .expect("remote_forwards poisoned")
            .insert(bind_port, (local_host.clone(), local_port));

        let handle = SshSession::establish_with_forwards(
            &host.host,
            host.port,
            &host.user,
            auth,
            Arc::clone(&self.known_hosts),
            Arc::clone(&forwards),
        )
        .await?;

        let bound = handle
            .tcpip_forward(bind_host.clone(), bind_port as u32)
            .await
            .map_err(|e| SshError::Channel(format!("tcpip_forward {bind_host}:{bind_port}: {e}")))?;

        let task = tokio::spawn(async move {
            // 핸들과 라우팅 표를 잡아둬 -R 세션을 유지(handler 콜백이 동작). abort 시 정리.
            let _keep_handle = handle;
            let _keep_forwards = forwards;
            std::future::pending::<()>().await;
        });

        let info = TunnelInfo {
            id: id.clone(),
            host_id: host.id.clone(),
            kind: "remote".into(),
            local_host,
            local_port,
            remote_host: bind_host,
            remote_port: bound as u16,
        };
        self.tunnels.lock().await.insert(
            id,
            Tunnel {
                info: info.clone(),
                abort: task.abort_handle(),
            },
        );
        Ok(info)
    }

    pub async fn stop(&self, id: &str) -> Result<(), SshError> {
        let t = self
            .tunnels
            .lock()
            .await
            .remove(id)
            .ok_or_else(|| SshError::NotFound(id.into()))?;
        t.abort.abort();
        Ok(())
    }

    pub async fn list(&self) -> Vec<TunnelInfo> {
        self.tunnels
            .lock()
            .await
            .values()
            .map(|t| t.info.clone())
            .collect()
    }
}

/// SOCKS5 핸드셰이크를 처리하고 목적지 (host, port)를 돌려준다. 성공 응답은
/// 채널을 연 뒤 호출자가 보낸다(연결 실패도 정확히 보고하기 위해).
async fn socks5_handshake(sock: &mut TcpStream) -> Result<(String, u16), SshError> {
    // 1) 그리팅: VER, NMETHODS, METHODS[NMETHODS]
    let mut head = [0u8; 2];
    sock.read_exact(&mut head)
        .await
        .map_err(|e| SshError::Io(format!("socks greet: {e}")))?;
    if head[0] != 5 {
        return Err(SshError::Channel("socks: not v5".into()));
    }
    let nmethods = head[1] as usize;
    let mut methods = vec![0u8; nmethods];
    sock.read_exact(&mut methods)
        .await
        .map_err(|e| SshError::Io(format!("socks methods: {e}")))?;
    // no-auth(0x00) 선택.
    sock.write_all(&[5, 0])
        .await
        .map_err(|e| SshError::Io(format!("socks method reply: {e}")))?;

    // 2) 요청: VER, CMD, RSV, ATYP, ADDR, PORT
    let mut req = [0u8; 4];
    sock.read_exact(&mut req)
        .await
        .map_err(|e| SshError::Io(format!("socks req: {e}")))?;
    if req[1] != 1 {
        // CONNECT(0x01)만 지원.
        let _ = sock.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await;
        return Err(SshError::Channel("socks: only CONNECT supported".into()));
    }
    let host = match req[3] {
        1 => {
            let mut a = [0u8; 4];
            sock.read_exact(&mut a)
                .await
                .map_err(|e| SshError::Io(format!("socks ipv4: {e}")))?;
            format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3])
        }
        3 => {
            let mut len = [0u8; 1];
            sock.read_exact(&mut len)
                .await
                .map_err(|e| SshError::Io(format!("socks domlen: {e}")))?;
            let mut d = vec![0u8; len[0] as usize];
            sock.read_exact(&mut d)
                .await
                .map_err(|e| SshError::Io(format!("socks domain: {e}")))?;
            String::from_utf8_lossy(&d).to_string()
        }
        4 => {
            let mut a = [0u8; 16];
            sock.read_exact(&mut a)
                .await
                .map_err(|e| SshError::Io(format!("socks ipv6: {e}")))?;
            let seg: Vec<String> = a
                .chunks(2)
                .map(|c| format!("{:02x}{:02x}", c[0], c[1]))
                .collect();
            seg.join(":")
        }
        _ => {
            let _ = sock.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(SshError::Channel("socks: bad atyp".into()));
        }
    };
    let mut port = [0u8; 2];
    sock.read_exact(&mut port)
        .await
        .map_err(|e| SshError::Io(format!("socks port: {e}")))?;
    let port = u16::from_be_bytes(port);
    Ok((host, port))
}
