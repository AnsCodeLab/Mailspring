# Issue #21: Add Cursor CLI as AI Assistant chat provider — Plan

## Problem

AI Assistant currently supports two chat transports:

1. **OpenAI-compatible API** (`provider = api`) — HTTP `/v1/chat/completions`, full agent skills / tool calling.
2. **Claude CLI** (`provider = claude-cli`) — spawns local `claude` with `-p` + stream-json; subscription login; **no** Mailspring skills.

Users who already pay for Cursor have a local Agent CLI (`agent` / `cursor agent`) with the same non-interactive shape (`-p`, `--output-format stream-json`, `--stream-partial-output`, `--model`, `--list-models`, `agent login`), but Mailspring cannot use it yet. They must configure a separate API key for chat / composer assist.

## Scope

Add a third provider, **`cursor-cli`**, mirroring the Claude CLI integration pattern — chat + composer assist only; skills remain API-only.

Explicitly **not** in scope:

- Wiring Cursor MCP / plugins / workspace tools into Mailspring.
- Exposing Mailspring agent skills through Cursor CLI.
- Treating Cursor as an OpenAI-compatible HTTP endpoint.
- Changing RAG / embeddings / knowledge-base backends.

## Approach

### 1. New service: `cursor-cli-service.ts`

Mirror `claude-cli-service.ts` closely enough that reviewers can diff them.

| Concern | Claude CLI | Cursor CLI |
|---|---|---|
| Binary default | `claude` | `agent` |
| Print / non-interactive | `-p` | `-p` / `--print` |
| Output | `--output-format json\|stream-json` | same |
| Streaming extras | `--include-partial-messages --verbose` | `--stream-partial-output` (with stream-json) |
| Tool lockdown | `--tools '' --safe-mode ...` | **`--mode ask`** (read-only Q&A) + **`--trust`** (non-interactive workspace trust) |
| System prompt | `--system-prompt` | **none** — prepend system block into the prompt body |
| cwd | `os.tmpdir()` | `os.tmpdir()` |
| Model list | OAuth → Anthropic `/v1/models` | parse `agent --list-models` text (`id - Label` lines) |
| Auth rewrite | `/login` → `claude` sign-in | `agent login` / Cursor login messaging |

**Transcript:** reuse the same Human/Assistant/Tool labeling. Because Cursor has no `--system-prompt`, `buildTranscript` should return a single `prompt` string: optional leading `System:\n…` (joined system messages) then conversation turns. Export the same helpers Claude exports (`buildTranscript`, `baseArgs`, `resultError`) for unit tests.

**`baseArgs` must always include** (security boundary — pin with tests):

- `-p`
- `--mode`, `ask`
- `--trust`
- `--output-format`, `json` | `stream-json`
- for stream-json only: `--stream-partial-output`
- `--model <id>` only when `AIConfig.getCursorCliModel()` is non-empty

**Never** pass `-f`, `--force`, `--yolo`, `--sandbox disabled`, or omit `--mode ask`.

**Stream parser** (probed against Cursor Agent CLI ask+stream-json+stream-partial-output):

1. NDJSON lines on stdout.
2. Yield text from `type === 'assistant'` events **that include `timestamp_ms`** (partial deltas under `message.content[].text`).
3. Ignore `assistant` events **without** `timestamp_ms` (final full duplicate).
4. Ignore `thinking` / `system` / `user` events.
5. On `type === 'result'` with `is_error === true`, throw via `resultError(result)`.
6. Non-stream `json` mode: parse the single result object’s `result` string (Cursor’s `--output-format json` returns one result event).

**Spawn:** `spawn(bin, args, { cwd: os.tmpdir(), windowsHide: true })`, write prompt to stdin, honor `AbortSignal` by killing the child — same shape as Claude.

### 2. Config (`config.ts` + defaults tests)

- Keys: `ai-assistant.cursorCli.path`, `ai-assistant.cursorCli.model`
- Widen `getProvider()` to `'api' | 'claude-cli' | 'cursor-cli'`
- Getters: `getCursorCliPath()` default `'agent'`, `getCursorCliModel()` default `''`
- Extend `config-spec.ts` accordingly

### 3. Routing (`ai-service.ts`)

Generalize the existing `claude-cli` branches so both CLI providers share the “no tools” guard and stream/list/test dispatch:

