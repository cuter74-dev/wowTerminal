//! PTY 세션 매니저.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type SessionId = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PtyDims {
    pub cols: u16,
    pub rows: u16,
}

impl Default for PtyDims {
    fn default() -> Self {
        Self { cols: 80, rows: 24 }
    }
}

impl From<PtyDims> for PtySize {
    fn from(d: PtyDims) -> Self {
        PtySize {
            cols: d.cols,
            rows: d.rows,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("session not found: {0}")]
    NotFound(SessionId),

    #[error("pty io: {0}")]
    Io(String),

    #[error("backend: {0}")]
    Backend(String),
}

/// 데이터 송신 콜백 — Tauri 환경에서는 event emit으로 연결되지만,
/// 테스트에서는 채널이나 버퍼에 모을 수 있도록 추상화.
pub type DataSink = Arc<dyn Fn(SessionId, Vec<u8>) + Send + Sync>;

/// 세션별 출력 ring buffer. 탭 분리(세션 인계) 시 새 창이 이전 스크롤백을 복원하도록
/// 출력 바이트를 세션마다 상한까지 누적한다. 상한 초과 시 오래된 앞부분부터 버린다.
pub struct HistoryStore {
    inner: Mutex<HashMap<SessionId, Vec<u8>>>,
    cap: usize,
}

impl HistoryStore {
    pub fn new(cap: usize) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            cap,
        }
    }

    pub fn append(&self, id: &str, data: &[u8]) {
        let mut g = self.inner.lock().expect("history mutex poisoned");
        let buf = g.entry(id.to_string()).or_default();
        buf.extend_from_slice(data);
        if buf.len() > self.cap {
            let excess = buf.len() - self.cap;
            buf.drain(..excess);
        }
    }

    pub fn get(&self, id: &str) -> Vec<u8> {
        self.inner
            .lock()
            .expect("history mutex poisoned")
            .get(id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn remove(&self, id: &str) {
        self.inner
            .lock()
            .expect("history mutex poisoned")
            .remove(id);
    }
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<SessionId, Session>>,
    /// 다른 윈도우로 인계된 세션 — 다음 kill 1회 무시(세션 유지).
    detach_guard: Mutex<std::collections::HashSet<SessionId>>,
    sink: DataSink,
    history: Arc<HistoryStore>,
}

impl PtyManager {
    pub fn new(sink: DataSink) -> Self {
        Self::with_history(sink, Arc::new(HistoryStore::new(512 * 1024)))
    }

    pub fn with_history(sink: DataSink, history: Arc<HistoryStore>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            detach_guard: Mutex::new(std::collections::HashSet::new()),
            sink,
            history,
        }
    }

    /// 세션 인계 보호 — 직후 kill 1회 무시.
    pub fn mark_detached(&self, id: &str) {
        self.detach_guard
            .lock()
            .expect("detach_guard poisoned")
            .insert(id.to_string());
    }

    /// 새 PTY 세션을 시작한다. 셸 미지정 시 OS 기본 (Linux: $SHELL or /bin/bash, Windows: cmd.exe).
    pub fn spawn(
        &self,
        program: Option<&str>,
        dims: PtyDims,
        cwd: Option<&str>,
    ) -> Result<SessionId, PtyError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(dims.into())
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let prog = program.map(|s| s.to_string()).unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&prog);
        // zsh는 개행 없이 끝난 줄에 부분 줄 표시(%/PROMPT_SP)를 붙인다. 로그인 메시지가 없는
        // PTY 첫 프롬프트에서 거슬리게 나오므로 promptsp 옵션을 꺼서 시작한다.
        let shell_name = std::path::Path::new(&prog)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());
        if shell_name.as_deref() == Some("zsh") {
            // 로그인 셸로 띄운다(-l): macOS Terminal.app처럼 /etc/zprofile(path_helper)와
            // 사용자 ~/.zprofile을 읽어 Homebrew/pyenv 등 PATH가 제대로 잡히게 한다.
            // (비로그인이면 .zprofile이 안 읽혀 "command not found"가 쏟아진다.)
            cmd.arg("-l");
            cmd.arg("+o");
            cmd.arg("promptsp");
            setup_zsh_integration(&mut cmd);
        } else if shell_name.as_deref() == Some("bash") {
            // bash는 로그인(-l)이면 --rcfile을 무시하므로(OSC133 주입 불가) 비로그인으로 두고,
            // rcfile 안에서 로그인 프로필(/etc/profile·~/.bash_profile 등)을 직접 source해 PATH를 잡는다.
            setup_bash_integration(&mut cmd);
        }

        // 세션 복원(#90): 이전 작업 디렉터리에서 시작. 디렉터리가 사라졌으면 무시(홈에서 시작).
        if let Some(dir) = cwd {
            if std::path::Path::new(dir).is_dir() {
                cmd.cwd(dir);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Backend(e.to_string()))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Backend(e.to_string()))?;

        let session_id: SessionId = uuid::Uuid::new_v4().to_string();
        let session = Session {
            writer,
            master: pair.master,
            child,
        };
        self.sessions
            .lock()
            .expect("sessions mutex poisoned")
            .insert(session_id.clone(), session);

        // reader 스레드: master에서 읽은 바이트를 sink로 전달.
        let sink = Arc::clone(&self.sink);
        let id_for_thread = session_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => (sink)(id_for_thread.clone(), buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
        });

        Ok(session_id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut guard = self.sessions.lock().expect("sessions mutex poisoned");
        let session = guard
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound(id.into()))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::Io(e.to_string()))?;
        session
            .writer
            .flush()
            .map_err(|e| PtyError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, dims: PtyDims) -> Result<(), PtyError> {
        let guard = self.sessions.lock().expect("sessions mutex poisoned");
        let session = guard.get(id).ok_or_else(|| PtyError::NotFound(id.into()))?;
        session
            .master
            .resize(dims.into())
            .map_err(|e| PtyError::Backend(e.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        // 인계 보호된 세션이면 이번 kill 1회 무시.
        if self
            .detach_guard
            .lock()
            .expect("detach_guard poisoned")
            .remove(id)
        {
            return Ok(());
        }
        let mut guard = self.sessions.lock().expect("sessions mutex poisoned");
        let mut session = guard
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.into()))?;
        let _ = session.child.kill();
        let _ = session.child.wait();
        self.history.remove(id);
        Ok(())
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .expect("sessions mutex poisoned")
            .len()
    }
}

