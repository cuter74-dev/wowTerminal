# Release code signing

By default the release workflow (`.github/workflows/release.yml`) produces **unsigned**
builds, so users see a first-launch warning (macOS Gatekeeper / Windows SmartScreen). To
ship signed builds, obtain the certificates below and add them as **GitHub Actions
Secrets** — the workflow picks them up automatically with no code change. If a secret is
empty, that platform stays unsigned.

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
