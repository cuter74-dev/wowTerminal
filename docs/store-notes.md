# Store release notes

The "what's new" text sent to Google Play (en-US, ko-KR) and the App Store (en-US) for each
version (#194). Keep it short, plain `-` lists only (the App Store rejects `•` and quotes with 409
`INVALID_CHARACTERS`), and only list what applies to mobile — desktop-only changes (session
daemon, detached windows, local tabs) don't go here. Full change history: `CHANGELOG.md`.

| App version | Play versionCode | App Store version (build) |
|---|---|---|
| 0.22.2 | 22002 | 1.0.23 (0.22.2.22002) |
| 0.22.1 | 22001 | 1.0.22 (0.22.1.22001) |
| 0.22.0 | 22000 | 1.0.21 |

## 0.22.2 — 2026-11-16

**en-US (Play, App Store)**
```
- Notifications and other app messages now use the language you chose in Settings (they were always in English).
```

**ko-KR (Play)**
```
- 알림과 앱 문구가 설정에서 고른 언어로 나옵니다(지금까지는 늘 영어였습니다).
```

## 0.22.1 — 2026-11-14

**en-US (Play, App Store)**
```
- Agents running on servers inside tmux are now detected even when the server has no default locale.
- Shift+Enter inserts a newline in Claude Code, Codex and Gemini CLI.
- Per-host startup command (for example cd ~/proj && claude) and SSH agent forwarding.
- Paste an image into an SSH tab to upload it to the server and insert its path.
```

**ko-KR (Play)**
```
- 기본 언어가 없는 서버의 tmux 안에서 도는 에이전트도 표시됩니다.
- Claude Code, Codex, Gemini CLI에서 Shift+Enter가 줄바꿈입니다.
- 서버별 접속 후 시작 명령(예: cd ~/proj && claude)과 SSH 에이전트 포워딩.
- SSH 탭에 이미지를 붙여넣으면 서버에 올리고 경로를 입력합니다.
```
