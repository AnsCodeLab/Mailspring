# Issue #23 — Test Cases

Concrete scenarios mapped to acceptance criteria for Gemini CLI (`gemini-cli`) transport.

## Preferences / config

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-01 | Transport option present | Open Preferences → AI Assistant → Transport | Options include `OpenAI-compatible API`, `Claude CLI`, `Cursor CLI`, and **`Gemini CLI (local)`** (`value=gemini-cli`). |
| TC-02 | Path default | Select Gemini CLI with unset path | Path field defaults / placeholder `gemini`; `AIConfig.getGeminiCliPath()` → `gemini`. |
| TC-03 | Model optional | Leave model blank; reload models | Empty model means CLI default (no `-m` flag). Curated select lists `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`. |
| TC-04 | Gemini-specific copy | Select Gemini CLI | UI mentions `@google/gemini-cli`, Google sign-in / `GEMINI_API_KEY` / Vertex, Antigravity caveat, and that agent skills are unavailable (chat + composer assist only). |

## Security / spawn boundary

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-05 | Plan + skip-trust + no extensions | Inspect `baseArgs('json'\|'stream-json')` | Always includes `-p` (short `GEMINI_PROMPT_INSTRUCTION`), `--approval-mode plan`, `--skip-trust`, `-e none`, `--output-format`. Transcript is **not** embedded in argv. |
| TC-06 | Negative safety | Inspect `baseArgs` | Never includes `-y`, `--yolo`, `auto_edit`, or `--force`. Approval mode value is exactly `plan`. |
| TC-07 | Secure workdir settings | Call `prepareWorkdir()` / `workspaceSettings()` | `cwd` is under `os.tmpdir()`; `.gemini/settings.json` has `security.disableYoloMode: true` and `tools.exclude` includes `run_shell_command`, `write_file`, `replace`, `exit_plan_mode`. `spawnOptions(cwd).windowsHide === true`. |
| TC-08 | Stdin + short `-p` contract | Inspect spawn path | `baseArgs` uses short instruction for `-p`; `spawnCli` writes full `buildTranscript().prompt` to stdin. |

## Chat / streaming

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-09 | Transcript folding | `buildTranscript` with system + user + assistant + tool | Prompt includes `System:\n…`, `Human:`, `Assistant:`, `Tool result:` (no separate `--system-prompt`). |
| TC-10 | NDJSON delta-only | `parseStreamLine` fixtures | Yields only `type=message`, `role=assistant`, `delta:true` content; ignores non-delta assistant, init, tool events, user messages, `severity:warning`. |
| TC-11 | Stream fatal errors | `parseStreamLine` on severity/result error | Throws via `resultError` for `severity:error` and `result.status=error`. |
| TC-12 | JSON response | `parseJsonResponse` | Returns `response` string; surfaces `error.message` through `resultError`. |

## Errors / models / skills

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-13 | Auth rewrite | `resultError('Not logged in…')` / API key | Message mentions sign-in and `GEMINI_API_KEY`. |
| TC-14 | Antigravity rewrite | `resultError('IneligibleTier… Antigravity')` | Message mentions Antigravity / Code Assist and alternate auth (`GEMINI_API_KEY` / Vertex). |
| TC-15 | Missing binary | `notFoundError()` with custom path | Mentions configured path and Preferences → AI Assistant. |
| TC-16 | Curated models | `GeminiCliService.listModels()` | Returns static curated IDs; no process spawn / network. |
| TC-17 | Skills disabled | Provider=`gemini-cli` | `isCliProvider()` true; chat-panel uses skills gate `!isCliProvider()`; badge shows Gemini CLI model/default. |

## Composer / next-line audit

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TC-18 | Composer assist | Inspect `composer-assist.tsx` | Calls `AIService.chat` only — inherits `gemini-cli` via `cliChatService()`; **no file edit required**. |
| TC-19 | Next-line | Inspect `next-line.ts` | Calls `AIService.chat` only — inherits provider; **no file edit required**. |

## Automated coverage

- `app/internal_packages/ai-assistant/specs/gemini-cli-service-spec.ts`
- `app/internal_packages/ai-assistant/specs/config-spec.ts` (Gemini path/model defaults)
