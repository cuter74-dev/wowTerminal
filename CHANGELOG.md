# Changelog

This file records the notable changes per version of wowTerminal.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning (SemVer)](https://semver.org/).

Categories: **Added** (new features) · **Changed** (behavior changes) · **Fixed** (bug fixes) · **Removed** (removed features)

## [Unreleased]

## [0.19.0] — 2026-06-24

### Added
- More actions are now rebindable in **Settings → Shortcuts**: the command palette (previously a fixed ⌘K), open settings, open dashboard, tmux session picker, port forwarding, toggle input broadcast, and open file browser. (#116)
- Settings are now fully keyboard-navigable: the dialog traps Tab focus and shows a visible focus ring, **↓** moves from the tab strip into the controls (and to the next control), **↑** moves back up (and out to the tabs), **←/→** switch tabs, and **Tab** cycles every control — so all settings can be changed without a mouse. (#117)

## [0.18.1] — 2026-06-23

### Changed
- App bundle identifier is now `com.oopnwow.wowterminal` (was `com.wowterminal.app`) — a proper reverse-DNS identifier under the project's own domain, shared by desktop, iPad (iOS) and Android. App data/settings are stored under the `wowterminal` path (not the bundle ID), so macOS settings carry over; on Windows the next update may install alongside the old entry rather than upgrading in place (one-time). (#114)

### Fixed
- iPad (iOS) and Android app icons now use the wowTerminal icon instead of the default Tauri logo. (#114)
- Import/export on mobile failed with "no such file or directory" (e.g. picking a file from iCloud). The picked file is a security-scoped URL that the desktop file path read couldn't open; mobile now reads/writes it via the filesystem plugin, which handles the scope. (#114)
- Imported hosts/groups/tags/LLM backends now appear immediately — previously the import only took effect after restarting the app (desktop and mobile). (#114)
- Mobile: long-pressing the host list no longer selects the text (host info and group names); the row action buttons (incl. delete) are larger and easier to tap; and the list no longer rubber-band-bounces when dragged. (#114)

## [0.18.0] — 2026-06-23

### Added
- Mobile (iPad/Android) touch UI: an on-screen key bar above the keyboard (Esc · Tab · arrows · ⌃C/D/Z/R/L · Home/End/PgUp/PgDn · shell symbols, plus a sticky **Ctrl** modifier that turns the next typed letter into a control sequence), and a top toolbar that opens the host list and AI panel as slide-over sheets instead of cramped fixed columns. Desktop layout is unchanged. (#114)

## [0.17.1] — 2026-06-22

### Fixed
- Install the rustls crypto provider explicitly at startup, preventing a possible TLS-init panic when more than one provider (ring / aws-lc-rs) is present in the dependency tree. (#114)

### Internal
- Groundwork for iPad (iOS) and Android builds via Tauri 2 mobile — local-shell features are compiled out on mobile (SSH/SFTP/AI client); desktop is unaffected. (#114, #115)

## [0.17.0] — 2026-06-22

### Added
- Terminal deletion shortcuts: **Option/Alt + Delete** deletes the previous word (sends ESC+DEL → readline `backward-kill-word`), and **Cmd + Delete** clears the whole line (sends Ctrl-U). (#112)

## [0.16.3] — 2026-06-21

### Fixed
- Inline history autosuggestion no longer activates inside full-screen TUI apps (vim, Claude Code, less, …). Those use the alternate screen buffer, where line tracking and the **→ / End** accept now pause — so those keys reach the app instead of accepting a stale suggestion. Back at the shell prompt, →/End still accept the suggestion as before. (#110)

## [0.16.2] — 2026-06-19

### Fixed
- **Local shell: Backspace acted like Space, and Korean input piled up jamo** — the long-standing local-shell input bug (root cause of the #83/#88/#100 series, reported by several Mac users). The local PTY was started **without a `TERM`** variable: `portable-pty` doesn't set one, and when the app is launched from Finder/Dock the GUI process has no `TERM` to inherit. With `TERM` unset, zsh can't move the cursor left and redraws Backspace as spaces (so the Korean mirror's erase/rewind also turned into spaces). The local PTY now sets `TERM=xterm-256color` and `COLORTERM=truecolor` (SSH already sent a proper terminal type). This is why it always worked for the maintainer — their launch inherited a `TERM` — but broke for users who open the app from Finder. (#109)

## [0.16.1] — 2026-06-19

### Fixed
- Windows: the terminal cursor was drawn **above the text** at fractional display scaling (e.g. 150%). The xterm WebGL renderer rounds cell height to integer device pixels, so at a fractional `devicePixelRatio` the cursor and glyph layers misalign. WebGL is now used only at integer DPR; at fractional DPR the app falls back to the DOM renderer (cursor stays aligned with the text). Mac/Linux and Windows at 100%/200% are unaffected. (#108)

## [0.16.0] — 2026-06-18

### Added
- Inline autosuggestion now includes a small built-in **seed list** of useful commands, so they're suggested even before you've typed them (history still takes priority). First seed: `claude --dangerously-skip-permissions`. Accept with →/End as usual. (#107)
- Import/Export now includes **LLM backend configurations** (Settings → Import/Export), alongside SSH hosts/groups/tags. Backends are exported without their API key (keys stay in the keychain); after importing, re-enter the API key for any authenticated backend. The result message and secrets note reflect this. (#106)
- Host list keyboard navigation — **↑/↓** move the selection through the visible (filtered + grouped) hosts in on-screen order and scroll the row into view, **Home/End** jump to first/last, **Enter** opens the selected host in a new tab (same as double-click), and pressing **↓ in the search box** drops focus into the list. Mouse selection is unchanged; clicking a row also focuses the list so the arrow keys work right away. Scoped to the list (not a global handler), so it never interferes with terminal input. (#105)

## [0.15.0] — 2026-06-17

### Added
- The AI assistant now knows **which system is open**. When you ask with context attached, the focused session's OS / shell / user (and current directory) are probed silently and prepended to the request, so suggestions match the connected machine instead of guessing. On SSH this reuses the existing separate-channel exec (no trace in the interactive terminal); on a local tab it reads the host directly. The probe is a fixed read-only set (`uname`, `$SHELL`, `whoami`, distro name) — the model does not choose commands; system info is cached per session, cwd is read fresh. The system line is sent **independently of the "include active pane output" toggle** (knowing which machine is open shouldn't require attaching scrollback), and the attached-output line count is **configurable in Settings → General → AI context lines** (default 100, 1–2000). (Phase 1 of 2; phase 2 = an approval-gated tool-use loop.) (#103)

### Fixed
- Modal dialogs no longer close when you drag-select text in an input and release the mouse outside the panel. The overlay's click-to-close now fires only when the press *started* on the backdrop (tracked via mousedown), so text selection that ends outside the dialog no longer dismisses it — clicking the backdrop still closes it as before. Applied to the host registration form and Settings. (#104)

## [0.14.16] — 2026-06-17

### Changed
- Inline history autosuggestion is now accepted with **→ (Right Arrow) / End** instead of Tab — Tab was clashing with the shell's own file/dir/command completion (when a suggestion showed, Tab accepted it instead of completing). Now **Tab always goes to the shell** for completion, and →/End accept the suggestion (only at end of line, where the suggestion exists; arrow movement / Ctrl+→ / Shift+→ are unaffected). This is the fish / zsh-autosuggestions / Warp convention. The on-screen hint now reads `→ {suggestion}` (#102)

## [0.14.15] — 2026-06-16

### Changed
- Windows/Linux copy/paste keyboard shortcuts — previously copy required select → right-click → context menu. Now: **Ctrl+C** copies when text is selected and otherwise passes through as SIGINT (the Windows Terminal / VS Code convention, mirroring the existing macOS ⌘C); **Ctrl+V** pastes (via `term.paste`, honoring bracketed-paste mode); **Ctrl+Shift+C** always copies the selection; **Ctrl+Shift+V** pastes. macOS keeps ⌘C/⌘V unchanged (#101)

## [0.14.14] — 2026-06-16

### Fixed
- macOS Korean input on composition-capable Macs — three issues found by reproducing on a signed build (the unsigned build is 229-only and never hits this path), each diagnosed from live `input`/`kd`/sequence telemetry, not guessed (#100):
  - **Standalone jamo (ㅇ, ㅏ) wouldn't type** — only full syllables (가) appeared. The lone-compatibility-jamo drop in `onData` (a guard for the mirror path's composition leakage) was also eating legitimately-committed standalone jamo on a composition machine. It's now skipped on composition machines (native IME).
  - **The syllable being composed was hidden by the cursor** (typing 가나다 showed only 가). The `.composition-view` overlay that shows the in-progress syllable was hidden on all macOS (it was only meant to be hidden when the custom mirror draws the text instead). It's now shown on composition machines.
  - **Right-Cmd remapped as 한/영 duplicated the last Korean syllable** — toggling the input language *mid-composition* committed the syllable once during composition and again on `compositionend`. onData fired while composition was still in progress is now dropped (xterm normally suppresses those anyway), so each syllable is sent exactly once.

## [0.14.13] — 2026-06-15

### Fixed
- macOS: "Backspace behaving like Space" when deleting Korean — pressing Backspace left a blank and the cursor seemed to move forward instead of deleting. The 0.14.12 diagnostic proved Backspace sends the correct delete byte (`\x7f`); the real cause is that macOS inline predictive text commits the Space key as a **non-breaking space (U+00A0)** instead of a normal space (seen in the bytes sent: `라\xa0`). zsh's line editor doesn't treat U+00A0 as a normal cell, so its cursor column desyncs from the terminal's and Backspace's erase lands as a blank in the wrong place, leaving the characters on screen. Input is now normalized — a non-breaking space from the IME is sent to the shell as a regular space — on both the native and mirror paths. Covered by a new self-test scenario (typing `st6<U+00A0>ok` must reach the shell as `st6 ok`). Diagnosed from the live `input`/`kd` diagnostics, not guessed (#100)

## [0.14.12] — 2026-06-15

### Changed
- Internal (temporary diagnostic, #100): added to the macOS IME diag the last 30 byte-sequences actually sent to the PTY (escaped) and the last 30 special-key keydowns (key/keyCode/isComposing/imeActive). This pins down a report that **Backspace behaves like Space** while deleting Korean on the signed build — whether the wrong byte is sent (input logic) or the byte is correct and the WebGL renderer fails to clear the wide cell (renderer, same family as #83). It can only be measured on a signed build: the unsigned local build is a 229-only machine and never hits this composition path. Removed once #100 is resolved (#100)

## [0.14.11] — 2026-06-15

### Changed
- Build provenance marking — self-built/local binaries (e.g. the input-gate builds) now identify themselves separately from the official CI release, which previously was impossible since both reported the same version string. Official releases (built in CI from a `v*` tag) are unchanged; a local build now shows `· local` after the version in the host-panel footer and tags its GlitchTip diagnostics with `dist: local` (+ git short rev). This stops local gate runs from polluting the real-user diagnostics under the same release tag — the exact confusion hit while diagnosing #100 (#100)

## [0.14.10] — 2026-06-15

### Fixed
- macOS: Korean typing corrupted, and Backspace swallowed after switching English→Korean→English, on Macs that handle Korean through standard composition events (newer machines / the installed build) — the custom IME mirror, which exists for older 229-only WKWebViews, fought the native IME: the first keyCode-229 of each syllable briefly engaged the mirror before `compositionstart`, sending stray characters, and the engaged state lingered into English so a Backspace was held back waiting for a mirror event that never came. The app now detects a composition-capable Mac by a composition that commits actual Hangul (a signal a 229-only Mac never produces, and accent-popup/dictation never trip) and from then on always lets the native IME handle input, never engaging the mirror or touching the composing textarea. Diagnosed from the machine's live `wt.ime.local-diag` (`nCS:15, n229:19`), not guessed. The input self-test now also drives the real composition path and verifies deletion works after an EN↔KO switch (#100)

## [0.14.9] — 2026-06-12

### Fixed
- Reconnect (#96) follow-up, from a user screen recording (#99):
  - The "[disconnected — press Enter to reconnect]" / "[reconnecting…]" messages printed as literal `\r\n\x1b[33m…` text instead of colored lines — all 11 language strings were committed double-escaped.
  - Clicking after a reconnect typed garbage like `0;90;14M…` into the new shell — the dead session's program (tmux/TUI) had enabled mouse tracking and the terminal kept its modes across the re-spawn. Leaked DEC private modes (mouse tracking, bracketed paste, application cursor keys, alternate screen, hidden cursor) are now reset locally on re-spawn without clearing the screen.
  - Reconnecting landed in a bare shell instead of back in the pane's tmux session — only the host-level auto-attach was re-run. The pane's known tmux session now takes precedence and is re-attached with dead-client detach (#99)

## [0.14.8] — 2026-06-12

### Changed
- Internal (temporary diagnostic, #83): the v0.14.7 data from the affected newest-Mac finally **cleared the input path** — typing `df -h` sent exactly 6 chars to the PTY (no keyCode-229, no mirror, no suppression) yet the prompt still showed `ddf -hdff f -h`, so the artifacts are born after input: in the shell echo/xterm parsing or in the renderer. The macOS IME diag now also captures the decisive split: whether the WebGL renderer is actually active (+ context losses), the **buffer text** of the cursor line + 3 lines above at send time (artifacts present in the buffer → echo/parsing side; buffer clean → renderer side), and the last 10 PTY echo chunks (escaped, 160 chars each — **includes terminal content**). Removed once #83 is closed (#83)

## [0.14.7] — 2026-06-12

### Fixed
- macOS: paste being inserted again on the next keystroke — xterm's paste handler calls `stopPropagation` but not `preventDefault`, so WebKit's default action also wrote the clipboard text into the hidden textarea; the next keyCode-229 keydown engaged the IME mirror, which diffed against an empty baseline and re-sent the residue. The mirror now snapshots the textarea content as its baseline when it engages, and a paste listener clears the residue on the next tick. Covered by a new self-test scenario (paste → Korean typing must yield the pasted text exactly once) (#97)

## [0.14.6] — 2026-06-12

### Fixed
- Typing doing nothing after the screen was locked/asleep for a while, especially in SSH tabs — the TCP connection dies during sleep but the app had no keepalive, no dead-session detection, and no reconnect path, so keystrokes were silently dropped into a dead channel. Now: SSH keepalives (20s interval, 3 misses → dead within ~1 minute), a `session:closed` notification when a session's stream ends (SSH connection lost or local shell exited) showing "[disconnected — press Enter to reconnect]", and pressing Enter re-spawns the session in place — with tmux auto-attach configured, reconnecting drops you straight back into your tmux session (#96)

### Changed
- Internal: built-in input self-test harness (#95) — launching with a one-shot localStorage flag drives the real input paths (plain typing, Backspace, the macOS IME mirror with composition transitions and deletion) with synthetic events into a fresh local tab, and the shell's output files are asserted externally. Now part of the release checklist: Korean/English input is verified on every release. Inert without the flag (#95)

## [0.14.5] — 2026-06-11

### Fixed
- Windows file browser failing with "파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다 (os error 123)" and showing the local path as `\?\C:\` — the local listing returned Rust `canonicalize`'s verbatim-prefixed path (which skips `/` normalization) and the UI joined local paths POSIX-style, so `..` collapsed to `/` and child paths became `\?\C:\/dir`. The verbatim prefix is now stripped and the local pane joins paths separator-aware (backslash, drive-root `C:\` floor); the remote SFTP pane keeps POSIX joins (#94)

## [0.14.4] — 2026-06-11

### Changed
- Internal (temporary diagnostic): on macOS the IME diag now also captures the last 14 mirror transitions (previous→current hidden-textarea content, **includes what was typed in the affected line**) — counters alone can't distinguish "the textarea's own composition is broken" (stray jamo + spaces being fed in) from a mirror bug, which is the leading suspicion for the newly reported Mac where deleting Hangul leaves 2-space gaps. Removed once #83 is closed (#83)

## [0.14.3] — 2026-06-11

### Fixed
- macOS: Korean input breaking permanently mid-session (until app restart) — the `nativeComposition` switch latched forever after a *single* composition event (e.g. press-and-hold accent popup, dictation), disabling the custom IME mirror that 229-only WKWebViews need for Hangul. The switch is now active only while a composition is actually in progress (confirmed on the maintainer's machine: Korean is pure keyCode-229 + mirror, no composition events — local diag `n229:33, mirror 36/31, nCS:0`) (#83)
- Windows: every confirm dialog (deleting hosts, SSH keys, groups/tags, remote files, LLM backends) silently failed — WebView2 routes `window.confirm` through the Tauri dialog plugin, whose `confirm` command wasn't granted in the capability file (`plugin:dialog|confirm not allowed by ACL`, captured by GlitchTip). Granted `dialog:allow-confirm/ask/message`; macOS was unaffected (#93)

## [0.14.2] — 2026-06-11

### Fixed
- Newest-macOS stray characters while typing English (`df -h` → `ddf -h…`) — second attempt, made robust against the root cause being unknown: the damage always comes from the custom IME mirror sending multi-backspace rewrite storms when macOS predictive features rewrite the hidden textarea (the v0.13.12 `writingsuggestions=false` attribute didn't stop it on the affected machine). The mirror now refuses to send rewrites that would erase 2+ characters of pure-ASCII content — a terminal wants raw keystrokes, so OS-driven rewrites are ignored while real typing (appends, single backspaces) and genuine CJK composition rewinds flow unchanged (#83)

### Changed
- Internal: re-added the lightweight macOS IME counters (structure only, no typed content) sent to GlitchTip on input idle, now including the suppressed-rewrite count, to verify the fix on the affected machine. To be removed once confirmed (#83)

## [0.14.1] — 2026-06-10

### Fixed
- Windows/Linux: app shortcuts (Ctrl+K palette, Ctrl+Tab, Ctrl+number, …) not working while the terminal had focus — xterm consumes Ctrl combos with stopPropagation, so the app's bubble-phase listener never saw them. The shortcut listener now runs in the capture phase on Windows/Linux (macOS unchanged) and stops propagation for keys it consumes, so e.g. Ctrl+K opens the palette instead of typing into the prompt (#92)

## [0.14.0] — 2026-06-10

### Added
- tmux auto-attach on SSH connect — a per-host "tmux auto-attach" field (session name); when set, connecting runs `tmux new-session -A -s <name>` so the connection always lands in a persistent tmux session (#89)
- tmux session picker — ⌘K → "tmux sessions" lists the tmux sessions of the focused terminal's machine (local or SSH, fetched without touching the visible shell) with window count and attached badge; click to attach/switch (works both inside and outside tmux), or create a new session from the same dialog (#89)
- Tab title sync — the terminal title (OSC 0/2; includes tmux window titles when `set-titles on`) is reflected in the tab label, falling back to the host/shell name when cleared; attaching to a tmux session (auto-attach or picker) immediately labels the tab `session · host` without requiring remote config (#89)
- Settings keyboard navigation — Esc closes the settings dialog and ←/→ switch between settings tabs (when focus is not in a text field) (#91)
- Default start directory for new terminals — a Terminal setting (with folder picker, `~` supported); new local tabs open there instead of home. A cwd saved by session restore still wins (#91)
- Session restore — on restart the previous tabs reopen: tab/split layout, local shells starting in their previous working directory (spawned with the tracked cwd — no visible `cd`), SSH tabs reconnecting, and panes that were attached to a known tmux session re-attaching to it (#90)

## [0.13.14] — 2026-06-10

### Fixed
- Input lines wrapping early at stale widths (most visible on Windows cmd.exe while typing Korean — the line broke after a few characters at inconsistent columns) — resizes that happen while the session is still spawning were dropped (`onResize` bails when `sessionId` isn't set yet), so the PTY/ConPTY kept the spawn-time size while xterm grew with the layout, and the shell wrapped its input echo at the old width. The current size is now synced once right after spawn completes (#88)

## [0.13.13] — 2026-06-10

### Fixed
- Windows/Linux: Korean composition was invisible while typing — the #75 CSS that hides xterm's `.composition-view` overlay (needed to avoid double display with the macOS mirror) applied on all platforms, but with the native IME path (v0.13.11) the in-progress syllable is shown *only* in that overlay, so hiding it left nothing on screen while composing. The hide is now scoped to macOS (`plat-mac` body class); Windows/Linux show the composition preview at the cursor (#88)
- Windows/Linux: standalone Korean jamo (ㄱ, ㅏ, …) committed by the native IME were silently dropped — the onData filter that discards stray compatibility jamo (a macOS-mirror leakage guard) now applies only on macOS (#88)

## [0.13.12] — 2026-06-10

### Fixed
- Newest-macOS prompt showing duplicated/ghost characters while typing (e.g. `df -h` → `ddf -hdff f -h`, command still executes correctly) — the real root cause, finally pinned by the v0.13.5 GlitchTip trace from the affected machine: macOS inline predictive text ("writing suggestions") routes even English keystrokes through IME processing (keyCode 229, **no** composition events), engaging the custom IME mirror; predictive text then rewrites the hidden textarea, so the mirror's diff sends a backspace+resend storm (15 chars + 10 backspaces for 5 keystrokes) whose interleaving with oh-my-zsh's per-keystroke line redraw leaves real stray characters in the buffer (which is why the v0.13.6 WebGL renderer change didn't help — net input was correct, so commands ran fine). Fixed by disabling inline predictive text on xterm's input textarea via the WebKit `writingsuggestions="false"` attribute (xterm only disables autocorrect/autocapitalize/spellcheck); English now takes the plain input path and the mirror only ever sees real IME composition (#83)

## [0.13.11] — 2026-06-09

### Fixed
- Windows/Linux Korean (and CJK) input only accepting the first syllable then freezing — the custom IME mirror (built for old macOS WKWebView) was being applied on Windows/Linux too and got stuck after the first composed syllable, blocking all further input (the root cause behind #84/#88, confirmed by a screen recording: "아" went in, then nothing). xterm.js handles CJK IME natively on Windows/Linux, so the mirror is now macOS-only; Windows/Linux use xterm's native IME directly. The temporary IME diagnostics are removed (#88)

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

[Unreleased]: https://github.com/cuter74-dev/wowTerminal/compare/v0.19.0...HEAD
[0.19.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.16.3...v0.17.0
[0.16.3]: https://github.com/cuter74-dev/wowTerminal/compare/v0.16.2...v0.16.3
[0.16.2]: https://github.com/cuter74-dev/wowTerminal/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.16...v0.15.0
[0.14.16]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.15...v0.14.16
[0.14.15]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.14...v0.14.15
[0.14.14]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.13...v0.14.14
[0.14.13]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.12...v0.14.13
[0.14.12]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.11...v0.14.12
[0.14.11]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.10...v0.14.11
[0.14.10]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.9...v0.14.10
[0.14.9]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.8...v0.14.9
[0.14.8]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.7...v0.14.8
[0.14.7]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.6...v0.14.7
[0.14.6]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.5...v0.14.6
[0.14.5]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.4...v0.14.5
[0.14.4]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.3...v0.14.4
[0.14.3]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.2...v0.14.3
[0.14.2]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/cuter74-dev/wowTerminal/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.14...v0.14.0
[0.13.14]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.13...v0.13.14
[0.13.13]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.12...v0.13.13
[0.13.12]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.11...v0.13.12
[0.13.11]: https://github.com/cuter74-dev/wowTerminal/compare/v0.13.10...v0.13.11
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
