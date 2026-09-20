# Issue #23: Add Gemini CLI as AI Assistant chat provider — Plan

## Problem

AI Assistant on `origin/master` supports:

1. **OpenAI-compatible API** (`api`) — full skills / tool calling
2. **Claude CLI** (`claude-cli`) — local `claude`, no skills
3. **Cursor CLI** (`cursor-cli`) — local `agent`, no skills

Users with Gemini CLI (`@google/gemini-cli`, binary `gemini`) cannot use that login/key for Mailspring chat; they must configure a separate HTTP endpoint (already available as a Gemini OpenAI-compatible preset under `api`).

## Feasibility (locked)

Gemini CLI **can** be integrated the same way as Cursor/Claude:

| Concern | Gemini CLI |
|---|---|
| Headless | `-p` / `--prompt` |
| Formats | `-o` / `--output-format` `json` \| `stream-json` |
| Read-only | `--approval-mode plan` |
| Trust | `--skip-trust` |
| Model | `-m` / `--model` |
| cwd | `os.tmpdir()` |

**Must never** pass `-y`, `--yolo`, or `--approval-mode yolo|auto_edit`.

**Stream-json schema** (from upstream `packages/core/src/output/types.ts`):

- `message` with `role: "assistant"`, `content: string`, `delta?: true` → yield content when `delta === true`
- ignore `init`, `tool_use`, `tool_result`, user messages
- `error` with `severity: "error"` → throw
- `result` with `status: "error"` → throw via `resultError`
- json mode: parse object `response` string; surface `error.message`

**Auth caveat:** free Google Code Assist OAuth may error (Antigravity migration). Still viable via `GEMINI_API_KEY`, Vertex, or working Google login. Error rewriter must mention those paths.

**No `--list-models`:** Preferences uses free-text model field + optional curated suggestions (same fallback Claude uses when OAuth list fails). `listModels()` may return a small static curated list or `[]`.

## Scope

Add provider **`gemini-cli`**. Chat + composer assist only. Skills remain API-only via existing `isCliProvider()`.

Out of scope: MCP/tools, bundling the npm package, Antigravity product UX beyond errors, changing the HTTP Gemini preset.

## Approach

### 1. `gemini-cli-service.ts` (mirror `cursor-cli-service.ts`)

Exports for tests: `buildTranscript`, `baseArgs`, `spawnOptions`, `parseStreamLine`, `parseJsonResponse`, `resultError`, `notFoundError`, `GeminiCliService`.

**`buildTranscript`:** identical Cursor folding (System block + Human/Assistant/Tool turns) → `{ prompt }`.

**`baseArgs(outputFormat)` always:**

- `-p`, `<prompt will be supplied at spawn — see below>`
- `--approval-mode`, `plan`
- `--skip-trust`
- `--output-format`, `json` | `stream-json`
- `-m`, model when `AIConfig.getGeminiCliModel()` non-empty

Because `-p` is a valued string flag, spawn will pass the prompt as the argument to `-p` (official headless pattern). Keep `baseArgs(prompt, outputFormat)` or `baseArgs(outputFormat)` + `spawnCli` inserting `-p`, prompt — pick one and pin in tests.

**Negative safety tests:** never `-y`, `--yolo`, never `--approval-mode` other than `plan`.

**`spawnOptions`:** `{ cwd: os.tmpdir(), windowsHide: true }` — unit-tested.

**`parseStreamLine`:** yield assistant delta content; throw on fatal error/result.

**`listModels`:** return curated static IDs (e.g. `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`) — no network. Document in preferences placeholder.

**`testConnection` / `chat`:** tiny prompt via json format; read `response`.

### 2. Config

- Keys: `ai-assistant.geminiCli.path`, `ai-assistant.geminiCli.model`
- `getProvider` union adds `'gemini-cli'`
- `getGeminiCliPath()` default `'gemini'`, `getGeminiCliModel()` default `''`
- `isCliProvider()` includes `gemini-cli`
- `cliChatService()` dispatches to `GeminiCliService`

### 3. Preferences + chat-panel

- Transport option **Gemini CLI (local)**
- Path + model fields + skills-unavailable note (mirror Cursor block)
- Model label when provider is gemini-cli
- Skills gate already uses `isCliProvider()` — verify; fix only if a leftover `=== 'claude-cli'` remains

### 4. Composer / next-line

Audit only — inherit via AIService (same as #21).

### 5. Tests (TDD)

`specs/gemini-cli-service-spec.ts` + `config-spec.ts` updates:

- transcript folding
- baseArgs safety + negatives
- spawnOptions cwd
- NDJSON fixtures: assistant delta; ignore init/tool; error/result failure
- json `response` parse
- resultError rewrites auth / IneligibleTier / API key messaging
- notFoundError mentions path + Preferences

### 6. Evidence

`docs/issues/23/plan.md`, then `test-cases.md` + `test-results.md`.

## Files

| File | Change |
|---|---|
| `lib/gemini-cli-service.ts` | **new** |
| `specs/gemini-cli-service-spec.ts` | **new** |
| `lib/config.ts` | keys + getters + union |
| `specs/config-spec.ts` | defaults |
| `lib/ai-service.ts` | `isCliProvider` + `cliChatService` |
| `lib/preferences.tsx` | transport UI |
| `lib/chat-panel.tsx` | model label if needed |
| `docs/issues/23/*` | plan + evidence |

## Implementation order

1. Failing specs
2. `gemini-cli-service.ts`
3. config → ai-service → preferences → chat-panel audit
4. Focused Jasmine; evidence docs

## Acceptance mapping

| Criterion | Coverage |
|---|---|
| Transport option | preferences |
| Path/model + skills note | preferences |
| Chat/composer via gemini | service + AIService (+ audit) |
| plan + skip-trust + tmp cwd | baseArgs + spawnOptions specs |
| Actionable errors | resultError / notFoundError |
| Unit specs | gemini-cli-service-spec + config-spec |
| Skills disabled | isCliProvider |
