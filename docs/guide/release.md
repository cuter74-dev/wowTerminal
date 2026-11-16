# Releasing wowTerminal

How a version goes out to every channel, and what is checked before it is public. Code
signing setup for the desktop builds is in [release-signing.md](release-signing.md); the
store "what's new" text per version is in [../store-notes.md](../store-notes.md).

Helpers live in `scripts/release/`. They read credentials from the release machine, never
from the repo:

| Helper | What it does | Needs |
|---|---|---|
| `verify_release.py <dir>` | Checks a downloaded desktop release: `latest.json` platforms, Windows default = NSIS, `.sig` files, Ed25519 signatures of the mac/Windows update files | `cryptography` |
| `play_upload.py <name> <notes-en> <notes-ko>` | Uploads the AAB to Play production (status completed) with release notes | `WT_PLAY_KEY` (service-account JSON path), optional `WT_AAB` |
| `ios_submit.py <1.0.x> <build> <notes>` | Waits for the build, creates the App Store version (release after approval), attaches the build, sets what's new, submits for review | `~/.appstoreconnect` (or `ASC_KEY_DIR`) |
| `ios_swap.py <1.0.x> <build> <notes>` | Replaces the build of a version that is waiting for review and resubmits | same |
| `ios_watch.py <1.0.x> [--once]` | Polls the review state every 10 min until it is no longer pending; stops after 3 failed reads | same |
| `asc.py` | App Store Connect API client (ES256 JWT) used by the iOS helpers | same |
| `gitlab_mirror.py <sha> <msg> <entries>` | Replays a GitHub commit on the GitLab worktree with a Korean message and Korean CHANGELOG entries, then prints the code-parity line count (must be 0) | GitLab worktree |

## Versioning

- 0.x phase: bump **minor** only for big changes (main menu / navigation, headline
  features), **patch** for everything else. Batch small changes.
- Versions are 3-part SemVer (Cargo, Tauri, npm and the updater all require it).
- Android versionCode = major·1000000 + minor·1000 + patch (0.22.2 → 22002). The App Store
  marketing version is a separate `1.0.x` line; the build number carries the app version
  (`0.22.2.22002`).

## Steps

1. **Changelog and version.** Move the `[Unreleased]` entries of `CHANGELOG.md` into
   `## [X.Y.Z] — YYYY-MM-DD` and add the compare link. Bump `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package-lock.json` (2 lines) and
   `src-tauri/Cargo.lock` (`cargo update -p wowterminal --precise X.Y.Z`). Run `npm test`
   and `cargo test`.
2. **Tag.** Commit `chore(release): vX.Y.Z — …`, push `main`, push tag `vX.Y.Z`.
   `release.yml` builds macOS (arm, intel), Linux and Windows into one draft release.
3. **iOS build** (same time): `gh workflow run ios-testflight.yml -f build_number=<versionCode>`.
   It builds with Xcode 26 and uploads to TestFlight.
4. **Android build** (release machine, a clean worktree at the tag): JDK 21,
   `ANDROID_HOME`, `NDK_HOME`, then `npx tauri android build --aab`. `gen/android` is not in
   git; its signing config and `keystore.properties` stay on the release machine. Check the
   AAB: version name/code, upload-key signer, four ABIs.
5. **Verify the desktop draft** before publishing: 17 assets; download `latest.json`, the
   `.sig` files and the mac/Windows update files and run `verify_release.py`; unpack the
   arm64 `.app.tar.gz` and check version, `codesign --verify --deep --strict` and
   `spctl -a -vv` ("Notarized Developer ID").
6. **Publish:** `gh release edit vX.Y.Z --draft=false --latest`, then confirm the updater
   endpoint (`…/releases/latest/download/latest.json`) reports the new version.
7. **Play:** `play_upload.py` with the notes from `docs/store-notes.md`.
8. **App Store:** `ios_submit.py 1.0.x <version>.<versionCode> <notes>` and `ios_watch.py`.
9. **Record:** work log (`docs/work-log/`), store notes, GitLab mirror of every commit
   (Korean), issues commented and closed.