- `chatStream` / `chatWithTools` / `chatCompletion`-style tool paths: if provider is `claude-cli` **or** `cursor-cli` and tools were requested → same `AIError` pointing users at OpenAI-compatible API (message should name the active CLI or stay generic: “CLI mode does not support agent skills…”).
- Otherwise dispatch to `ClaudeCliService` or `CursorCliService`.
- `listModels` / `testConnection` likewise.

Prefer a small helper `isCliProvider()` over copy-pasting three `=== 'claude-cli'` checks into six — keeps future CLI providers cheap. Keep error copy accurate for both.

### 4. Preferences UI (`preferences.tsx`)

- Transport `<select>`: add `<option value="cursor-cli">Cursor CLI (subscription, local)</option>`.
- When selected: path input, model select/input + reload button, note that skills are unavailable (same tone as Claude block).
- Fetch models via existing `_fetchModels` path once `AIService.listModels` routes correctly.
- Chat panel model label (`chat-panel.tsx` ~1129): show Cursor CLI model / “Cursor CLI (default)” when provider is `cursor-cli`.
- Skills gate (`chat-panel.tsx` ~843): treat `cursor-cli` like `claude-cli` (`!== 'claude-cli'` becomes “not a CLI provider”).

### 5. Tests (TDD)

New `specs/cursor-cli-service-spec.ts` patterned on `claude-cli-service-spec.ts`:

- `buildTranscript` folds system into prompt; labels turns.
- `baseArgs` always includes `-p`, `--mode ask`, `--trust`; never force/yolo; streaming flag only for stream-json; model only when set.
- `parseAssistantDelta` / exported stream-line helper (extract pure parse function so we don’t need to spawn): timestamped assistant → text; non-timestamped → null; result error → error.
- `resultError` rewrites not-logged-in / authentication messaging to mention `agent login`.

Update `config-spec.ts` for path/model defaults and provider type.

Optional light unit coverage of `isCliProvider` / routing if easy without heavy AIService mocks; not required if Claude has none.

### 6. Docs / evidence

This plan, then `test-cases.md` + `test-results.md` after implementation (workflow skill).

## Files touched

| File | Change |
|---|---|
| `app/internal_packages/ai-assistant/lib/cursor-cli-service.ts` | **new** — spawn/stream/list/test |
| `app/internal_packages/ai-assistant/specs/cursor-cli-service-spec.ts` | **new** — TDD specs |
| `app/internal_packages/ai-assistant/lib/config.ts` | keys + getters; widen provider union |
| `app/internal_packages/ai-assistant/specs/config-spec.ts` | defaults |
| `app/internal_packages/ai-assistant/lib/ai-service.ts` | route cursor-cli; shared CLI guard |
| `app/internal_packages/ai-assistant/lib/preferences.tsx` | transport option + settings block |
| `app/internal_packages/ai-assistant/lib/chat-panel.tsx` | skills gate + model label |
| `docs/issues/21/plan.md` | this plan |
| `docs/issues/21/test-cases.md` / `test-results.md` | post-impl |

## Open questions / decisions locked here

1. **Binary name:** default `agent` (what `which agent` resolves to after Cursor Agent install). Path field lets users set `cursor` only if their install wraps that way — but `cursor` alone is the IDE launcher and errors; document placeholder `agent`.
2. **`--trust`:** required for non-interactive runs when workspace trust would otherwise block; safe because cwd is tmp and mode is ask.
3. **No shared abstract `CliService` base class** in this PR — duplication with Claude is intentional and reviewable; extract later if a third CLI appears.
4. **Provider-specific skill error strings:** use a shared “CLI mode does not support…” message that names switching to OpenAI-compatible API (avoid maintaining three near-identical strings).

## Acceptance mapping

| Criterion | Covered by |
|---|---|
| Transport option in Preferences | preferences.tsx |
| Path + model + skills note | preferences.tsx |
| Chat/composer stream via agent when logged in | cursor-cli-service + ai-service |
| `--mode ask`, `--trust`, tmp cwd | baseArgs + spawn tests / code |
| Actionable missing-bin / auth errors | resultError + notFoundError |
| Unit specs | cursor-cli-service-spec + config-spec |
| Skills disabled in CLI mode | ai-service + chat-panel |

## Implementation order

1. Failing specs (cursor-cli-service-spec + config defaults).
2. `cursor-cli-service.ts` until green.
3. config → ai-service → preferences → chat-panel.
4. Run package specs / lint; write test-cases + test-results.
