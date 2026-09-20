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
| Soft read-only | `--approval-mode plan` (NOT equivalent to Cursor `--mode ask`) |
| Trust | `--skip-trust` |
| Disable extensions | `-e none` |
| Model | `-m` / `--model` |
| cwd | **dedicated temp workdir** with workspace `.gemini/settings.json` (not bare `os.tmpdir()` root) |

**Must never** pass `-y`, `--yolo`, or `--approval-mode yolo|auto_edit`.

### Residual security risk (documented)

Upstream Plan Mode is read-mostly, but in **non-interactive** mode `exit_plan_mode` can **begin implementation** (effectively YOLO) after the model “approves” its own plan. Negative argv tests alone are insufficient.

**Hardening (required in this PR):**

1. Always `--approval-mode plan`, `--skip-trust`, `-e none`.
2. Per-call (or reused) temp workdir as `cwd` containing `.gemini/settings.json`:
   - `security.disableYoloMode: true`
   - `tools.exclude` includes at least: `run_shell_command`, `write_file`, `replace`, `exit_plan_mode` (and other write/shell tools as listed in Gemini tools docs). Prefer also setting `tools.core` to an empty allowlist **if** empty-array semantics disable discovery (verify against docs; if empty means “default all”, rely on exclude list).
3. Prompt prefix instruction: respond in plain text only; do not call tools / exit plan mode.
4. Prompt delivery: **`baseArgs(outputFormat)` does not embed the transcript**; spawn always passes a short `-p` instruction string and writes the full transcript on **stdin** (avoids ARG_MAX; matches “stdin appended to -p”).
5. Evidence note: unit tests pin argv/settings/cwd; full escalation cannot be proven in Jasmine alone.

**Stream-json schema** (from upstream `packages/core/src/output/types.ts`):

- `message` with `role: "assistant"`, `content: string`, `delta?: true` → **yield only when `delta === true`**; ignore non-delta assistant messages (final/full duplicates)
- ignore `init`, `tool_use`, `tool_result`, user messages
- `error` with `severity: "warning"` → ignore; `severity: "error"` → throw
- `result` with `status: "error"` → throw via `resultError`; success → ignore (text already streamed)
- json mode: parse object `response` string; surface `error.message`

**Auth caveat:** free Google Code Assist OAuth may error (Antigravity migration). Still viable via `GEMINI_API_KEY`, Vertex, or working Google login. Error rewriter must mention those paths.

**No `--list-models`:** **Pin** `listModels()` to a curated static list (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`). Preferences copy must be Gemini-specific (install `@google/gemini-cli`, `gemini` login / `GEMINI_API_KEY`), not Claude/Cursor login text.

## Scope

Add provider **`gemini-cli`**. Chat + composer assist only. Skills remain API-only via existing `isCliProvider()`.

Out of scope: MCP/tools, bundling the npm package, Antigravity product UX beyond errors, changing the HTTP Gemini preset.

## Approach

### 1. `gemini-cli-service.ts` (mirror `cursor-cli-service.ts`)

Exports for tests: `buildTranscript`, `baseArgs`, `spawnOptions`, `parseStreamLine`, `parseJsonResponse`, `resultError`, `notFoundError`, `GeminiCliService`.

**`buildTranscript`:** identical Cursor folding (System block + Human/Assistant/Tool turns) → `{ prompt }`.

**`baseArgs(outputFormat)` always includes:**

- `-p`, short fixed instruction (`Respond in plain text only. Do not call any tools.`)
- `--approval-mode`, `plan`
- `--skip-trust`
- `-e`, `none`
- `--output-format`, `json` | `stream-json`
- `-m`, model when configured

**Spawn:** write full `buildTranscript().prompt` to **stdin**; `cwd` = prepared secure workdir (see hardening); `windowsHide: true`.

**Negative safety tests:** never `-y`/`--yolo`; `--approval-mode` value must be exactly `plan`; must include `-e none` and `--skip-trust`.

**`spawnOptions` / `prepareWorkdir()`:** create/reuse temp dir with `.gemini/settings.json` as above; assert cwd is under `os.tmpdir()` and settings file contents in unit tests.

**`parseStreamLine`:** yield assistant delta content; throw on fatal error/result.

**`listModels`:** return curated static IDs (e.g. `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`) — no network. Document in preferences placeholder.

**`testConnection` / `chat`:** tiny prompt via json format; read `response`.

### 2. Config

- Keys: `ai-assistant.geminiCli.path`, `ai-assistant.geminiCli.model`
- `getProvider` union adds `'gemini-cli'`
- `getGeminiCliPath()` default `'gemini'`, `getGeminiCliModel()` default `''`
- `isCliProvider()` includes `gemini-cli`
- `cliChatService()` is an **explicit three-way** switch (`gemini-cli` → `GeminiCliService`, `cursor-cli` → `CursorCliService`, else `ClaudeCliService`) — no accidental fallthrough

### 3. Preferences + chat-panel

- Transport option **Gemini CLI (local)**
- Path + model fields + skills-unavailable note with **Gemini-specific** auth/install copy
- **Required** chat-panel model badge branch for `gemini-cli` (current code is Claude/Cursor-only)
- Skills gate: confirm `isCliProvider()` covers gemini; fix leftovers

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
| Path/model + Gemini auth copy | preferences |
| Chat/composer via gemini | service + AIService + composer/next-line audit checklist in test-results |
| plan + skip-trust + `-e none` + secure workdir settings | baseArgs + prepareWorkdir specs |
| stdin + short `-p` contract | spawn/baseArgs specs |
| Auth / Antigravity / API-key rewrite | resultError specs |
| Actionable missing binary | notFoundError |
| Curated models list | listModels + prefs |
| Unit specs | gemini-cli-service-spec + config-spec |
| Skills disabled | isCliProvider + chat-panel badge |

## Plan review

**Verdict:** REQUEST_CHANGES → addressed in this revision (Plan Mode residual YOLO risk, stdin prompt contract, stream warning/non-delta rules, curated listModels, explicit three-way dispatch, acceptance mapping).
