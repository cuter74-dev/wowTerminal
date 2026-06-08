# SSH

The left **host panel** manages your SSH hosts and lets you connect with a click.

## Adding a host

Click **+** in the host panel header and fill in:

- **Name** — a display label for the host.
- **Host** and **Port** — the address and port (default `22`).
- **User** — the login username.
- **Auth** — agent, private key, or password (see [Authentication](#authentication)).
- Optionally assign a **group** and **tags**.

Use the **🔑** button to open the SSH key manager and the **⚙** button to manage groups
and tags.

## Connecting

- **Single click** a host → connect in the current tab.
- **Double click** a host → open the connection in a new tab.
- The **⌨ Local shell** entry at the top switches the active tab back to a local shell.

You can search hosts with the search box and sort **by name** or **by address**. Hosts are
grouped; ungrouped hosts appear under *(Ungrouped)*.

## Authentication

When a host needs a password, a prompt appears. You can **save the password to the OS
keychain** so you won't be asked again on that host — nothing is written to disk in
plaintext (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux).

For key-based auth, use the **SSH key manager** (🔑):

- **Generate** a new key pair, or
- **Import** an existing private key.

Keys are stored through the OS keychain, not in the project.

## Host-key verification (TOFU)

wowTerminal verifies server host keys against `known_hosts` using a
**trust-on-first-use** model:

- **First contact** — the first time you connect to a host, a dialog shows the server's
  key fingerprint. Verify it through a trusted channel, then confirm to remember it.
- **Key mismatch** — if a known host later presents a different key, a warning dialog
  appears. This can indicate a man-in-the-middle attack, so confirm only if you know the
  key legitimately changed (e.g. the server was reinstalled). You can choose to trust the
  new key and retry.

## Remote current-folder tracking (for drag-and-drop upload)

When you drag a file onto a connected SSH terminal — or open the file browser — it targets
the remote shell's **current folder**. wowTerminal does **not** inject anything into your
remote shell (that approach clears the screen on connect). On **Linux remotes** the current
folder is detected automatically and on demand by reading the interactive shell's working
directory via `/proc` (over a separate channel), so no setup is required.

On **non-Linux remotes** (macOS/BSD) or where `/proc` is restricted, this falls back to your
remote **home** directory. To get accurate current-folder tracking there too, add one line to
your remote shell's startup file:

```sh
# ~/.zshrc  (zsh)
precmd() { printf '\033]7;file://%s%s\007' "$HOST" "$PWD" }

# ~/.bashrc  (bash)
PROMPT_COMMAND='printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"'"${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
```

## Backup

Export your hosts, groups, and tags from **Settings → Import/Export**. The export is plain
JSON and **excludes all secrets** (passwords and keys remain in the keychain). Paste a
previously exported JSON back in the same screen to import.

See also: [SFTP](sftp.md) for browsing files on a connected host.
