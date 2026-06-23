# Mobile: on-device testing & distribution

The tablet build (iPad / Android) is an SSH / SFTP + AI client — there is no local
shell on mobile. This guide covers running on a **real device** (required for input
verification — the simulator/emulator can't reproduce the IME path) and the
**distribution** setup for TestFlight and Google Play internal testing.

Prerequisites: the desktop dev setup plus the mobile toolchains.

```bash
# iOS targets + Android targets
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

---

## 1. Run on a real device

### iOS (iPad / iPhone)

1. Connect the device over USB and trust the computer.
2. In Xcode → Settings → Accounts, sign in with the Apple ID that owns the
   **Developer ID** team (`924883CCSU`). A free Apple ID also works for *development*
   installs on your own device.
3. Run:

   ```bash
   npm run tauri ios dev "<device name>"
   # or open src-tauri/gen/apple/wowterminal.xcodeproj in Xcode,
   # pick the device, set the signing team, and Run.
   ```

   First run prompts to enable Developer Mode on the device (Settings → Privacy &
   Security → Developer Mode).

### Android

1. Enable **USB debugging** (Settings → Developer options) and connect over USB.
2. Run (JDK 21 is required — newer JDKs fail Gradle with
   `Unsupported class file major version`):

   ```bash
   JAVA_HOME="$(/usr/libexec/java_home -v 21)" \
   ANDROID_HOME="$HOME/Library/Android/sdk" \
   NDK_HOME="$HOME/Library/Android/sdk/ndk/<version>" \
   npm run tauri android dev
   ```

---

## 2. Input check (Korean / English) — required

Input bugs are display-level and **can't be caught by file-based self-tests** — they
must be verified by eye on a real device. Connect to a host, then in an SSH session:

- [ ] **English** typing echoes correctly; no doubled/dropped characters.
- [ ] **Korean** 자모 compose into syllables correctly (e.g. `ㅎ`+`ㅏ`+`ㄴ` → `한`); no
      piled-up jamo.
- [ ] **Backspace** deletes one cell (Korean syllable deletes cleanly — not "acts like
      Space"). This was the #109 class of bug.
- [ ] The **on-screen key bar**: arrows move the cursor, `Esc` / `Tab` work, the sticky
      **Ctrl** then a letter sends the control sequence (e.g. Ctrl → `c` interrupts), and
      the bar is fully visible above the keyboard (not clipped — the `100dvh` fix).
- [ ] **☰ Hosts / ✨ AI** toolbar opens the slide-over sheets; backdrop tap closes them.

Report the device model + iOS/Android version with any issue.

---

## 3. Distribution

Mobile distribution (TestFlight and Google Play internal testing) — the signing
pipeline, the required secrets, and the step-by-step App Store Connect / Play Console
setup — is **kept in internal maintainer docs**, not in this public repository.

Store **registration and review** (app creation, screenshots, privacy answers, review
submission) is account-owner-only and can't be automated.
