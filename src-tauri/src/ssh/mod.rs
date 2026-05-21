//! SSH 매니저.
//!
//! - 호스트 프로필 (이름, host, port, user, 인증 방식) 저장
//! - 개인키는 OS 키링 또는 사용자 패스프레이즈 기반 암호화로 보관 (절대 평문 X)
//! - 자세한 설계는 `docs/design/ssh-manager.md` 참고.

pub mod types;

pub use types::*;
