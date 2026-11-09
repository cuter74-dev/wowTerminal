# Privacy Policy — wowTerminal

_Last updated: 2026-11-09_

wowTerminal is an SSH / SFTP client and AI assistant terminal. This policy explains what
data the app handles. The short version: **your credentials and the servers you connect to
stay on your device and go only where you direct them; the only data sent to the developer
is error reports with personal details removed, and an anonymous signal when the app starts.**

## What the app stores on your device

- **Connection profiles** (host names, ports, usernames, groups, tags) and app settings are
  stored locally on your device.
- **Secrets** — SSH private keys, passwords, and AI provider API keys — are stored encrypted:
  on macOS, Windows and Linux in an AES-GCM encrypted file in the app's settings folder, on iOS
  in the Apple Keychain, and on Android in an encrypted file with a random per-install key in
  the app's private storage. They are never stored in plain text and never transmitted to the
  developer.

This data never leaves your device except to make the connections you initiate.

## Connections you make

- **SSH / SFTP**: the app connects directly to the servers you configure. Your traffic and
  credentials go to those servers only — they are not proxied through, or visible to, the
  developer.
- **AI assistant**: when you use the AI features, your prompts (and any terminal context you
  choose to attach) are sent **directly to the AI provider you configured** (e.g. OpenAI, a
  self-hosted/OpenAI-compatible endpoint, or a local model). Their handling of that data is
  governed by that provider's privacy policy. The developer does not receive this data.

## Diagnostics sent to the developer

To find and fix crashes, the app sends diagnostics to a self-hosted error tracker (GlitchTip)
operated by the developer:

- **Error and crash reports**, when something goes wrong: the error type and message, the
  stack trace (where in the app's code it happened), the operating system and device type, and
  the app version. Before sending, the app removes your computer's name and home folder path,
  and — for errors in the app's interface — file paths, addresses, `user@host` and e-mail
  addresses from the message.
- **An anonymous session signal** when the app starts: a random session id, the app version
  and the user agent. It does not identify you.

These diagnostics do **not** include anything you type, what is on the terminal screen,
command output, AI conversations, your computer's name, passwords, private keys or API
keys.

You can turn all of this off in **Settings → General → Send error reports** (from version
0.21.7). When it is off, the app sends neither error reports nor the session signal.

**Correction (2026-11-09):** versions 0.14.4 to 0.21.5 on macOS (and on iPad before 0.20.19)
also sent a temporary input diagnostic to the same tracker, up to four times per app run. It
included recently typed input, which could contain a password typed at a terminal password
prompt, and a few lines of terminal text and output. This contradicted this policy. It was
removed in 0.21.6, and the stored reports are being deleted.

## What the app does NOT do

- No advertising.
- No third-party analytics or tracking SDKs.
- No selling or sharing of personal data.
- No accounts — the app does not require you to sign up.

## Children

The app is a developer tool and is not directed at children.

## Changes

This policy may be updated; the "last updated" date above reflects the latest version.

## Contact

Questions or requests: open an issue at
<https://github.com/cuter74-dev/wowTerminal/issues>.