#[cfg(target_family = "unix")]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}

/// 로컬 zsh에 OSC 133(셸 시맨틱) 통합을 주입한다 — 에코 없이 ZDOTDIR 오버라이드로.
/// 사용자의 zsh 설정을 다시 source한 뒤 precmd/preexec 훅으로 명령 시작(C)·종료코드(D)를 emit.
/// 프론트는 이를 받아 명령별 종료코드·실행시간 배지를 표시한다.
fn setup_zsh_integration(cmd: &mut CommandBuilder) {
    let dir = std::env::temp_dir().join("wowterminal-zdotdir");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    // 원래 ZDOTDIR(없으면 $HOME)을 기억해 사용자 설정을 다시 source한다.
    let orig = std::env::var("ZDOTDIR")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default();

    // .zshenv/.zprofile/.zlogin: 사용자 것 통과(ZDOTDIR 오버라이드로 안 읽히므로 직접 source).
    for name in [".zshenv", ".zprofile", ".zlogin"] {
        let body = format!(
            "[ -f \"$WT_ORIG_ZDOTDIR/{name}\" ] && source \"$WT_ORIG_ZDOTDIR/{name}\"\n"
        );
        let _ = std::fs::write(dir.join(name), body);
    }
    // .zshrc: 사용자 것 source + OSC 133 훅 + ZDOTDIR 원복.
    let zshrc = concat!(
        "[ -f \"$WT_ORIG_ZDOTDIR/.zshrc\" ] && source \"$WT_ORIG_ZDOTDIR/.zshrc\"\n",
        "autoload -Uz add-zsh-hook 2>/dev/null\n",
        // OSC 133 D(종료코드) + OSC 7(현재 작업 디렉터리). cwd는 파일 드래그 업로드 위치 등에 사용.
        "__wt_precmd() { print -n \"\\e]133;D;$?\\a\"; print -n \"\\e]7;file://${HOST}${PWD}\\a\"; }\n",
        "__wt_preexec() { print -n \"\\e]133;C\\a\"; }\n",
        "add-zsh-hook precmd __wt_precmd 2>/dev/null\n",
        "add-zsh-hook preexec __wt_preexec 2>/dev/null\n",
        "[ -n \"$WT_ORIG_ZDOTDIR\" ] && export ZDOTDIR=\"$WT_ORIG_ZDOTDIR\"\n",
    );
    let _ = std::fs::write(dir.join(".zshrc"), zshrc);

    cmd.env("WT_ORIG_ZDOTDIR", orig);
    cmd.env("ZDOTDIR", dir.to_string_lossy().to_string());
}

