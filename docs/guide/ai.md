# AI assistant

The right **AI panel** is a chat assistant that understands what's on your terminal. It
talks to any OpenAI-compatible backend, so you can use a hosted API, a local model, or your
own gateway.

## Configuring a backend

If no backend is set up yet, click **+ Add LLM backend** (or the settings icon in the AI
panel header) and fill in:

- **Display name** — a label for this backend.
- **API base URL** — the endpoint base. wowTerminal calls `…/chat/completions` under it.
- **Default model** — the model id to use.
- **API key** — optional, stored in the OS keychain (never in plaintext).

Examples:

| Backend | API base URL | Model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3` |
| Self-hosted (vLLM/TGI) | your gateway's base URL | your served model |

You can add several backends and switch between them. Each backend needs a unique id.

## Chatting

Type a message and press **Enter** to send (**Shift+Enter** for a newline). Responses
stream into the conversation.

### Context

When **Include active pane output as context** is on, the assistant receives the recent
output of the focused terminal pane along with your message. This lets it answer about what
you're actually seeing — errors, command output, file listings — instead of guessing.

### Running suggested commands

When a response contains a fenced code block, the assistant shows it as a **command card**
with a **▶ Send to terminal** button. Clicking it types the command into the active
terminal pane — you press **Enter** yourself, so you stay in control.

## Conversations

- Each **tab has its own conversation** — switching tabs switches the assistant's context.
- Chat sessions are saved; open the **history** to revisit or delete past conversations.
- When you **detach a tab** into a new window, its conversation is handed over too.

See also: [Getting started](getting-started.md) for the workspace layout.
