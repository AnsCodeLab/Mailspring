# Plan: Antigravity CLI AI provider (#26)

**Date:** 2026-09-20  
**Status:** Approved after plan review (edits applied below)  
**Issue:** https://github.com/AnsCodeLab/Mailspring/issues/26  
**Related:** #23 Gemini CLI (keep); https://antigravity.google/docs/getting-started

## Goal

Add **Antigravity CLI** (`agy`) as the **primary Google CLI** chat transport in Preferences (listed above Gemini CLI). Keep Gemini CLI for `GEMINI_API_KEY` / Vertex / Code Assist Standard+Enterprise. **Do not** change the default provider (`api`).

## Why not only Gemini CLI?

Since **2026-06-18**, free / Google One / Code Assist *individuals* Google login for Gemini CLI was replaced by Antigravity ([FAQ](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)). Local probe: `gemini` headless without API key fails auth; `agy -p … --mode plan --output-format json|stream-json` succeeds when logged in.

## Architecture

Mirror `gemini-cli-service.ts` → new `antigravity-cli-service.ts` + specs; wire config / AIService / preferences / chat-panel badge.

| Piece | Choice |
|---|---|
| Provider id | `antigravity-cli` |
| Binary default | `agy` (`ai-assistant.antigravityCli.path`) |
| Model | optional `ai-assistant.antigravityCli.model` → `--model <id>` when set; `listModels` prefers `agy models` parse, curated fallback if empty |
| Headless | `-p` / `--print` with short **text-only instruction** as first arg segment, full transcript appended in the same `-p` string when under size limit |
| Formats | `--output-format json` (chat/test) and `stream-json` (chatStream) |
| Safety | always `--mode plan`; always `--sandbox`; always `--disable-slash-commands`; **never** `--dangerously-skip-permissions`. Do **not** inherit Gemini-only flags (`--approval-mode`, `--skip-trust`, `-e none`). |
| cwd | dedicated `os.tmpdir()` workdir (`mailspring-agy-…`), cleaned up on close (pin in spawn tests) |
| Skills | `isCliProvider()` includes `antigravity-cli` so **Mailspring agent skills stay disabled** (same as other CLIs). Antigravity tools/MCP are out of scope — never enable Mailspring skills through `agy`. |

### Prompt delivery (pinned)

1. Build transcript like Cursor/Gemini (fold `System:` + labeled turns).
2. Prepend a fixed instruction: respond in plain text only; do not call tools.
3. Single argv: `-p <instruction + "\n\n" + transcript>` when `Buffer.byteLength(prompt, 'utf8') < 80_000`.
4. If larger: **fail clearly** with a user-facing error (no silent truncate, no agent file-read overflow). Live probe showed plan+sandbox soft-denies `run_command`; do not rely on tools to load a temp file.
5. Do **not** use `--input-format stream-json` for v1.

### Stream / JSON parsing (pinned)

Antigravity NDJSON ([headless docs](https://antigravity.google/docs/cli/headless)):

- `event: init` → ignore
- `event: step_update` + `step_type: agent_response`:
  - Yield `text_delta` on **ACTIVE**
  - On **DONE**: yield `text_delta` **only if** no ACTIVE delta was seen for that `step_index` (avoids duplicate full-text DONE)
- `event: step_update` + `step_type: tool` → ignore (do not surface soft-denies as chat text)
- `event: result` + `status: SUCCESS` → finish; **never** re-yield `response` if any deltas were already yielded
- `event: result` + non-SUCCESS → `resultError(result.error)`
- Malformed NDJSON lines → **skip**; if the process closes with no SUCCESS result and no yielded text → error from stderr / exit code
- Unknown events → ignore

JSON mode: require `status === 'SUCCESS'` and return `response` (may be empty string only if that is the model output); else `resultError(error)`. If SUCCESS but empty and stderr mentions denied_actions / permission, still return response (soft-deny is not a hard failure) unless `error` field is set.

### Auth error rewrite (pinned)

Match only:

- `/authentication required/i`
- `/not logged in/i`
- `/please (log|sign) in/i`
- `/FatalAuthenticationError/i`

→ “Antigravity CLI is not authenticated. Open a terminal, run `agy`, complete sign-in, then try again. Install guide: https://antigravity.google/docs/getting-started”

Do **not** match bare `/login/i`. Negative fixtures required.

Missing binary → install URL + Preferences path.

### Preferences / chat-panel

- New option **Antigravity CLI (local)** **above** Gemini CLI.
- Help text + getting-started link.
- Update Gemini CLI blurb: free Google login → Antigravity; Gemini remains for API key / Vertex / Standard+Enterprise.
- Chat-panel: model badge branch for `antigravity-cli` (configured model or “Antigravity CLI (default)”).
- Default provider stays `api`.

### Composer / next-line

Audit only via `AIService` inheritance. Record in `test-results.md`. No edits unless a provider gate is found.

## Files touched

- `lib/antigravity-cli-service.ts` (new)
- `specs/antigravity-cli-service-spec.ts` (new)
- `lib/config.ts`, `specs/config-spec.ts`
- `lib/ai-service.ts` (`isCliProvider`, `cliChatService` four-way; **no fallthrough**)
- `lib/preferences.tsx` (option + block + Gemini copy)
- `lib/chat-panel.tsx` (model badge only)
- `docs/issues/26/plan.md`, `test-cases.md`, `test-results.md`

## TDD

1. `baseArgs`: plan + sandbox + disable-slash-commands + output-format; never dangerously-skip-permissions; model omitted vs present.
2. Spawn stub: `cwd` under `os.tmpdir()`; cleanup on close.
3. Prompt: `<80KB` embeds full transcript in `-p`; `≥80KB` throws clear error.
4. Stream fixtures: init ignore; ACTIVE delta yield; DONE duplicate-guard; tool ignore; result ERROR; SUCCESS no re-yield; malformed line skip.
5. JSON SUCCESS/ERROR.
6. `resultError` / `notFoundError` positive + negative auth fixtures.
7. `buildTranscript`.
8. Config defaults + `isCliProvider` / routing expectations (config-spec / service export).
9. Gemini CLI files unchanged except prefs copy.

## Acceptance mapping

| Criterion | Covered by |
|---|---|
| Transport option + getting-started link | preferences |
| Chat/composer via service | AIService + composer audit note |
| Security flags + tmp cwd | baseArgs + spawn specs |
| Large prompt fail-closed | size-guard spec |
| Auth/not-found rewrite | resultError/notFoundError specs |
| Skills gated off | `isCliProvider` |
| Gemini copy updated | preferences |
| Stream no-dupe | ACTIVE/DONE fixtures |

## Out of scope

- Removing Gemini CLI / flipping default provider to Antigravity
- Bundling `agy`
- Skills/MCP via Antigravity tools
- Antigravity IDE GUI
- `--input-format stream-json` multi-turn sessions

## Plan review verdict

**REQUEST_CHANGES → addressed:** pinned fail-closed large prompts (no tool file-read); ACTIVE/DONE duplicate-guard; tightened auth regex; clarified skills = Mailspring skills off; primary = prefs ordering not default flip; expanded TDD; scoped chat-panel to model badge; skip malformed NDJSON.
