//! 오류 추적(GlitchTip)으로 나가는 백엔드 이벤트에서 개인 정보를 걷어 낸다 (#177).
//!
//! sentry의 `contexts` 통합은 컴퓨터 이름을 `server_name`으로 붙인다(iOS는 기기 이름).
//! panic 메시지에는 홈 폴더 경로나 컴퓨터 이름이 섞일 수 있다. 보내기 직전에 그 둘을 가리고,
//! 사용자·extra·breadcrumb·요청 정보는 지운다. OS·기기 종류·스택 위치(소스 파일:줄)는 남긴다.

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

/// sentry `before_send` — 개인 정보 필드를 지우고 글자를 가린다.
pub fn scrub_event(
    mut ev: sentry::protocol::Event<'static>,
) -> Option<sentry::protocol::Event<'static>> {
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
        let out = scrub_event(ev).unwrap();
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
}
