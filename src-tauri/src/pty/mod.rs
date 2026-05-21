//! 로컬 PTY 세션 관리.
//!
//! 각 세션은 portable-pty의 `PtyPair`를 들고, master 쪽 reader/writer를 별도 스레드에서 다룬다.
//! 출력은 Tauri event `pty:output`으로 프론트엔드에 전달된다.

pub mod commands;
pub mod manager;

pub use manager::{PtyError, PtyManager, SessionId};
