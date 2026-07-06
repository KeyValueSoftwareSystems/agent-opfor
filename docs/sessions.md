# Target Session Handling

How opfor delivers conversation context to an HTTP agent target across turns, and how it threads a
session id. This applies to `opfor run` (config file, wizard, SDK), the MCP server tool, and
`opfor hunt` — they share one model. Local-script and browser-extension targets are covered at the
end.

There are two independent decisions.

## 1. Stateless vs stateful — who holds the history

| `stateful`       | The target…                                                                   | opfor sends per turn                                                                                           |
| ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `false`          | has no memory (raw LLM APIs — OpenAI, Groq, Anthropic-compat, LiteLLM, vLLM). | the full `{role, content}` history as a chat-completions `messages` array. No session id; forces OpenAI shape. |
| `true` (default) | keeps conversation history server-side, keyed by a session id opfor passes.   | only the current turn's prompt + the session id.                                                               |

## 2. Client-owned vs server-owned — who mints the session id (stateful only)

| Mode             | Who mints the id | Turn 1                                                        | Examples                                                                       |
| ---------------- | ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **client-owned** | opfor            | opfor sends its id from turn 1                                | LangGraph `thread_id`, Rasa `sender_id`, most custom agents                    |
| **server-owned** | the target       | opfor sends **no** id, then echoes the one the target returns | OpenAI Responses `previous_response_id`, MCP `Mcp-Session-Id`, cookie sessions |

> **Which is my target?** Does it return a session id in its response (body field, header, or
> `Set-Cookie`)? → **server-owned**. Does it just expect you to supply an id it keys on? →
> **client-owned**. No session concept and it's a raw LLM API? → **stateless**.

## The `session` config

```jsonc
"session": {
  "send":    { "in": "body" | "header", "name": "…" },               // where opfor WRITES the id
  "receive": { "in": "body" | "header" | "set-cookie", "name": "…" } // where opfor READS a returned id
}
```

- **Presence of `receive` selects server-owned mode**; its absence is client-owned.
- `send` is always required when `session` is set, and `name` on it is required — a `receive` with
  no way to echo the id back is not a usable session.
- `send.in: "body"` → `name` is a dot-path in the request body; `"header"` → an HTTP header name.
- `receive.in`: `"body"` (dot-path) or `"header"` (name) both require a non-empty `name` — without
  one, capture always fails silently. `"set-cookie"` is the only receive location where `name` is
  optional (it captures the returned cookie pair, echoed back via a `Cookie` header — set `send` to
  `{ "in": "header", "name": "Cookie" }`).
- **Legacy alias:** `sessionIdField: "x"` is shorthand for `session: { send: { in: "body", name: "x" } }`
  (client-owned, body). Still honored; prefer `session` for new configs.

### Server-owned turn-1 flow

1. Turn 1 — the request goes out with **no** session id.
2. opfor reads the returned id via `receive` and remembers it.
3. Turns 2+ — that id is echoed via `send`.

If a server-owned target returns no id, opfor falls back to a client-minted id and logs a warning.

## Per-runner syntax

| Surface              | How to configure                                                                                                     | Details            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `opfor run` / config | `target.stateful` + `target.session` (or legacy `target.sessionIdField`)                                             | [cli.md](cli.md)   |
| SDK                  | `target.stateful` + `target.session` (or legacy `target.sessionField`)                                               | [sdk.md](sdk.md)   |
| MCP server tool      | `agent_session_send_in` / `_send_name` / `agent_session_receive_in` / `_receive_name`                                | [mcp.md](mcp.md)   |
| `opfor hunt`         | `--target-config <file>` (a run-style `target` block); or `--stateful` + `--session-field`; or the `--ui` setup form | [hunt.md](hunt.md) |

## Examples

```jsonc
// client-owned — opfor sends its id in a body field every turn
"session": { "send": { "in": "body", "name": "session_id" } }

// server-owned (body) — capture the returned id, echo it on later turns
"session": {
  "send":    { "in": "body", "name": "session_id" },
  "receive": { "in": "body", "name": "session_id" }
}

// server-owned (header, MCP-style)
"session": {
  "send":    { "in": "header", "name": "Mcp-Session-Id" },
  "receive": { "in": "header", "name": "Mcp-Session-Id" }
}
```

## Other target types

- **Local-script** (`target.type: "local-script"`): `sessionId` is always included in the stdin
  JSON on multi-turn attacks; your script owns the history. `session` / `stateful` do not apply.
- **Browser extension**: drives a live chat UI in the DOM — there is no session id to configure.

## Notes for `opfor hunt`

Hunt's operator invents a `threadId` per attack thread. For client-owned targets that `threadId` is
sent as the session id. For **server-owned** targets each thread captures the target's returned id
independently — and because a session belongs to the target, **forking a thread starts a new server
session** (opfor can't fork a session it doesn't own).
