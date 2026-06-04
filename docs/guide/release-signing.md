# Release code signing

The release workflow (`.github/workflows/release.yml`) wires the signing env vars to
`tauri-action` for **both** the main `.app` build and the best-effort `.dmg` step. When the
GitHub Actions Secrets below are present, that platform is signed automatically; when a
secret is empty, the platform stays **unsigned** (users then see a first-launch warning —
macOS Gatekeeper / Windows SmartScreen).

> Status: **macOS is configured** — a Developer ID Application certificate (team
> `Brain OS Institute`, `J5C9SY326P`) and notarization secrets are registered, so macOS
> builds ship signed + notarized. Windows remains unsigned (no certificate yet).

> Secrets live in: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

## macOS (signing + notarization)

The workflow already wires these env vars to `tauri-action`. Once the secrets exist, macOS
builds are signed and notarized.

**Prerequisites**

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. Create a **Developer ID Application** certificate in your Apple Developer account, then
   export it from Keychain Access as a `.p12` (with a password).
3. Create an **app-specific password** for notarization at
   [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords.

**Secrets to add**

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` — `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from step 3 |
| `APPLE_TEAM_ID` | your 10-character Team ID |

> Alternatively, notarize with an App Store Connect **API key** using
> `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_KEY_PATH` instead of
> `APPLE_ID` / `APPLE_PASSWORD`.

### ⚠️ The `.p12` MUST include the intermediate certificate

The single most common failure. Symptom — the CI macOS build prints:

```
1 identity imported.
failed to bundle project failed codesign application: failed to resolve signing identity
```

`1 identity imported` means `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` are
**correct** (import succeeded). The resolve failure is because the `.p12` contains only the
leaf certificate + private key, **not the "Developer ID Certification Authority (G2)"
intermediate**. Tauri locates the identity with `security find-identity -v` (valid only),
and on the CI's fresh keychain an identity without its chain is not valid — so it can't be
found. (It works locally because Xcode installs the intermediate on your Mac, which makes
local sign tests misleadingly pass.)

**Fix — export a chain-included `.p12`:**

- **Keychain Access (GUI):** select the **"Developer ID Application"** identity **and**
  ⌘-click the **"Developer ID Certification Authority" (OU=G2)** intermediate, then
  right-click → export **both** items as one `.p12`. A chain-included file is noticeably
  larger (~2.5 KB → ~4.5 KB; its base64 grows accordingly).
- **CLI:** download `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer`,
  convert to PEM, and pass it via `openssl pkcs12 -export … -certfile DeveloperIDG2CA.pem`.

Then update `APPLE_CERTIFICATE` (new base64) and `APPLE_CERTIFICATE_PASSWORD`, and re-run.

> If `find-identity` resolution still fails with the chain present, double-check
> `APPLE_SIGNING_IDENTITY` has **no surrounding quotes or whitespace** — it must be exactly
> `Developer ID Application: <name> (TEAMID)`.

## Windows

`tauri-action` does not sign Windows builds automatically; the right approach depends on
your certificate type:

- **OV certificate (`.pfx`)** — add a workflow step (on `windows-latest`) that decodes a
  base64 `.pfx` secret to a file and imports it, then set
  `bundle.windows.certificateThumbprint` in `src-tauri/tauri.conf.json` (or sign the
  produced `.msi`/`.exe` with `signtool` in a follow-up step). Note: as of 2023, new OV
  certificates are typically issued on hardware tokens, which don't work in CI.
- **EV certificate** — requires an HSM/hardware token; not usable in standard CI.
- **Azure Trusted Signing** (recommended for CI today) — a cloud signing service. Configure
  `bundle.windows.signCommand` to call `trusted-signing-cli`, and provide Azure credentials
  as secrets. See the
  [Tauri Windows signing guide](https://tauri.app/distribute/sign/windows/).

When Windows signing is set up, update the `releaseBody` note in the workflow to drop the
"unsigned" warning for Windows.

## After enabling signing

Push a new tag (e.g. `git tag v0.1.1 && git push origin v0.1.1`). The next release's
artifacts will be signed for any platform whose secrets are present.
