# Issue #21 — Test Results

## Summary

Implemented `cursor-cli` transport per `docs/issues/21/plan.md`. Full Electron `npm test` suite was **not** run (orchestrator will verify). Focused in-process smoke of pure helpers + static audits performed.

## In-process verification (2026-09-20)

Transpiled `config.ts` + `cursor-cli-service.ts` with TypeScript `transpileModule` and ran 22 assertions against exported helpers (no Electron):

| Area | Result |
|---|---|
| `buildTranscript` folds system into prompt | PASS |
| `baseArgs` includes `-p`, `--mode ask`, `--trust` | PASS |
| `--stream-partial-output` only for stream-json | PASS |
| Negative args: no `-f` / `--force` / `--yolo` / `--sandbox disabled` | PASS |
| `spawnOptions().cwd === os.tmpdir()`, `windowsHide` | PASS |
| NDJSON: timestamped assistant → text; final/thinking/system → null | PASS |
| `result` `is_error` → rewrite mentions `agent login` | PASS |
| Auth-style `resultError` → `agent login` | PASS |
| `notFoundError` mentions path + Preferences → AI Assistant | PASS |
| Config defaults: path `agent`, model `''`, provider `api` | PASS |

**Smoke result:** 22/22 passed.

Specs added (to be executed by orchestrator / package Jasmine):

- `app/internal_packages/ai-assistant/specs/cursor-cli-service-spec.ts`
- Extensions in `app/internal_packages/ai-assistant/specs/config-spec.ts`

## Static / code audit

### Composer / next-line (required audit)

| File | Finding |
|---|---|
| `composer-assist.tsx` | Calls `AIService.chat({ messages })` only. **No** `=== 'claude-cli'` / provider-specific branches. |
| `next-line.ts` | Calls `AIService.chat(...)` only. **No** CLI-only branches. |

**Conclusion:** No edits required. Once `AIService` routes `cursor-cli`, composer assist and next-line inherit Cursor CLI automatically.

### Wiring checklist

| Item | Status |
|---|---|
| Transport option `cursor-cli` in Preferences | Done |
| Path default `agent`, model optional | Done |
| Always `-p --mode ask --trust`; stream-json → `--stream-partial-output` | Done |
| Spawn `cwd` = tmpdir | Done |
| Skills disabled in CLI mode (`isCliProvider` + chat-panel gate) | Done |
| Shared CLI skills error copy (not Claude-only) | Done |
| Chat panel model label for Cursor | Done |

## Not run here

- Full `npm test` / Electron Jasmine window suite
- Live `agent` binary login / end-to-end chat against a real Cursor subscription
- Project-wide formatters / linters

## Commits on branch

1. `test(ai-assistant): add Cursor CLI service specs (#21)`
2. `feat(ai-assistant): add CursorCliService (#21)`
3. `feat(ai-assistant): wire cursor-cli provider through config and AIService (#21)`
4. `feat(ai-assistant): add Cursor CLI preferences and chat panel gates (#21)`
5. `docs(ai-assistant): add test cases and results for #21`
6. `fix(ai-assistant): restore truncated ai-service.ts ending (#21)` — repaired accidental tool-output paste that truncated `testConnection`.
7. Follow-up: fix `parseListModelsOutput` to accept hyphenated model IDs + unit coverage (code-review finding).

## Jasmine (orchestrator)

```
npm test -- --spec-directory=app/internal_packages/ai-assistant/specs --spec-file-pattern='(cursor-cli-service|config)-spec'
→ 39 passing (includes parseListModelsOutput hyphenated-id specs)
```
