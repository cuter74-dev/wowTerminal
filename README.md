# wowTerminal

> A context-aware AI terminal — LLM × SSH × SFTP.

wowTerminal is a cross-platform desktop terminal that brings an AI assistant, an SSH host
manager, and an SFTP file browser into one window. The assistant can read your current
terminal output as context, suggest commands, and send them straight to the active pane.

🌐 한국어 README: [README.ko.md](README.ko.md)

---

## Features

- **AI assistant (multi-backend)**
  - Works with any OpenAI-compatible endpoint — OpenAI, Ollama, vLLM, TGI, self-hosted gateways.
  - Sends the focused pane's recent output as context, so suggestions fit what you're doing.
  - Extracts commands from responses into cards with a one-click **Send to terminal** button.
  - Per-tab conversations, saved chat history, and session restore.
- **SSH manager**
  - Host profiles (name / host / port / user / auth), groups, tags, search and sort.
  - SSH key manager: generate or import keys.
  - TOFU host-key verification with `known_hosts` — first-contact confirmation and
    mismatch warnings to guard against man-in-the-middle attacks.
  - Password prompt with optional save to the OS keychain (no plaintext on disk).
- **SFTP file browser**
  - Dual local ↔ remote panes, upload/download with a progress bar and transfer queue.
  - Remote file search and Unix permission editing.
- **Terminal core**
  - PTY-backed local shells, rendered with xterm.js.
  - Tabs, split panes (horizontal / vertical), and **detach a tab into a new window**
    (the live session and screen are handed over).
  - Command history search (`Ctrl/⌘ + R`) and inline autocomplete (`Tab`).
- **UI**
  - Collapsible left host panel and right AI panel, with draggable widths.
  - 11 UI languages (auto-detected from your OS locale, switchable in Settings).
  - Dark / light themes, configurable font and scrollback.
  - Import/export of hosts, groups, and tags (secrets stay in the keychain).

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
