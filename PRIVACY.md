# Privacy Policy — wowTerminal

_Last updated: 2026-06-23_

wowTerminal is an SSH / SFTP client and AI assistant terminal. This policy explains what
data the app handles. The short version: **your credentials and the servers you connect to
stay on your device and go only where you direct them; the only data sent to the developer
is anonymous crash/error diagnostics.**

## What the app stores on your device

- **Connection profiles** (host names, ports, usernames, groups, tags) and app settings are
  stored locally on your device.
- **Secrets** — SSH private keys, passwords, and AI provider API keys — are stored in the
  operating system keychain (Apple Keychain on iOS, the Android Keystore/keyring on Android).
  They are never transmitted to the developer.

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

To find and fix crashes, the app sends **error and crash reports** to a self-hosted error
tracker (GlitchTip) operated by the developer. These reports contain technical information
such as the app version, operating system, and error stack traces. They do **not** include
your passwords, private keys, API keys, or terminal session contents.

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
