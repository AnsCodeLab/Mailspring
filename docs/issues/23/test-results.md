# Issue #23 — Test results

## Composer / next-line audit

- `composer-assist.tsx` and `next-line.ts` call `AIService.chat` only — **no** provider-specific gates.
- With `isCliProvider()` including `gemini-cli` and three-way `cliChatService()`, both inherit Gemini CLI automatically.
- **No edits required.**

## Automated

Focused Jasmine suite to be run by orchestrator:

```
npm test -- --spec-directory=<abs>/app/internal_packages/ai-assistant/specs \
  --spec-file-pattern='(gemini-cli-service|config)-spec'
```

## Manual

Deferred — needs Gemini CLI auth (`GEMINI_API_KEY` / login). This environment's Google free Code Assist OAuth hits Antigravity migration; API key path still valid.
