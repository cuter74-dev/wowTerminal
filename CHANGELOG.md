# Changelog

This file records the notable changes per version of wowTerminal.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning (SemVer)](https://semver.org/).

Categories: **Added** (new features) · **Changed** (behavior changes) · **Fixed** (bug fixes) · **Removed** (removed features)

## [Unreleased]

## [0.13.10] — 2026-06-09

### Changed
- Internal only (no user-facing change): extended the Windows IME diagnostic (#88) with document-level keydown capture + textarea focus tracking. The v0.13.9 trace showed no keydown/composition reaching the terminal at all — only a focus-out signal — so this build records every keydown at the document level (key/keyCode/isComposing/target/activeElement) and textarea focusin/focusout, to see whether the Hangul key reaches the page and which element holds focus. To be removed once the cause is identified (#88)

## [0.13.9] — 2026-06-09

### Changed
- Internal only (no user-facing change): added temporary, Windows/Linux-only IME diagnostic instrumentation (#88) — since the Windows Hangul-stuck bug isn't reproducible on the maintainer's machine, the actual event sequence (keydown / composition / input with their values and the mirror state transitions) is collected and sent once to GlitchTip on input idle. To be removed once the cause is identified (#88)

## [0.13.8] — 2026-06-09

### Fixed
- Windows: Korean input dying after switching the IME to Hangul, and staying dead even after switching back to English — the custom IME mirror set `imeActive` on `keyCode 229` but nothing turned it off on Windows (the off-switch was a macOS-only `compositionstart` listener), so once a composition started it stuck on and swallowed every subsequent keystroke. On Windows/Linux the mirror is now driven by the composition lifecycle (`compositionstart` on, `compositionend` flush + reset); macOS paths are unchanged (#88)

## [0.13.7] — 2026-06-09

### Fixed
- Switching tabs by keyboard (Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+number) activated the tab but didn't focus the terminal, so you had to click the terminal before typing. The active tab's focused pane now receives keyboard focus on switch — type immediately, no click needed (#87)

## [0.13.6] — 2026-06-09

### Fixed
- Character duplication / ghosting at the shell prompt on the newest macOS (visible e.g. with oh-my-zsh syntax-highlighting, where each keystroke redraws the line) — the cause is xterm's DOM renderer not clearing previous glyphs on the newest WKWebView, not the PTY (the bytes sent to the shell are correct). The terminal now renders with the WebGL renderer, which repaints the whole viewport and leaves no stale glyphs; it transparently falls back to the DOM renderer where WebGL is unavailable (#83)

### Removed
- The temporary macOS IME diagnostic instrumentation (#83) is removed now that the duplication is identified as a renderer issue and fixed (#83)

## [0.13.5] — 2026-06-09

### Changed
- Internal only (no user-facing change): the temporary macOS IME diagnostic (#83) now sends on an input-idle debounce instead of on Enter — on the affected machine the Enter keydown is consumed by the IME (`e.key` is not `Enter`), so the previous trigger missed. To be removed once the IME duplication is diagnosed (#83)

## [0.13.4] — 2026-06-09

### Changed
- Internal only (no user-facing change): fixed delivery of the temporary macOS IME diagnostic (#83) — the trace was sent from a path that's skipped while the IME mirror is active, so it never reached telemetry on the affected machine; it now sends from the key handler on Enter. To be removed once the IME duplication is diagnosed (#83)

## [0.13.3] — 2026-06-09

### Fixed
- Terminal garbled/ghosting after shrinking the window very small then enlarging it — FitAddon was shrinking the terminal to ~2 columns, so the shell re-wrapped its prompt and those narrow lines stayed as ghosting. The terminal is now clamped to a minimum width (20 cols) and its container clips overflow, so it never shrinks to a degenerate width or overlaps the AI panel (#86)

## [0.13.2] — 2026-06-09

### Fixed
- Terminal output freezing after running any command — a v0.13.0 regression where `@xterm/xterm` 6.0.0 (re-resolved during the #82 dependency install) enforces proposed-API gating, so the OSC 133 command-badge code (`registerDecoration`/`registerMarker`) threw inside the parser and broke xterm's write loop, swallowing all subsequent output (input still worked, so it looked like a freeze). Added `allowProposedApi: true` and wrapped the OSC 133 handler in try/catch so a badge error can never freeze the terminal again (#85)

### Removed
- The per-command status badge (`✓`/`✗` + duration) is no longer shown — it cluttered every prompt line. Command jump (⌘↑/↓) and long-command completion notifications are unchanged (#85)

## [0.13.1] — 2026-06-09

### Fixed
- Korean (Hangul) input completely broken on Windows — a regression from the v0.13.0 IME fix (#83): the native-composition bypass (meant for the newest macOS WKWebView) also triggered on Windows WebView2, which always fires composition events, disabling the custom IME mirror that Windows relies on. The bypass is now gated to macOS only; Windows/Linux keep the mirror (#84)

## [0.13.0] — 2026-06-08

### Added
- Error & crash tracking via self-hosted GlitchTip (Sentry-compatible) — the Rust backend (panics) and the React frontend (render errors) report runtime errors automatically, distinguished by a `component` tag within a single project. The DSN is embedded (public ingest key) and can be overridden or disabled via `WOWTERMINAL_GLITCHTIP_DSN` / `VITE_GLITCHTIP_DSN` (#82)
- Non-invasive remote current-folder detection for SSH — drag-and-drop upload and the file browser now open at the remote shell's current directory without injecting anything or leaving a screen artifact. On demand, a separate exec channel reads the interactive shell's cwd via `/proc` (the shell and exec channel share the same connection sshd as a common ancestor). Linux remotes only; falls back to an OSC 7 rc-hook or the remote home elsewhere (#83)

### Fixed
- Input characters duplicated in the local shell on the newest macOS (e.g. `df -h` → `dddff f -h`) — the custom IME mirror (built for old WKWebView) conflicted with the newest WKWebView's native composition events; it now auto-detects native composition and bypasses the mirror, letting xterm handle IME natively (#83)
- SSH connect wiping the first screen (banner disappearing, leaving the prompt + blank lines) — removed the remote OSC 7 cwd auto-injection whose trailing Ctrl-L cleared the whole screen (#83)

## [0.12.0] — 2026-06-05

### Added
- Panel toggle shortcuts — open/close the host panel (⌘B) and the AI panel (⌘J) via shortcuts (rebindable in settings) (#81)
- Drag-and-drop file upload onto the terminal — into the terminal's current folder (local shell = copy, SSH = SFTP upload to the remote current folder). The current folder is tracked via shell-integration OSC 7, and SSH auto-injects a cwd hook into the remote shell on connect (the screen is cleaned up with Ctrl-L). The result is reported via a desktop notification (#81)

### Fixed
- Commands installed via Homebrew/pyenv/jenv etc. failing with "command not found" in the local shell — the shell was spawned non-login so `~/.zprofile` (PATH setup such as brew shellenv) wasn't read; switched to a login shell (`-l`). For bash, the login profile is sourced directly in the rcfile (#80)

## [0.11.1] — 2026-06-05

### Fixed
- Terminal stuck at a small size when started in a small window and not growing when the window is enlarged — defer the ResizeObserver callback's fit via requestAnimationFrame (prevents the loop from dropping notifications), plus add a window resize listener and refit shortly after mount (#79)
- Windows auto-update loop — latest.json's windows-x86_64 pointed to the MSI, which can't do an in-place upgrade over an NSIS install. Made the updater fetch NSIS (-setup.exe) (fixed the published latest.json + added a workflow finalize step) (#78)

### Changed
- Settings terminal font — relabeled to "Font / Font size" and changed the direct CSS-stack input into a monospace preset dropdown (Menlo, SF Mono, JetBrains Mono, D2Coding, etc.) (#77)

## [0.11.0] — 2026-06-04

### Added
- Remote port forwarding (-R) — from the ⌘K "Port forwarding", forward connections arriving on the server's bind port to a client-side target. Completes the -L/-R/-D set (#73)

### Fixed
- The port field in the add/edit host screen reverting to 22 when cleared, preventing a new value — allow empty while editing (default 22 on save, clamp the range) (#74)
- Composing Korean syllables shown twice (e.g., 차 → 차차) — hide the xterm composition-preview overlay to remove duplication with the mirror display (#75)
- Unified the app launch icon + in-app logo (splash/onboarding/settings) · browser favicon · window title to the new blue "WT" logo/brand (#76)

## [0.10.0] — 2026-06-04

### Added
- UI font selection option in settings — choose the UI font of the host list, AI panel, etc. from presets (separate from the terminal font) (#54)
- Long-running command completion notification — a desktop notification + tab badge when a command ≥ 8s finishes in a background tab (OSC 133 based) (#55)
- Shell integration (OSC 133) for local bash too → exit-code/duration badges per command in bash as well (#56)
- Command palette (⌘K) — fuzzy-search hosts/new tab/settings/recent commands and run instantly (#57)
- Input broadcast — title-bar 📡 toggle. When on, input in one pane goes to all panes simultaneously (fleet operations). Shown in red when on (#59)
- Command snippets — save frequently used commands in the settings "Snippets" tab, run them from the ⌘K command palette (#58)
- Terminal color themes — Dracula, Nord, Solarized Dark, Monokai (full 16-color ANSI palettes). Choose from Settings → Terminal → Theme (#66)
- Session logging — when enabled in settings, accumulate terminal output (ANSI stripped) into per-session files in the log folder (both local and SSH) (#67)
- Session dashboard — open from the title-bar 📊 or ⌘K. View all tabs/panes' source/status/command count/last command in a table and jump by clicking a row (#68)
- Quick edit of remote files — double-click a text file in the SFTP browser to open an editor and save directly with ⌘S/💾 (both remote and local) (#69)
- Port forwarding — create/stop local (-L) and dynamic (-D SOCKS5) tunnels from the ⌘K "Port forwarding". Shows the active tunnel list (remote -R is a follow-up) (#70)
- Jump host (ProxyJump) — set a "jump host" in host editing to connect over a bastion. Jump auth via ssh-agent/keychain (#71)

### Changed
- Replaced the title-bar dashboard/broadcast emoji (📊/📡) with stroke SVG icons matching the settings gear (#72)
- macOS builds are code-signed with Developer ID + notarized — removes the "damaged" Gatekeeper warning on download

## [0.9.0] — 2026-06-04

### Added
- Terminal scrollback search (⌘F) — next/previous navigation and highlighting in a search box (#48)
- Click URLs in terminal output to open them in the default browser (#48)
- AI quick actions — "Fix error / Explain output / Next step" buttons auto-attach the current terminal output to ask the AI; commands in the answer run directly as cards (#49)
- ~/.ssh/config import — register hosts from the local SSH config in one go from the settings import tab (auth defaults to ssh-agent, editable) (#50)
- Shell integration (OSC 133) — exit-code (✓/✗)/duration badges per command in local zsh (command block step 1) (#51)
- Command block UI — command jump (⌘↑/↓), copy block output by clicking the badge, ask the AI about that block (command+output) via the ✨ button (#52)

## [0.8.0] — 2026-06-02

### Added
- When choosing Ollama (or an OpenAI-compatible local server) in LLM settings, show locally installed models in the model dropdown — `/models` lookup + refresh button (#46)

### Changed
- Removed the wireframe screen ID (S-048) from the AI panel and replaced the "auto context attach is a follow-up" notice with wording matching the actual behavior (11 languages) (#45)
- The model dropdown/icon buttons in the AI panel header were too small to read — enlarged the text/icons. Replaced the faint ⚙ glyph of the LLM settings button with a crisp SVG gear icon (#47)
- Expanded the terminal output attached on "include active pane output as context" from 60 to 100 lines

## [0.7.0] — 2026-06-02

### Added
- Terminal right-click context menu — copy/paste/select all/clear (11 languages) (#43)

### Fixed
- The Tab key in the terminal sometimes moving focus to the AI panel — fixed a bug where accepting an inline suggestion didn't `preventDefault`, so the browser's default focus move occurred. Tab now always blocks focus move and only handles the shell/suggestion (#42)
- Text being selected when dragging in the host list (left panel) — applied `user-select: none` (#44)
- The tab/terminal right-click menu not closing on a terminal-area click — changed outside-click detection to the capture phase (handled before xterm intercepts mousedown) (#44)

## [0.6.0] — 2026-06-02

### Added
- Export/import settings backup (hosts/groups/tags) as a **JSON file** — supports save/open native dialogs (the existing clipboard-text method is also kept). Secrets are excluded; host addresses/usernames are included, so a notice about cloud-sync locations was added (#41)

### Fixed
- Another session's output (a shell running in another tab) leaking and printing a wrong prompt at the top when connecting SSH in a new tab — fixed a bug where the global output event filter passed all output before sessionId was set (#39)
- When multiple tabs were attached to the same remote tmux session, a background (hidden) tab fitting to size 0 shrank the tmux width to ~10 columns — guarded to fit only when the container has a real size (#40)

## [0.5.0] — 2026-06-01

### Added
- Copy selected terminal text: copy to the system clipboard via ⌘C and the Edit menu / right-click Copy (#36)
- OSC 52 clipboard support: copying in tmux (`set-clipboard on`)/vim etc. reflects to the system clipboard. For security, only writing is allowed; read requests are ignored (#36)
- Replaced the AI panel icon with a gradient sparkle SVG (replacing the 🤖 emoji) (#38)

### Fixed
- Root-caused the leftover prompt at the top on SSH connect — removed the runtime injection of the OSC 7 cwd hook. (The receiver handler is kept, so adding one hook line to the remote `~/.bashrc` enables cwd sync) (#37)
- Mouse clicks printing coordinate text in the normal shell after exiting an alt-screen TUI (tmux/vim/Claude Code etc.) — auto-disable mouse tracking modes on returning to the normal screen (#37)

## [0.4.0] — 2026-06-01

### Added
- Alt-screen (less/man/vim, etc.) mouse-wheel scroll — convert the wheel to up/down arrows. Provides a settings toggle (#35)

### Fixed
- Korean double-consonant (있/았/껐, etc.) IME input breaking and being undeletable — fixed a bug where a modifier key (Shift, etc.) during composition reset the IME mirror (#34)
- Fixed the leftover where the prompt was printed twice on SSH connect (#34)

## [0.3.0] — 2026-06-01

### Added
- Customizable keyboard shortcuts (#32)
- Cross-window drag-merge and dragging a tab outside the window to create a new window (#33)

## [0.2.0] — 2026-05-29

### Added
- LLM response streaming (SSE + Tauri Channel) (#29)
- SFTP image/local preview, double-click preview, the file browser starting at the terminal cwd (#30)
- Scrollback preservation on session handover (output ring buffer) (#31)
- Machine-key-based encrypted-file secret store (removes the OS Keychain prompt)

### Fixed
- WKWebView (macOS) Korean/CJK IME input fix
- Sync the displayed version with `getVersion()` (removed hardcoding)

## [0.1.1] — 2026-05-29

### Changed
- First enablement of in-app auto-update (tauri-plugin-updater) — settled the updater signing/latest.json pipeline

## [0.1.0] — 2026-05-28

### Added
- First implementation of the planning doc's 71 wireframes: onboarding/splash, multi-tab/split/multi-window, SSH host·key management, dual-pane SFTP file browser (transfer queue/progress/preview/permissions/search), LLM/AI (backend·chat·context·command cards·history), command history·Ctrl-R, settings, 11-language i18n
- SSH manager (russh), known_hosts TOFU verification, host-key mismatch/first-contact confirmation modals
- PTY core (portable-pty) + xterm.js terminal
- AI backend (OpenAI-compatible adapter + registry)
- Secret store (keyring + Argon2id/AES-256-GCM file fallback)

---

[Unreleased]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.10...HEAD
[0.13.10]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.9...v0.13.10
[0.13.9]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.8...v0.13.9
[0.13.8]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.7...v0.13.8
[0.13.7]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.6...v0.13.7
[0.13.6]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.5...v0.13.6
[0.13.5]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.4...v0.13.5
[0.13.4]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.9.0
[0.8.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.8.0
[0.7.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.7.0
[0.6.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.6.0
[0.5.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.5.0
[0.4.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.4.0
[0.3.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.3.0
[0.2.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.2.0
[0.1.1]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.1.1
[0.1.0]: https://github.com/cuter74-dev/wowTerminal/releases/tag/v0.1.0
