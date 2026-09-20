# Issue #21 — Test Cases

Concrete scenarios mapped to acceptance criteria for Cursor CLI (`cursor-cli`) transport.

## Preferences / config

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-01 | Transport option present | Open Preferences → AI Assistant → Transport | Options include `OpenAI-compatible API`, `Claude CLI (subscription, local)`, and **`Cursor CLI (subscription, local)`** (`value=cursor-cli`). |
| TC-02 | Path default | Select Cursor CLI with unset path | Path field defaults / placeholder `agent`; `AIConfig.getCursorCliPath()` → `agent`. |
| TC-03 | Model optional | Leave model blank; reload models | Empty model means CLI default (no `--model` flag). Free-text / select still works when models load. |
| TC-04 | Skills note | Select Cursor CLI | UI notes that agent skills are unavailable; chat + composer assist only. |

## Security / spawn boundary

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-05 | Ask + trust always | Inspect `baseArgs('json'\|'stream-json')` | Always includes `-p`, `--mode ask`, `--trust`, `--output-format`. |
| TC-06 | Stream flag | Compare json vs stream-json args | `--stream-partial-output` only for `stream-json`. |
| TC-07 | Negative safety | Inspect `baseArgs` | Never includes `-f`, `--force`, `--yolo`, or `--sandbox disabled`. |
| TC-08 | Temp cwd | Inspect `spawnOptions()` | `cwd === os.tmpdir()`, `windowsHide === true`. |

## Chat / streaming

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-09 | Transcript folding | `buildTranscript` with system + user + assistant | Prompt starts with `System:\n…` then labeled Human/Assistant turns (no separate `--system-prompt`). |
| TC-10 | Partial NDJSON | Feed timestamped `assistant` fixture to `parseStreamLine` | Yields text from `message.content[].text`. |
| TC-11 | Final duplicate | Feed non-timestamped `assistant` fixture | Returns `null` (ignored). |
| TC-12 | Ignore noise | Feed `thinking` / `system` fixtures | Returns `null`. |
| TC-13 | Result error | Feed `result` with `is_error: true` | Throws; auth/not-logged-in rewrite mentions `agent login`. |
| TC-14 | Missing binary | ENOENT / `notFoundError()` | Message includes configured path and `Preferences > AI Assistant`. |

## Routing / skills gate

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-15 | AIService CLI route | Provider `cursor-cli`; `chat` / `chatStream` / `listModels` / `testConnection` | Dispatches to `CursorCliService` (via `isCliProvider`). |
| TC-16 | No tools in CLI | Provider `cursor-cli`; call `chatWithTools` / stream-with-tools | `AIError` with shared “CLI mode does not support agent skills…” copy pointing at OpenAI-compatible API. |
| TC-17 | Chat panel skills gate | Provider `cursor-cli` with skills registered | Agent/skills path skipped (`!isCliProvider()`); plain chat stream used. |
| TC-18 | Model badge | Provider `cursor-cli` | Shows configured Cursor model or `Cursor CLI (default)`. |

## Composer / next-line inheritance

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-19 | Composer assist | Provider `cursor-cli`; use composer assist | Goes through `AIService.chat` only — no `claude-cli`-only branch; inherits Cursor routing. |
| TC-20 | Next-line | Provider `cursor-cli`; next-line suggestion | Same as TC-19 via `AIService.chat`. |

## Config defaults (unit)

| ID | Scenario | Expected |
|---|---|---|
| TC-21 | Defaults | Provider `api`; Cursor path `agent`; Cursor model `''`. |
