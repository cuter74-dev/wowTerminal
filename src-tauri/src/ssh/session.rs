//! russh 클라이언트 + PTY 채널을 감싼 [`SshSession`].
//!
//! 채널 자체는 actor 태스크가 소유한다. 외부에서는 [`tokio::sync::mpsc`]로 명령
//! ([`SessionCmd`])을 보내고, 채널이 받은 데이터는 [`crate::pty::manager::DataSink`]
//! 콜백으로 흘러나간다.
//!
//! 호스트 키 검증은 [`TofuHandler`]가 담당. 첫 접속이면 저장, 일치하면 통과,
//! 불일치면 거절 + outcome 기록. 거절은 러닝 중인 connect()가 일반 에러로 반환되므로
//! 호출 측에서 outcome을 확인해 [`SshError::HostKeyMismatch`]로 변환한다.

use std::sync::{Arc, Mutex};

use russh::client::{self, Handler};
use russh::keys::ssh_key::{HashAlg, PrivateKey, PublicKey};
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use tokio::sync::mpsc;

use crate::pty::manager::DataSink;

use super::known_hosts::{KnownHostsStore, MatchResult};
use super::manager::SshError;
use super::types::SshAuthMethod;

pub type SessionId = String;

/// 호스트 키 검증 결과 — TofuHandler가 connect 도중에 채워준다.
#[derive(Debug, Clone)]
enum TofuOutcome {
    Accepted,
    FirstContactRecorded,
    Mismatch {
        algorithm: String,
        stored_fingerprint: String,
        presented_fingerprint: String,
    },
    InternalError(String),
}

#[derive(Clone)]
struct TofuShared {
    store: Arc<KnownHostsStore>,
    host: String,
    port: u16,
    outcome: Arc<Mutex<Option<TofuOutcome>>>,
}

/// TOFU 정책 핸들러.
struct TofuHandler {
    shared: TofuShared,
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
            Ok(MatchResult::FirstContact) => {
                match self.shared.store.record(
                    &self.shared.host,
                    self.shared.port,
                    &algorithm,
                    &fingerprint,
                ) {
                    Ok(_) => (true, TofuOutcome::FirstContactRecorded),
                    Err(e) => (false, TofuOutcome::InternalError(e.to_string())),
                }
            }
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
}

/// 외부 → actor 태스크로 보내는 명령.
enum SessionCmd {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

pub struct SshSession {
    tx: mpsc::UnboundedSender<SessionCmd>,
}

impl SshSession {
    /// 호스트에 연결하고 PTY 채널을 연 뒤 actor 태스크를 띄운다.
    /// `known_hosts`는 TOFU 정책에 사용된다.
    pub async fn connect(
        host: &str,
        port: u16,
        user: &str,
        auth: ResolvedAuth,
        cols: u16,
        rows: u16,
        session_id: SessionId,
        sink: DataSink,
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<Self, SshError> {
        let shared = TofuShared {
            store: known_hosts,
            host: host.to_string(),
            port,
            outcome: Arc::new(Mutex::new(None)),
        };
        let handler = TofuHandler {
            shared: shared.clone(),
        };

        let config = Arc::new(client::Config::default());
        let connect_result = client::connect(config, (host, port), handler).await;

        let mut handle = match connect_result {
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
        TofuOutcome::InternalError(msg) => Some(SshError::Connect(format!("known_hosts: {msg}"))),
        TofuOutcome::Accepted | TofuOutcome::FirstContactRecorded => None,
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
        };
        (TofuHandler { shared: shared.clone() }, shared)
    }

    #[tokio::test]
    async fn first_contact_records_and_accepts() {
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pubkey = test_public_key('a');
        let (mut handler, shared) = make_handler(store.clone(), "h", 22);

        let accepted = handler.check_server_key(&pubkey).await.unwrap();
        assert!(accepted);

        let outcome = shared.outcome.lock().unwrap().clone().unwrap();
        assert!(matches!(outcome, TofuOutcome::FirstContactRecorded));

        // 저장됐는지 직접 확인.
        let list = store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].0, "h:22");
        assert!(list[0].1.fingerprint.starts_with("SHA256:"));

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn same_key_on_second_visit_accepts() {
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pubkey = test_public_key('a');

        let (mut h1, _) = make_handler(store.clone(), "h", 22);
        assert!(h1.check_server_key(&pubkey).await.unwrap());

        let (mut h2, shared2) = make_handler(store.clone(), "h", 22);
        let accepted = h2.check_server_key(&pubkey).await.unwrap();
        assert!(accepted);
        let outcome = shared2.outcome.lock().unwrap().clone().unwrap();
        assert!(matches!(outcome, TofuOutcome::Accepted));

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn different_key_is_rejected_with_mismatch() {
        let path = tmp_known_hosts();
        let store = Arc::new(KnownHostsStore::new(&path));
        let pub_old = test_public_key('a');
        let pub_new = test_public_key('b');

        let (mut h1, _) = make_handler(store.clone(), "h", 22);
        assert!(h1.check_server_key(&pub_old).await.unwrap());

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
}
