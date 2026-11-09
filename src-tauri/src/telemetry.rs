//! 오류 추적(GlitchTip)으로 나가는 백엔드 이벤트에서 개인 정보를 걷어 낸다 (#177).
//!
//! sentry의 `contexts` 통합은 컴퓨터 이름을 `server_name`으로 붙인다(iOS는 기기 이름).
//! panic 메시지에는 홈 폴더 경로나 컴퓨터 이름이 섞일 수 있다. 보내기 직전에 그 둘을 가리고,
//! 사용자·extra·breadcrumb·요청 정보는 지운다. OS·기기 종류·스택 위치(소스 파일:줄)는 남긴다.
//!
//! 설정의 "오류 보고 보내기"를 끄면(#178) 아무것도 보내지 않는다. 그 선택은 설정 폴더의
//! `error-reports-off` 파일로 남겨 다음 실행에도 지킨다(프런트 설정은 localStorage라 Rust가
//! 시작 때 읽을 수 없다). 실행 중 바꾸면 `before_send`가 곧바로 모든 이벤트를 버린다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// 오류 보고를 보낼지. 기본은 보낸다.
static ENABLED: AtomicBool = AtomicBool::new(true);
/// 끔 표시 파일이 있는 설정 폴더(앱 시작 때 정해진다).
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();
const OFF_FILE: &str = "error-reports-off";

/// 설정 폴더에 끔 표시가 있는지.
pub fn is_off_in(dir: &Path) -> bool {
    dir.join(OFF_FILE).exists()
}

/// 끔 표시를 남기거나 지운다.
pub fn write_pref(dir: &Path, enabled: bool) -> std::io::Result<()> {
    let f = dir.join(OFF_FILE);
    if enabled {
        match std::fs::remove_file(&f) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    } else {
        std::fs::write(f, b"")
    }
}

/// 앱 시작 때 한 번: 설정 폴더를 기억하고 저장된 선택을 적용한다.
pub fn load_pref(dir: &Path) {
    let _ = CONFIG_DIR.set(dir.to_path_buf());
    ENABLED.store(!is_off_in(dir), Ordering::SeqCst);
}

/// 설정 화면에서 "오류 보고 보내기"를 바꿀 때(#178).
#[tauri::command]
pub fn set_error_reporting(enabled: bool) -> Result<(), String> {
    ENABLED.store(enabled, Ordering::SeqCst);
    if let Some(dir) = CONFIG_DIR.get() {
        write_pref(dir, enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 문자열 하나에서 홈 폴더 경로와 컴퓨터 이름을 가린다.
pub fn scrub(text: &str, home: Option<&str>, host: Option<&str>) -> String {
    let mut s = text.to_string();
    if let Some(home) = home.filter(|h| h.len() > 1) {
        s = s.replace(home, "~");
    }
    // 너무 짧은 이름은 평범한 낱말까지 지울 수 있어 건너뛴다.
    if let Some(host) = host.filter(|h| h.len() >= 3) {
        s = s.replace(host, "<host>");
    }
    s
}

/// 이 기기의 컴퓨터 이름.
fn local_host_name() -> Option<String> {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
        if rc == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            let name = String::from_utf8_lossy(&buf[..end]).into_owned();
            if !name.is_empty() {
                return Some(name);
            }
        }
        None
    }
    #[cfg(not(unix))]
    {
        std::env::var("COMPUTERNAME").ok()
    }
}

/// sentry `before_send` — 꺼져 있으면 버리고, 아니면 개인 정보를 걷어 낸다.
pub fn scrub_event(
    ev: sentry::protocol::Event<'static>,
) -> Option<sentry::protocol::Event<'static>> {
    filter_event(ev, ENABLED.load(Ordering::SeqCst))
}

/// 개인 정보 필드를 지우고 글자를 가린다. `enabled`가 false면 보내지 않는다.
fn filter_event(
    mut ev: sentry::protocol::Event<'static>,
    enabled: bool,
) -> Option<sentry::protocol::Event<'static>> {
    if !enabled {
        return None;
    }
    let home = dirs::home_dir().map(|p| p.to_string_lossy().into_owned());
    let mut hosts: Vec<String> = local_host_name().into_iter().collect();
    if let Some(sn) = ev.server_name.take() {
        hosts.push(sn.into_owned());
    }
    // ".local" 같은 접미사가 붙은 이름도 앞부분으로 가린다(긴 것부터).
    let mut names: Vec<String> = Vec::new();
    for h in hosts {
        if let Some((short, _)) = h.split_once('.') {
            names.push(short.to_string());
        }
        names.push(h);
    }
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    names.dedup();
    let clean = |s: &str| {
        names
            .iter()
            .fold(scrub(s, home.as_deref(), None), |acc, n| {
                scrub(&acc, None, Some(n))
            })
    };

    ev.user = None;
    ev.request = None;
    ev.extra.clear();
    ev.breadcrumbs.values.clear();
    if let Some(m) = ev.message.as_mut() {
        *m = clean(m);
    }
    if let Some(l) = ev.logentry.as_mut() {
        l.message = clean(&l.message);
        l.params.clear();
    }
    for ex in ev.exception.values.iter_mut() {
        if let Some(v) = ex.value.as_mut() {
            *v = clean(v);
        }
    }
    Some(ev)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_hides_home_and_host() {
        assert_eq!(
            scrub(
                "open /Users/alice/clients/acme.txt on Alices-MacBook failed",
                Some("/Users/alice"),
                Some("Alices-MacBook"),
            ),
            "open ~/clients/acme.txt on <host> failed"
        );
        // 짧은 이름은 낱말을 망가뜨리지 않게 건너뛴다.
        assert_eq!(scrub("a b", None, Some("a")), "a b");
    }

    #[test]
    fn scrub_event_drops_personal_fields() {
        use sentry::protocol::{Event, Exception, User};
        let host = local_host_name().unwrap_or_else(|| "Alices-MacBook".into());
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        let mut ev = Event {
            message: Some(format!("panic at {home}/secret/x.txt on {host}")),
            server_name: Some(host.clone().into()),
            user: Some(User {
                username: Some("alice".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        ev.extra.insert("lines".into(), "Password: hunter2".into());
        ev.exception.values.push(Exception {
            ty: "panic".into(),
            value: Some(format!("cannot read {home}/.ssh/id_ed25519")),
            ..Default::default()
        });
        let out = filter_event(ev, true).unwrap();
        let json = serde_json::to_string(&out).unwrap();
        assert!(!json.contains(&home), "{json}");
        assert!(!json.contains(&host), "{json}");
        assert!(!json.contains("hunter2"));
        assert!(!json.contains("alice"));
        assert!(out.server_name.is_none());
        assert_eq!(
            out.message.as_deref(),
            Some("panic at ~/secret/x.txt on <host>")
        );
        assert_eq!(
            out.exception.values[0].value.as_deref(),
            Some("cannot read ~/.ssh/id_ed25519")
        );
    }

    #[test]
    fn turned_off_sends_nothing_and_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_off_in(dir.path()), "기본은 보낸다");
        write_pref(dir.path(), false).unwrap();
        assert!(
            is_off_in(dir.path()),
            "끔이 파일로 남아 다음 실행에도 지켜진다"
        );
        let ev = sentry::protocol::Event {
            message: Some("boom".into()),
            ..Default::default()
        };
        assert!(filter_event(ev, false).is_none());
        write_pref(dir.path(), true).unwrap();
        write_pref(dir.path(), true).unwrap(); // 이미 켜져 있어도 오류 없음
        assert!(!is_off_in(dir.path()));
    }
}
