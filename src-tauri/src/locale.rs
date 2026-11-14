//! 터미널 세션의 UTF-8 언어 설정 (#189).
//!
//! Finder/Dock으로 띄운 macOS 앱에는 `LANG`이 없다. 그러면 로컬 셸과, 언어 설정을 넘겨받지 못한
//! 원격 서버의 tmux가 UTF-8을 쓰지 않고 `❯`·`…`·회전 표시 같은 글자를 `_`로 바꾼다 — Claude Code
//! 화면이 깨지고 에이전트 표시(#180/#187)도 사라진다(실제 앱 + Ubuntu 서버에서 재현).
//! - 로컬 PTY: `LANG`이 없으면 macOS 터미널 앱처럼 시스템 언어로 채운다(맥에는 모든 로캘이 있다).
//! - SSH: OpenSSH(`SendEnv LANG LC_*`)처럼 넘긴다. 앱에 UTF-8 `LANG`이 있으면 그 값, 없으면 문자
//!   집합만 정하는 `LC_CTYPE=C.UTF-8` — `ko_KR.UTF-8`은 그 로캘이 없는 서버(최소 설치 등)에서
//!   setlocale 경고를 띄우고, `C.UTF-8`은 요즘 리눅스에 거의 다 있으며 메시지 언어를 바꾸지 않는다.
use std::sync::OnceLock;

/// 로캘 값이 UTF-8인지(`ko_KR.UTF-8`, `C.utf8` 등).
pub fn is_utf8(v: &str) -> bool {
    let l = v.to_ascii_lowercase();
    l.contains("utf-8") || l.contains("utf8")
}

/// BCP 47 태그(`ko-KR`, `zh-Hans-CN`)를 POSIX 로캘(`ko_KR.UTF-8`)로. 지역이 없으면 None.
pub fn posix_from_bcp47(tag: &str) -> Option<String> {
    let parts: Vec<&str> = tag.split(['-', '_']).collect();
    let lang = parts.first()?.to_ascii_lowercase();
    if !(2..=3).contains(&lang.len()) || !lang.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let region = parts
        .iter()
        .skip(1)
        .rev()
        .find(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_alphabetic()))?;
    Some(format!("{}_{}.UTF-8", lang, region.to_ascii_uppercase()))
}

/// 로컬 셸에 줄 `LANG`(순수 함수 — 시험용). 환경 값이 UTF-8이면 그것, 아니면 시스템 언어,
/// 그것도 없으면 `en_US.UTF-8`.
pub fn choose_local(env_lang: Option<&str>, system: Option<&str>) -> String {
    if let Some(l) = env_lang.filter(|l| is_utf8(l)) {
        return l.to_string();
    }
    system
        .and_then(posix_from_bcp47)
        .unwrap_or_else(|| "en_US.UTF-8".to_string())
}

/// SSH로 넘길 환경 변수 하나(순수 함수 — 시험용).
pub fn choose_ssh(env_lang: Option<&str>) -> (&'static str, String) {
    match env_lang.filter(|l| is_utf8(l)) {
        Some(l) => ("LANG", l.to_string()),
        None => ("LC_CTYPE", "C.UTF-8".to_string()),
    }
}

fn env_lang() -> Option<String> {
    std::env::var("LANG").ok().filter(|v| !v.is_empty())
}

/// 로컬 셸의 `LANG`이 비어 있을 때 채울 값.
pub fn local_lang() -> &'static str {
    static V: OnceLock<String> = OnceLock::new();
    V.get_or_init(|| choose_local(env_lang().as_deref(), sys_locale::get_locale().as_deref()))
}

/// SSH 셸 채널에 요청할 환경 변수.
pub fn ssh_env() -> (&'static str, &'static str) {
    static V: OnceLock<(&'static str, String)> = OnceLock::new();
    let (k, v) = V.get_or_init(|| choose_ssh(env_lang().as_deref()));
    (k, v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bcp47_to_posix() {
        assert_eq!(posix_from_bcp47("ko-KR").as_deref(), Some("ko_KR.UTF-8"));
        assert_eq!(posix_from_bcp47("en_US").as_deref(), Some("en_US.UTF-8"));
        assert_eq!(posix_from_bcp47("zh-Hans-CN").as_deref(), Some("zh_CN.UTF-8"));
        assert_eq!(posix_from_bcp47("ja"), None);
        assert_eq!(posix_from_bcp47(""), None);
    }

    #[test]
    fn local_prefers_utf8_env_then_system() {
        assert_eq!(choose_local(Some("en_GB.UTF-8"), Some("ko-KR")), "en_GB.UTF-8");
        assert_eq!(choose_local(Some("C"), Some("ko-KR")), "ko_KR.UTF-8");
        assert_eq!(choose_local(None, Some("ko-KR")), "ko_KR.UTF-8");
        assert_eq!(choose_local(None, Some("ja")), "en_US.UTF-8");
        assert_eq!(choose_local(None, None), "en_US.UTF-8");
    }

    #[test]
    fn ssh_sends_lang_like_openssh_or_only_the_charset() {
        assert_eq!(choose_ssh(Some("ko_KR.UTF-8")), ("LANG", "ko_KR.UTF-8".to_string()));
        assert_eq!(choose_ssh(None), ("LC_CTYPE", "C.UTF-8".to_string()));
        assert_eq!(choose_ssh(Some("C")), ("LC_CTYPE", "C.UTF-8".to_string()));
    }
}
