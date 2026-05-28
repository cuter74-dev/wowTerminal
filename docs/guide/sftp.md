# SFTP

wowTerminal includes an SFTP file browser for transferring files between your machine and
a connected SSH host.

## Opening the browser

Focus a pane that is connected to an SSH host, then click **📁 Files** in the title bar.
(The button is disabled when the active pane is a local shell.)

## Layout

The browser shows two panes side by side:

- **Local** — files on your machine.
- **Remote** — files on the SSH host.

Navigate either side by clicking folders. Each pane shows file names, sizes, and Unix
permissions.

## Transferring files

- **Download** — copy a remote file to the local pane.
- **Upload** — copy a local file to the remote pane.

Transfers stream in chunks, so large files don't load entirely into memory. A
**progress bar** shows each transfer, and multiple transfers run concurrently through a
**transfer queue** at the bottom:

- Active transfers show a progress bar.
- Finished transfers show ✓ (done) or ✗ (failed).
- Use the counter / clear control to remove completed entries.

When a transfer would overwrite an existing file, you're asked to confirm first.

## Permissions

Open the permissions editor on a remote file to view and change its Unix mode
(read/write/execute for owner/group/others).

## Search

Use remote file search to find files on the host without manually walking the directory
tree. Results are capped (make your query more specific if they're truncated).

See also: [SSH](ssh.md) for connecting to a host first.
