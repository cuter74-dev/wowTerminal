<div align="center">

<img src="logo.png" alt="wowTerminal" width="116" />

# wowTerminal

### Make Your Terminal Smarter & Safer — LLM × SSH × SFTP

[![Release](https://img.shields.io/github/v/release/cuter74-dev/wowTerminal?color=4a9eff&label=release)](https://github.com/cuter74-dev/wowTerminal/releases/latest)
[![License](https://img.shields.io/github/license/cuter74-dev/wowTerminal?color=blue)](LICENSE)
[![Stars](https://img.shields.io/github/stars/cuter74-dev/wowTerminal?color=f5c518)](https://github.com/cuter74-dev/wowTerminal/stargazers)
[![Downloads](https://img.shields.io/github/downloads/cuter74-dev/wowTerminal/total?color=2ea44f&label=downloads)](https://github.com/cuter74-dev/wowTerminal/releases)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/cuter74-dev/wowTerminal/releases/latest)

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![xterm.js](https://img.shields.io/badge/xterm.js-2D2D2D?logo=gnometerminal&logoColor=white)

A context-aware AI terminal — a chat assistant that reads your terminal,<br/>
an SSH host manager, and a dual-pane SFTP file browser, in one fast desktop app.

[✨ Features](#features) • [🚀 Getting started](#getting-started) • [⌨️ Shortcuts](docs/guide/shortcuts.md) • [🔐 SSH](docs/guide/ssh.md) • [📁 SFTP](docs/guide/sftp.md) • [🤖 AI](docs/guide/ai.md)

<sub>Love this project? A ⭐ on the repo keeps it going.</sub>

</div>

---

## Features

- **AI assistant (multi-backend)**
  - Works with any OpenAI-compatible endpoint — OpenAI, Ollama, vLLM, TGI, self-hosted gateways.
  - Knows the connected system (OS / shell / user / cwd) and can attach the focused pane's
    recent output, so suggestions fit the machine and what you're doing.
  - Extracts commands from responses into cards with a one-click **Send to terminal** button.
  - Per-tab conversations, saved chat history, and session restore.
- **SSH manager**
  - Host profiles (name / host / port / user / auth), groups, tags, search and sort, with
    keyboard navigation (`↑`/`↓` to select, `Enter` to open).
  - SSH key manager: generate or import keys.
  - TOFU host-key verification with `known_hosts` — first-contact confirmation and
    mismatch warnings to guard against man-in-the-middle attacks.
  - Password prompt with optional save to the OS keychain (no plaintext on disk).
- **SFTP file browser**
  - Dual local ↔ remote panes, upload/download with a progress bar and transfer queue.
  - Remote file search and Unix permission editing.
- **Terminal core**
  - PTY-backed local shells, rendered with xterm.js (WebGL-accelerated).
  - Tabs, split panes (horizontal / vertical), and **detach a tab into a new window**
    (the live session and screen are handed over).
  - **Session restore** — on restart the previous tabs reopen: layout, local shells in their
    previous working directory, SSH tabs reconnecting, tmux panes re-attaching.
  - **tmux integration** — per-host auto-attach on SSH connect, a `⌘K` tmux session picker
    (local or remote, with attach/switch/create), and tab titles that follow the session.
  - Dead-session detection — if the connection drops (e.g. after sleep), the tab says so
    and **Enter reconnects in place** (back into tmux when auto-attach is set).
  - Command history search (`Ctrl/⌘ + R`), inline autocomplete from history (accept with
    `Shift + →`; `Tab` stays shell completion and `→`/`End` stay cursor movement), and a
    configurable default start directory for new terminals.
- **UI**
  - Collapsible left host panel and right AI panel, with draggable widths.
  - 11 UI languages (auto-detected from your OS locale, switchable in Settings).
  - Dark / light themes, configurable font and scrollback.
  - Import/export of hosts, groups, tags, and LLM backends (secrets and API keys stay in
    the keychain — re-enter keys after importing).

## Tech stack

- **Backend**: Rust + [Tauri 2](https://tauri.app/)
- **Frontend**: React 19 + TypeScript + Vite
- **Terminal**: [xterm.js](https://xtermjs.org/) + [portable-pty](https://crates.io/crates/portable-pty)
- **SSH/SFTP**: [russh](https://crates.io/crates/russh) + [russh-sftp](https://crates.io/crates/russh-sftp)
- **Secrets**: OS keychain via [keyring](https://crates.io/crates/keyring)

## Getting started

> **Prerequisites**: Rust (stable), Node.js 20+, and platform build dependencies.
> On Linux you also need `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and related packages.
> See the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # development build with hot reload
npm run tauri build    # production bundle
```

The first launch shows a short onboarding flow. After that you land on a local shell tab.

## Documentation

User guides live in [`docs/guide/`](docs/guide/):

- [Getting started](docs/guide/getting-started.md) — install, first run, the workspace layout
- [SSH](docs/guide/ssh.md) — hosts, keys, host-key verification, saved credentials
- [SFTP](docs/guide/sftp.md) — the file browser, transfers, permissions
- [AI assistant](docs/guide/ai.md) — backends, context, running suggested commands
- [Keyboard shortcuts](docs/guide/shortcuts.md)
- [Release code signing](docs/guide/release-signing.md) — for maintainers building signed releases

Design notes are in [`docs/design/`](docs/design/); the dated development log is in
[`docs/work-log/`](docs/work-log/).

## Project layout

```
.
├── src/                  # React frontend
│   ├── components/        # UI components
│   ├── i18n.tsx           # lightweight self-hosted i18n
│   └── settings.ts        # app settings (theme, layout, language)
├── src-tauri/            # Rust backend (Tauri)
│   └── src/
│       ├── ai/            # AI backends (OpenAI-compatible)
│       ├── ssh/           # SSH manager, known_hosts
│       ├── pty/           # PTY terminal core
│       └── secrets/       # keychain-backed secret storage
└── docs/
    ├── design/            # design docs
    ├── guide/             # user guides (English)
    └── work-log/          # dated development log
```

## Security

- API keys, SSH private keys, and passwords are never stored in plaintext — they live in
  the OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux).
- Host/group/tag export does **not** include secrets.
- SSH connections verify host keys against `known_hosts` (trust-on-first-use).

## License

[MIT](LICENSE) © CW JUNG
