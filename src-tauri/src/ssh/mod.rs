//! SSH 매니저.
//!
//! - 호스트 프로필 (이름, host, port, user, 인증 방식) 저장 — [`store::HostStore`]
//! - SSH 세션 (russh 클라이언트 + PTY 채널) — [`session::SshSession`]
//! - 활성 세션 관리 — [`manager::SshManager`]
//! - 자세한 설계는 `docs/design/ssh-manager.md` 참고.

pub mod commands;
pub mod groups;
pub mod known_hosts;
pub mod manager;
pub mod session;
pub mod store;
pub mod tags;
pub mod types;

pub use known_hosts::{KnownHostEntry, KnownHostsStore};
pub use manager::{SshError, SshManager};
pub use store::HostStore;
pub use types::*;
