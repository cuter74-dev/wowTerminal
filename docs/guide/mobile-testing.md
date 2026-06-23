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

The desktop release (`.github/workflows/release.yml`) is unchanged. Mobile distribution
is a separate pipeline; both need credentials that only the account owner can issue.
Add them as **GitHub Actions secrets** (Settings → Secrets and variables → Actions; the
`gh` CLI PAT lacks the scope — use the web UI).

### 3a. iOS → TestFlight

Bundle ID: `com.wowterminal.app` (register it in App Store Connect → Apps before the
first upload). Required, from the Apple Developer account `924883CCSU`:

| Secret | What it is |
|---|---|
| `ASC_API_KEY_ID` | App Store Connect API key ID (Users and Access → Integrations → App Store Connect API → generate a key with *App Manager* role). |
| `ASC_API_ISSUER_ID` | The issuer ID shown above the keys list. |
| `ASC_API_KEY_P8_BASE64` | The downloaded `AuthKey_XXXX.p8`, base64-encoded. |
| `IOS_DIST_CERT_P12_BASE64` | **Apple Distribution** certificate + private key as a chain-included `.p12`, base64. (Distinct from the Developer ID cert used for macOS — see [release-signing.md](release-signing.md).) |
| `IOS_DIST_CERT_PASSWORD` | The `.p12` export password. |
| `IOS_PROVISIONING_PROFILE_BASE64` | An **App Store** provisioning profile for the bundle ID, base64. |

Pipeline shape (to be added once the secrets exist): `tauri ios build --export-method
app-store-connect` to produce a signed `.ipa`, then upload with
`xcrun altool --upload-app` (or `fastlane pilot upload`) authenticated by the ASC API key.

### 3b. Android → Google Play (internal testing)

Required:

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | An upload keystore (`keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`), base64. |
| `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` | Keystore + key credentials. |
| `PLAY_SERVICE_ACCOUNT_JSON` | A Google Play Console service-account JSON with *release to internal testing* permission. |

Pipeline shape: `tauri android build --aab` signed with the keystore, then upload to the
**internal** track with `fastlane supply` (or the Gradle Play Publisher) using the
service-account JSON. The first AAB must be uploaded to Play Console manually to create
the app entry before automated uploads work.

> Store **registration and review** (App Store Connect / Play Console app creation,
> screenshots, privacy answers, review submission) is account-owner-only and can't be
> automated here.