/// 로컬 bash에 OSC 133 통합을 주입한다 — `--rcfile`로 사용자 ~/.bashrc를 source한 뒤 훅 추가.
/// (DEBUG trap=명령 시작 C, PROMPT_COMMAND=종료 D;exit. 프롬프트 사이클당 C 1회 보장.)
fn setup_bash_integration(cmd: &mut CommandBuilder) {
    let dir = std::env::temp_dir().join("wowterminal-bash");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let rc = dir.join("wt-bashrc.bash");
    let body = concat!(
        // 로그인 셸이 아니어도 macOS Terminal.app과 동일한 PATH가 잡히도록 로그인 프로필을
        // 먼저 source한다(/etc/profile=path_helper, 사용자 ~/.bash_profile/.profile).
        "[ -f /etc/profile ] && source /etc/profile\n",
        "if [ -f ~/.bash_profile ]; then source ~/.bash_profile\n",
        "elif [ -f ~/.bash_login ]; then source ~/.bash_login\n",
        "elif [ -f ~/.profile ]; then source ~/.profile\n",
        "fi\n",
        "[ -f ~/.bashrc ] && source ~/.bashrc\n",
        "__wt_pe=0\n",
        "__wt_preexec() {\n",
        "  [ -n \"$COMP_LINE\" ] && return\n",
        "  [ \"$BASH_COMMAND\" = \"$PROMPT_COMMAND\" ] && return\n",
        "  [ \"$__wt_pe\" = \"1\" ] && return\n",
        "  __wt_pe=1\n",
        "  printf '\\033]133;C\\007'\n",
        "}\n",
        "__wt_precmd() { local e=$?; printf '\\033]133;D;%s\\007' \"$e\"; printf '\\033]7;file://%s%s\\007' \"$HOSTNAME\" \"$PWD\"; __wt_pe=0; }\n",
        "trap '__wt_preexec' DEBUG\n",
        "PROMPT_COMMAND=\"__wt_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}\"\n",
    );
    if std::fs::write(&rc, body).is_err() {
        return;
    }
    cmd.arg("--rcfile");
    cmd.arg(rc.to_string_lossy().to_string());
}

#[cfg(target_family = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
}

#[cfg(test)]
#[cfg(target_family = "unix")]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect_sink() -> (DataSink, mpsc::Receiver<(SessionId, Vec<u8>)>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: DataSink = Arc::new(move |id, data| {
            let _ = tx
                .lock()
                .expect("collect_sink tx poisoned")
                .send((id, data));
        });
        (sink, rx)
    }

    fn read_until_marker(
        rx: &mpsc::Receiver<(SessionId, Vec<u8>)>,
        marker: &str,
        timeout: Duration,
    ) -> String {
        let start = std::time::Instant::now();
        let mut acc = String::new();
        while start.elapsed() < timeout {
            match rx.recv_timeout(Duration::from_millis(300)) {
                Ok((_, bytes)) => {
                    acc.push_str(&String::from_utf8_lossy(&bytes));
                    if acc.contains(marker) {
                        return acc;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        acc
    }

    #[test]
    fn spawn_write_read_echo() {
        // /bin/sh로 단순한 echo를 시킨다. PTY 라인 에코 + 셸 출력 둘 다 잡아도 OK.
        let (sink, rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let id = mgr
            .spawn(Some("/bin/sh"), PtyDims { cols: 80, rows: 24 }, None)
            .expect("spawn");
        assert_eq!(mgr.session_count(), 1);

        mgr.write(&id, b"echo wowterm-hello\nexit\n").expect("write");
        let out = read_until_marker(&rx, "wowterm-hello", Duration::from_secs(5));
        assert!(out.contains("wowterm-hello"), "no marker, got: {out}");

        // 자식 프로세스가 exit하면 reader 스레드는 자연 종료. kill은 멱등.
        let _ = mgr.kill(&id);
    }

    #[test]
    fn resize_unknown_session_returns_not_found() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let err = mgr
            .resize("nope", PtyDims { cols: 100, rows: 30 })
            .unwrap_err();
        assert!(matches!(err, PtyError::NotFound(_)));
    }

    #[test]
    fn write_unknown_session_returns_not_found() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let err = mgr.write("nope", b"x").unwrap_err();
        assert!(matches!(err, PtyError::NotFound(_)));
    }

    #[test]
    fn kill_removes_session() {
        let (sink, _rx) = collect_sink();
        let mgr = PtyManager::new(sink);
        let id = mgr
            .spawn(Some("/bin/sh"), PtyDims::default(), None)
            .expect("spawn");
        assert_eq!(mgr.session_count(), 1);
        mgr.kill(&id).expect("kill");
        assert_eq!(mgr.session_count(), 0);
    }
}
