# Ask B's — AI assistant

## What it is

A plain-language assistant inside The Rail (the **Ask** tab, and **Ledger › Ask B's**). It answers questions like:
- "How many Everything do I bake today?"
- "¿Qué lleva un Rise & Grind?"
- "Compare Saturday bagels this October with last October."
- "How accurate was the forecast in September?"

It answers by **calling tools that read the shop's own records and run exact calculations**. It does not use its own memory of numbers.

## How it works

```
browser ──POST /api/ask (history)──▶ server ──Messages API (tools filtered by role)──▶ Claude
                                        ▲                                   │ tool_use
                                        └──── runs tool against SQLite ◀────┘
                                   answer + sources ──▶ browser (shows "Sources & steps")
```

- **Server-side only.** The API key is read from the `ANTHROPIC_API_KEY` environment variable and never reaches the browser.
- **Permissions:**
  - Each tool declares a minimum role.
  - Tools above the user's role are **not offered** to the model.
  - If one is requested anyway, the server refuses it with a `PERMISSION` error. For example, crew can never get sales dollars.
- **Tools are read-only and deterministic:**
  - `get_day_plan`, `get_bagel_history`, `compare_periods`, `get_item_sales` (lead+), `get_sales` (manager+), `get_forecast_accuracy` (manager+);
  - `get_recipe`, `get_assumptions`, `get_inventory`, `get_handoffs`, `get_data_coverage`;
  - `calculate`: a safe arithmetic evaluator, used for every sum and ratio.
- **Answers carry sources.** Each tool call (name, inputs, record references) is returned, and the UI shows it under the answer.
- **Rules in the system prompt:**
  - Every figure comes from a tool result.
  - Label each figure verified, forecast, assumption or missing.
  - Missing is not zero.
  - Never add sandwiches to bagel counts.
- **Follow-ups:** the browser keeps the conversation for the session and sends it back each turn (last 20 turns). The server re-checks the role every turn.
- **Audit:** each question is logged (question text and tools used).

## Configuration

| Setting | How |
|---|---|
| Enable | Set `ANTHROPIC_API_KEY` in the server environment (systemd `Environment=`, a Docker `-e` flag, or a secrets manager). **Never put it in the repo or the web app.** |
| Model | `ANTHROPIC_MODEL`, default `claude-opus-5-5` |
| Request settings | Adaptive thinking, effort `medium`, up to 8 tool rounds, and server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). If a request is declined by a safety classifier, the API retries it on a fallback model inside the same call. Remove these two fields in `server/assistant/loop.ts` if you prefer not to use the beta. |
| Disable | Unset the key. The Ask tab then explains that the assistant is not configured. Nothing else changes. |

**Cost control:** each question is typically 2–4 model calls. Monitor usage in the Anthropic Console, and lower effort or switch models with `ANTHROPIC_MODEL` if needed.

## Why not a hosted agent

Anthropic's Managed Agents would host the loop and a sandbox. Here the tools must run against the shop's local database with the signed-in user's role, and confidential sales data should not persist in a remote session history. So the loop runs inside our server on the Messages API (decision D11).

## Testing

`tests/api.test.ts` drives the loop with a scripted model client. It verifies:
- tool execution and the source list;
- both results returned in one message;
- a crew permission refusal;
- the default model;
- audit logging.

It was **not** tested against the live API in this environment, because no API key was available. Run a quick live check after setting the key: ask "What is today's bake plan?" and confirm the sources list `get_day_plan`.
