# Test results — Antigravity CLI provider (#26)

## Jasmine (focused)

```
ABS="$(pwd)/app/internal_packages/ai-assistant/specs"
npm test -- --spec-directory="$ABS" --spec-file-pattern='(antigravity-cli-service|config)-spec'
```

**42 passing** (2026-09-20)

## Composer / next-line audit

- `composer-assist.tsx` and `next-line.ts` call `AIService.chat` only — no `provider === '…-cli'` gates. No edits required.

## Manual (pending — leave issue open)

- [ ] Install/sign-in via https://antigravity.google/docs/getting-started
- [ ] Preferences → Antigravity CLI → Test connection
- [ ] Chat stream + composer assist
- [ ] Confirm Gemini CLI still listed for API key / Vertex / Standard+Enterprise
