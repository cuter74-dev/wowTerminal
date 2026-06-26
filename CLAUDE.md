# CLAUDE.md

This file defines the rules Claude Code must follow when working in this repository.

## Workflow (Required)

Every task follows this order:

1. **Create a GitHub Issue**
   - Create an issue with `gh issue create` before starting work
   - Title may be Korean or English; write the goal/scope/definition-of-done in the body
2. **Create a work-log file**
   - Accumulate the day's work in `docs/work-log/YYYY-MM-DD.md`
   - Create it if it doesn't exist, otherwise append
   - Note the issue number at the top (e.g., `## #12 — AI backend interface design`)
3. **Develop**
   - Commit in small units; include `(#issue-number)` in the commit message
4. **Document & close the issue**
   - Summarize "what / why / how" in the work-log
   - Comment the result on the issue (`gh issue comment`), then `gh issue close`

## Versioning / Release Documentation (Required)

- Record every user-facing change in `CHANGELOG.md`.
  - When committing, add a one-line entry under the `[Unreleased]` section of `CHANGELOG.md`, classified as **Added/Changed/Fixed/Removed**, with `(#issue-number)`.
- **Version bump rule (0.x phase) — by change *size*, not by category** (decided 2026-06-26): the next version is decided by how big the change is, so the version rises slowly.
  - Bump **minor** (`0.X.0`) **only for major changes**: main-menu / navigation changes, or large / headline features.
  - Bump **patch** (`0.x.Y`) for **everything else** — small feature additions *and* bug fixes both bump patch. (Feature vs. bug is still recorded in `CHANGELOG.md` via **Added** / **Fixed**, but both only bump the patch digit.)
  - Prefer **batching** several small changes into one release instead of releasing each one, so the version doesn't climb fast.
  - If the user specifies a particular version, that instruction takes priority.
  - Note: 4-segment versions like `0.x.y.z` are **not possible** — Cargo / Tauri / npm / the auto-updater all require 3-part SemVer.
- On "bump the version and release":
  1. Move the `[Unreleased]` entries into a new version section `## [X.Y.Z] — YYYY-MM-DD`, and update the comparison links at the bottom.
  2. Bump the version: `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` (`cargo update -p wowterminal --precise X.Y.Z`).
  3. Commit, then push the `vX.Y.Z` tag → GitHub Actions builds/signs/creates a draft Release.
  4. **Auto-publish (per user instruction)**: when the workflow finishes successfully (after verifying the assets), publish the draft immediately.
     `gh release edit vX.Y.Z --draft=false --latest` — proceed without asking each time (existing users get the auto-update).
- Format is Keep a Changelog; versioning is SemVer.

## Key Directories

- `src/` — React + TypeScript frontend
- `src-tauri/src/` — Rust backend
  - `ai/` — AI backend abstraction (external/local/self-hosted)
  - `ssh/` — SSH manager (hosts/keys)
  - `pty/` — PTY terminal core
- `docs/design/` — design docs (interfaces, data models, etc.)
- `docs/work-log/` — per-day work logs

## Security Rules

- Never store API keys, SSH private keys, or passwords in plaintext
- Store keys using the OS keyring or user-passphrase-based encryption
- `.env`, `*.pem`, `*.key`, `secrets/` are included in `.gitignore`

## Build / Run

```bash
npm install
npm run tauri dev    # development mode
npm run tauri build  # production build
```
