//! 로컬 터미널의 "작업 폴더" 찾기 (#168) — 파일 패널이 계정 홈이 아니라 그 탭이 일하는 폴더를
//! 열게 한다. 셸의 OSC 7만으로는 부족하다:
//! - tmux 안에서는 안쪽 셸의 OSC 7을 tmux가 삼켜 앱까지 오지 않는다.
//! - Claude Code 같은 프로그램이 전면에 있으면 프롬프트가 없어 OSC 7도 없다.
//!
//! 그래서 PTY의 **전면 프로세스**를 본다.
//! 1. 전면이 tmux 클라이언트면 그 클라이언트(= 이 PTY의 tty)가 보고 있는 세션의 활성 창 경로를
//!    tmux에 묻는다(`display-message -c <tty>`). tmux를 직접 쳐서 들어갔거나 세션을 바꿔도 맞다.
//! 2. 아니면 전면 프로세스(예: claude)의 작업 폴더.
//! 3. 그것도 안 되면 셸 자신의 작업 폴더.
//!
//! macOS는 `proc_pidinfo(PROC_PIDVNODEPATHINFO)`, Linux는 `/proc/<pid>/cwd`. Windows는 None.

/// 프로세스의 작업 폴더.
#[cfg(target_os = "macos")]
pub fn pid_cwd(pid: i32) -> Option<String> {
    use std::ffi::CStr;
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let n = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if n != size {
        return None;
    }
    // vip_path는 MAXPATHLEN(1024)바이트 C 문자열이다(libc가 [[c_char;32];32]로 표현).
    let raw = &info.pvi_cdir.vip_path as *const _ as *const libc::c_char;
    let s = unsafe { CStr::from_ptr(raw) }
        .to_string_lossy()
        .into_owned();
    (!s.is_empty()).then_some(s)
}

#[cfg(target_os = "linux")]
pub fn pid_cwd(pid: i32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn pid_cwd(_pid: i32) -> Option<String> {
    None
}

/// 프로세스 이름(실행 파일 이름).
#[cfg(target_os = "macos")]
fn pid_name(pid: i32) -> Option<String> {
    let mut buf = [0u8; 256];
    let n =
        unsafe { libc::proc_name(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32) };
    (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

#[cfg(target_os = "linux")]
fn pid_name(pid: i32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn pid_name(_pid: i32) -> Option<String> {
    None
}

/// tmux 실행 파일. GUI로 띄운 앱은 PATH에 Homebrew가 없어서 흔한 위치를 직접 찾는다.
#[cfg(unix)]
fn tmux_bin() -> Option<std::path::PathBuf> {
    let from_path = std::env::var_os("PATH").and_then(|p| {
        std::env::split_paths(&p)
            .map(|d| d.join("tmux"))
            .find(|c| c.is_file())
    });
    from_path.or_else(|| {
        [
            "/opt/homebrew/bin/tmux",
            "/usr/local/bin/tmux",
            "/usr/bin/tmux",
        ]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|c| c.is_file())
    })
}

/// `tty`에 붙은 tmux 클라이언트가 보고 있는 활성 창의 경로.
#[cfg(unix)]
pub fn tmux_client_path(tty: &str) -> Option<String> {
    let bin = tmux_bin()?;
    let mut cmd = std::process::Command::new(bin);
    cmd.args([
        "display-message",
        "-p",
        "-c",
        tty,
        "-F",
        "#{pane_current_path}",
    ])
    .stdin(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());
    let out = run_with_timeout(cmd, std::time::Duration::from_secs(2))?;
    let s = out.trim();
    (s.starts_with('/')).then(|| s.to_string())
}

#[cfg(unix)]
fn run_with_timeout(mut cmd: std::process::Command, limit: std::time::Duration) -> Option<String> {
    use std::io::Read;
    let mut child = cmd.stdout(std::process::Stdio::piped()).spawn().ok()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut s = String::new();
                child.stdout.take()?.read_to_string(&mut s).ok()?;
                return Some(s);
            }
            Ok(None) if start.elapsed() < limit => {
                std::thread::sleep(std::time::Duration::from_millis(15))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// 이 PTY의 작업 폴더. `fg` = 전면 프로세스 그룹 리더(tcgetpgrp), `shell` = PTY에서 띄운 셸,
/// `tty` = PTY의 tty 경로.
pub fn session_cwd(fg: Option<i32>, shell: Option<i32>, tty: Option<&str>) -> Option<String> {
    #[cfg(unix)]
    if let (Some(fg), Some(tty)) = (fg, tty) {
        if pid_name(fg).is_some_and(|n| n.starts_with("tmux")) {
            if let Some(p) = tmux_client_path(tty) {
                return Some(p);
            }
        }
    }
    let _ = tty;
    fg.and_then(pid_cwd).or_else(|| shell.and_then(pid_cwd))
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;

    #[test]
    fn pid_cwd_reads_own_and_child_folder() {
        let me = std::process::id() as i32;
        let here = std::env::current_dir().unwrap();
        assert_eq!(
            std::fs::canonicalize(pid_cwd(me).unwrap()).unwrap(),
            std::fs::canonicalize(&here).unwrap()
        );
        let dir = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .current_dir(dir.path())
            .spawn()
            .unwrap();
        // 자식이 exec을 마칠 때까지 잠깐 기다린다.
        std::thread::sleep(std::time::Duration::from_millis(100));
        let got = pid_cwd(child.id() as i32);
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(
            std::fs::canonicalize(got.unwrap()).unwrap(),
            std::fs::canonicalize(dir.path()).unwrap()
        );
        assert!(pid_name(me).is_some());
    }
}
