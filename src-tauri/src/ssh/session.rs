//! russh 클라이언트 + PTY 채널을 감싼 [`SshSession`].
//!
//! 채널 자체는 actor 태스크가 소유한다. 외부에서는 [`tokio::sync::mpsc`]로 명령
//! ([`SessionCmd`])을 보내고, 채널이 받은 데이터는 [`crate::pty::manager::DataSink`]
//! 콜백으로 흘러나간다.

use std::sync::Arc;

use russh::client::{self, Handler};
use russh::keys::ssh_key::PrivateKey;
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use tokio::sync::mpsc;

use crate::pty::manager::DataSink;

use super::manager::SshError;
use super::types::SshAuthMethod;

pub type SessionId = String;

/// 호스트 키 검증 정책. v1은 단순화를 위해 무조건 수락 (TOFU 미구현).
struct PermissiveHandler;

impl Handler for PermissiveHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: known_hosts 기반 TOFU 검증 도입.
        Ok(true)
    }
}

/// 외부 → actor 태스크로 보내는 명령.
enum SessionCmd {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

/// SSH 세션 핸들. drop 또는 [`close`]까지 actor 태스크는 살아있다.
pub struct SshSession {
    tx: mpsc::UnboundedSender<SessionCmd>,
}

impl SshSession {
    /// 호스트에 연결하고 PTY 채널을 연 뒤 actor 태스크를 띄운다.
    pub async fn connect(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        cols: u16,
        rows: u16,
        session_id: SessionId,
        sink: DataSink,
    ) -> Result<Self, SshError> {
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (host, port), PermissiveHandler)
            .await
            .map_err(|e| SshError::Connect(e.to_string()))?;

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
        };
        if !auth_ok {
            return Err(SshError::Auth("authentication rejected".into()));
        }

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

        // actor 태스크: 채널 owning + cmd 수신 + 채널 메시지 처리.
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
            // 채널 닫힘. handle은 drop되면서 정리.
            drop(handle);
        });

        Ok(Self { tx })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Duration;
    use tokio::time::timeout;

    fn empty_sink() -> DataSink {
        Arc::new(|_, _| {})
    }

    #[tokio::test]
    async fn connect_to_unreachable_port_returns_connect_error() {
        // 거의 확실히 닫혀있는 포트.
        let result = SshSession::connect(
            "127.0.0.1",
            1,
            "nobody",
            ResolvedAuth::Password("x".into()),
            80,
            24,
            "test-session".into(),
            empty_sink(),
        );
        let result = timeout(Duration::from_secs(5), result)
            .await
            .expect("connect should fail fast, not hang");
        match result {
            Err(SshError::Connect(_)) | Err(SshError::Auth(_)) => {}
            other => panic!("expected Connect or Auth error, got {:?}", other.is_ok()),
        }
    }

    #[test]
    fn resolved_auth_password_requires_password_bytes() {
        let m = SshAuthMethod::Password {
            secret_id: "x".into(),
        };
        let err = ResolvedAuth::from_method(&m, None, None, None).unwrap_err();
        assert!(matches!(err, SshError::Auth(_)));
    }

    #[test]
    fn resolved_auth_password_decodes_utf8() {
        let m = SshAuthMethod::Password {
            secret_id: "x".into(),
        };
        let auth = ResolvedAuth::from_method(&m, Some(b"hello"), None, None).unwrap();
        match auth {
            ResolvedAuth::Password(s) => assert_eq!(s, "hello"),
            _ => panic!("expected Password"),
        }
    }

    #[test]
    fn resolved_auth_agent_not_implemented() {
        let m = SshAuthMethod::Agent;
        let err = ResolvedAuth::from_method(&m, None, None, None).unwrap_err();
        match err {
            SshError::Auth(msg) => assert!(msg.contains("not yet implemented")),
            other => panic!("expected Auth, got {:?}", other),
        }
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

    /// 가짜 sink 헬퍼 — 채널 도착 데이터 확인용. Mutex로 보호된 Vec 사용.
    #[allow(dead_code)]
    fn vec_sink() -> (DataSink, Arc<Mutex<Vec<(SessionId, Vec<u8>)>>>) {
        let store: Arc<Mutex<Vec<(SessionId, Vec<u8>)>>> = Arc::new(Mutex::new(Vec::new()));
        let s = Arc::clone(&store);
        let sink: DataSink = Arc::new(move |id, data| {
            s.lock().expect("sink store poisoned").push((id, data));
        });
        (sink, store)
    }
}

/// `SshAuthMethod` + 비밀(`SecretStore`에서 조회한 평문) 조합으로 만들어지는
/// "실제로 russh가 받아먹는" 인증 자료.
pub enum ResolvedAuth {
    Password(String),
    PrivateKey(PrivateKey),
}

impl std::fmt::Debug for ResolvedAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // 비밀번호/키 내용을 디버그 출력에 노출하지 않는다.
            ResolvedAuth::Password(_) => f.write_str("ResolvedAuth::Password(<redacted>)"),
            ResolvedAuth::PrivateKey(_) => f.write_str("ResolvedAuth::PrivateKey(<redacted>)"),
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
            SshAuthMethod::Agent => Err(SshError::Auth(
                "ssh-agent delegation not yet implemented".into(),
            )),
        }
    }
}
