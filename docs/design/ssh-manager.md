# SSH Manager Design (v0.1 draft)

## Goal
Manage SSH hosts and keys in one place, and let users open a new terminal session with a single click in the UI.

Core user scenarios:
1. Add a new host (name, host, port, user, select/generate a key file)
2. Click a host in the list → a PTY session opens immediately
3. Keys never remain on disk in plaintext.

## Data Model

```rust
struct SshHost {
    id: String,           // UUID
    name: String,         // user-facing display name
    host: String,
    port: u16,            // default 22
    user: String,
    auth: SshAuthMethod,
    tags: Vec<String>,    // e.g.: ["prod", "k8s-node"]
}

enum SshAuthMethod {
    Password { secret_id: String },
    PrivateKey {
        key_id: String,
        passphrase_secret_id: Option<String>,
    },
    Agent,                // delegate to ssh-agent
}
```

## Storage Locations

| Kind | Location | Format |
|---|---|---|
| Host profiles (metadata) | `~/.config/wowterminal/hosts.toml` | TOML |
| Secrets (passwords, passphrases, raw private keys) | OS keyring or `~/.local/share/wowterminal/secrets.bin` (AES-256-GCM) | keyring entry or encrypted KV |

Host profiles contain only a **`secret_id` / `key_id` reference**, not the secret itself.

## Key Storage Methods

### Priority 1: OS keyring
- Uses the `keyring` crate
- Linux: Secret Service (libsecret) / KWallet
- macOS: Keychain
- Windows: Credential Manager

### Priority 2: passphrase-encrypted file
- For environments where the keyring is disabled/absent (headless Linux, SSH-only environments)
- The user enters a master passphrase once at app start → derive a KEK with Argon2id → decrypt secrets with AES-256-GCM
- Keep plaintext in memory as briefly as possible; explicitly wipe with `zeroize`

### Priority 3: ssh-agent delegation
- When the user delegates key management to an external agent
- wowTerminal simply delegates authentication via the agent socket (no separate key storage)

## New Key Generation Flow (UI)
1. Click "Add key" → modal
2. Option A: import an existing key file (select path → enter passphrase)
3. Option B: generate a new key (ed25519 by default; the user may also choose RSA 4096)
   - Encrypt and store in the keystore immediately upon generation
   - The public key can be exported to clipboard/file
4. In Option B the generated key's raw file is not left on disk. For external files imported via Option A, ask the user whether to delete them.

## Connection Flow (runtime)
1. Click a host in the UI → Tauri command `ssh_connect(host_id)`
2. The backend loads the `SshHost` → looks up the keystore by `secret_id`/`key_id` → loads the plaintext secret into memory
3. Connect via the `russh` (or `thrussh`) client and request a PTY channel
4. Connect the channel's bidirectional byte stream to the frontend xterm.js (Tauri event based)
5. Zeroize the secret from memory when the session ends

## Module Structure

```
src-tauri/src/ssh/
├── mod.rs            # public API
├── types.rs          # SshHost, SshAuthMethod
├── store.rs          # load/save hosts.toml (TODO)
├── keystore.rs       # keyring + encryption fallback (TODO)
└── session.rs        # russh-based connect/PTY channel (TODO)
```

## Security Checklist
- [ ] No plaintext key files left on disk (except the user's import Option A)
- [ ] Zeroize plaintext secrets in memory right after use
- [x] Host key verification (known_hosts TOFU) — see `known_hosts.rs`. On change, a clear `SshError::HostKeyMismatch`; force-update from the UI via the `ssh_trust_known_host` command
- [ ] Appropriate backoff on a wrong passphrase (brute-force prevention)
- [ ] Secrets are never exported alongside host profiles when exporting externally

## known_hosts (TOFU)

### Policy
- **First contact**: do **not** auto-save. Reject and show the fingerprint to the user via `SshError::FirstContactRequired { host, port, algorithm, fingerprint }`. The user must verify the fingerprint out-of-band and then call `ssh_trust_known_host(...)`; only then is it recorded in known_hosts and the next connection passes.
- **Reconnect (match)**: pass.
- **Reconnect (mismatch)**: reject immediately. `SshError::HostKeyMismatch { host, port, algorithm, stored, presented }`. The UI shows this to the user, who — if they understand the risk — can update via `ssh_trust_known_host` to trust the new key.

### Storage Location / Format
- `~/.config/wowterminal/known_hosts.toml`
- One entry per `(host, port)`. The fingerprint is in `SHA256:...` format (the ssh-key crate's `Fingerprint::to_string()`).

```toml
version = 1

[entries."example.com:22"]
algorithm = "ssh-ed25519"
fingerprint = "SHA256:AbCd..."
added_at = "@unix:1716352800"
```

### Implementation
- `src-tauri/src/ssh/known_hosts.rs` — `KnownHostsStore` (CRUD + `check`/`record`/`forget`/`list`)
- `src-tauri/src/ssh/session.rs` — `TofuHandler` implements `russh::Handler::check_server_key`. It exposes the result (`TofuOutcome`) externally via `Arc<Mutex<Option<...>>>` to convert a connect failure into the precise error.
- Tauri commands: `ssh_list_known_hosts`, `ssh_forget_known_host`, `ssh_trust_known_host`.

### Limitations / TODO
- Using an IPv6 address directly as the key breaks `:` splitting → need to introduce zone notation/brackets later.

## Open Questions
- Re-encrypting all secrets when the master passphrase changes — how to surface this in the UX.
- Whether the user should freely choose between the keyring and the passphrase file, or auto-detection is enough.
- Whether to share known_hosts with the OS's `~/.ssh/known_hosts` or manage it separately.

## Next Steps (TODO)
- [ ] Implement `store.rs`, `keystore.rs`
- [ ] `russh`-based SSH client + PTY channel (`session.rs`)
- [ ] Frontend host list UI
- [ ] Key generation / import modal
```
