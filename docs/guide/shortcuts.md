# Keyboard shortcuts

`Ctrl` on Windows/Linux, `⌘` (Command) on macOS. The same table is available in-app under
**Settings → Shortcuts**.

## Tabs & panes

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + T` | New local shell tab |
| `Ctrl/⌘ + W` | Close active tab |
| `Ctrl/⌘ + Tab` | Next tab |
| `Ctrl/⌘ + Shift + Tab` | Previous tab |
| `Ctrl/⌘ + 1`–`9` | Jump to the Nth tab |
| `F2` | Rename tab |
| `Ctrl/⌘ + Shift + D` | Duplicate tab |
| `Ctrl/⌘ + Shift + ←` / `→` | Move tab / focus pane |
| `Ctrl/⌘ + Shift + L` | Split left/right |
| `Ctrl/⌘ + Shift + S` | Split top/bottom |

## In the terminal

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + R` | Search command history |
| `Shift + →` | Accept the inline autocomplete suggestion (when one is shown at the end of the line) |
| `Tab` | Shell completion (file / directory / command) |
| `Option/Alt + Delete` | Delete the previous word |
| `⌘ + Delete` | Delete the whole line |

The inline suggestion comes from your command history (plus a few built-in seeds, e.g.
`claude --dangerously-skip-permissions`). The accept key is deliberately its own chord:
`Tab` always goes to the shell for completion, `→`/`End` stay pure cursor movement, and
`Shift + →` — which no shell binds by default — accepts the suggestion. Inside full-screen
apps (vim, `less`, Claude Code, …) the suggestion is disabled, so `Shift + →` is passed
through to the app.

In history search, type to filter, use `↑`/`↓` to move, `Enter` to pick, `Esc` to cancel.

## Host list

| Shortcut | Action |
|---|---|
| `↑` / `↓` | Move the selection through the visible hosts |
| `Home` / `End` | First / last host |
| `Enter` | Open the selected host in a new tab |
| `↓` (in the search box) | Drop focus into the list |

Mouse still works the same — click to select, `▶` or double-click to open.

## Mouse

- **Drag a tab** away from the tab bar to detach it into a new window (the live session and
  screen are handed over).
- **Drag a panel divider** to resize the host/AI panel; click the arrow chip on a divider to
  collapse it.

> v1's key bindings are read-only; custom bindings are planned for a later release.
