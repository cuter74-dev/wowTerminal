# Getting started

## Install & run

**Prerequisites**

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 20 or newer
- Platform build dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).
  On Linux this includes `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and related packages.

**Run from source**

```bash
npm install
npm run tauri dev      # development build with hot reload
npm run tauri build    # production bundle (installer/app in src-tauri/target/release)
```

## First run

The first time you launch wowTerminal you'll see a splash screen followed by a short
onboarding flow. When it finishes (or if you've onboarded before), you land on a single
**local shell** tab — a normal PTY-backed shell for your machine.

The UI language is auto-detected from your OS locale on first run. You can change it any
time in **Settings → General → Language** (11 languages are available).

## The workspace

```
┌───────────────────────────────────────────────────────────┐
│  Title bar:  AI Terminal · subtitle ······ 📁 Files  ⚙     │
├───────────────────────────────────────────────────────────┤
│  Tab bar:  [ Local shell 1 ] [ + ]                         │
├──────────────┬──────────────────────────┬──────────────────┤
│              │                          │                  │
│  Host panel  │      Terminal area       │    AI panel      │
│  (SSH hosts) │   (tabs, split panes)    │   (assistant)    │
│              │                          │                  │
└──────────────┴──────────────────────────┴──────────────────┘
```

- **Title bar** — product name, the active tab's context, a **Files** button (opens SFTP
  when an SSH pane is focused), and **Settings** (⚙).
- **Tab bar** — open tabs. `+` opens a new local shell. Right-click a tab for more actions;
  double-click to rename.
- **Host panel** (left) — your SSH hosts and the local shell entry. See [SSH](ssh.md).
- **Terminal area** (center) — the active tab. Tabs can be split into multiple panes and
  detached into their own windows.
- **AI panel** (right) — the assistant for the active tab. See [AI assistant](ai.md).

### Collapsing and resizing panels

Both side panels can be collapsed. Each panel has a thin divider next to the terminal:

- Click the **arrow chip** in the divider to collapse that panel.
- When collapsed, a slim handle appears at the screen edge — click it to expand again.
- Drag the divider to resize the panel (180–560 px). Widths and collapsed state are saved.

## Settings

Open **Settings** (⚙) in the title bar:

- **General** — UI language, restore-tabs toggle, and an About box.
- **Terminal/Theme** — font size/family, dark/light theme, cursor blink, scrollback.
  Changes apply to all terminals immediately.
- **Shortcuts** — a reference table (see [Keyboard shortcuts](shortcuts.md)).
- **Import/Export** — back up hosts, groups, and tags as JSON. Secrets are **not** included.

Next: [SSH](ssh.md) · [SFTP](sftp.md) · [AI assistant](ai.md) · [Shortcuts](shortcuts.md)
