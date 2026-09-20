# Issue #23 — Test Results

## Summary

Implemented `gemini-cli` transport per `docs/issues/23/plan.md`. Focused Electron Jasmine suite for Gemini service + config defaults: **36 passing**.

## Automated specs (2026-09-20)

Command (real Electron + Xvfb harness):

```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test \
  -f "gemini-cli-service-spec|config-spec" --disable-gpu --no-sandbox
```

### Result: **36 passing**

```
  AIConfig defaults
    ✓ is disabled by default
    ✓ knowledge base disabled by default
    ✓ defaults endpoint to OpenAI
    ✓ defaults chat model
    ✓ defaults embedding backend to in-app
    ✓ web search disabled by default
    ✓ send email skill enabled by default
    ✓ trash thread skill enabled by default
    ✓ archive thread skill enabled by default
    ✓ rag mode defaults to default
    ✓ provider defaults to api
    ✓ claude CLI path defaults to "claude"
    ✓ claude CLI model override defaults to empty
    ✓ cursor CLI path defaults to "agent"
    ✓ cursor CLI model override defaults to empty
    ✓ gemini CLI path defaults to "gemini"
    ✓ gemini CLI model override defaults to empty
    ✓ minScore defaults to 0.25

  AIConfig.getMinScore clamping
    ✓ clamps to [0, 1]

  gemini-cli-service
    buildTranscript
      ✓ folds system content into the prompt body and labels turns
    baseArgs
      ✓ always uses plan mode, skip-trust, and -e none with a short -p instruction
      ✓ never enables yolo / force / auto_edit
      ✓ includes a model override only when configured
    prepareWorkdir / spawnOptions
      ✓ creates a tmp workdir with disableYoloMode and excluded write/shell tools
      ✓ workspaceSettings matches the on-disk hardenings
    parseStreamLine
      ✓ yields assistant delta content only
      ✓ ignores non-delta assistant messages
      ✓ ignores init, tools, user messages, and warning errors
      ✓ throws on severity=error and result status=error
    parseJsonResponse
      ✓ reads the response field
      ✓ surfaces error.message via resultError
    resultError
      ✓ rewrites Antigravity / ineligible tier errors
      ✓ rewrites auth / API key errors
      ✓ leaves unrelated messages unchanged
    notFoundError
      ✓ mentions the configured path and Preferences > AI Assistant
    listModels
      ✓ returns the curated static model list


  36 passing
```

## Acceptance mapping checklist

| Criterion | Evidence |
|---|---|
| Transport option | `preferences.tsx` option `gemini-cli` / “Gemini CLI (local)” |
| Path/model + Gemini auth copy | prefs block: path, curated models, `@google/gemini-cli`, `GEMINI_API_KEY` / Vertex / Antigravity note |
| Chat/composer via gemini | `GeminiCliService` + three-way `cliChatService()`; composer/next-line audit below |
| plan + skip-trust + `-e none` + secure workdir | `baseArgs` + `prepareWorkdir` / `workspaceSettings` specs |
| stdin + short `-p` contract | `baseArgs` uses `GEMINI_PROMPT_INSTRUCTION`; spawn writes transcript on stdin |
| Auth / Antigravity / API-key rewrite | `resultError` specs |
| Actionable missing binary | `notFoundError` spec |
| Curated models list | `listModels` + prefs curated list |
| Unit specs | this file’s Jasmine run |
| Skills disabled | `isCliProvider` includes `gemini-cli`; chat-panel skills gate + model badge branch |

## Composer / next-line audit

| File | Finding | Action |
|---|---|---|
| `lib/composer-assist.tsx` | Uses `AIService.chat({ messages })` only | **No edit** — inherits `gemini-cli` via `AIService` / `cliChatService()` |
| `lib/next-line.ts` | Uses `AIService.chat(...)` only | **No edit** — same inheritance |

## Residual security note (documented in plan)

Unit tests pin argv (`--approval-mode plan`, no yolo), workspace `.gemini/settings.json` (`disableYoloMode` + tool excludes including `exit_plan_mode`), and short `-p` + stdin delivery. Full non-interactive Plan Mode escalation cannot be proven in Jasmine alone.

## Specs added

- `app/internal_packages/ai-assistant/specs/gemini-cli-service-spec.ts`
- `app/internal_packages/ai-assistant/specs/config-spec.ts` (Gemini defaults)

## Jasmine

```
npm test -- --spec-directory=…/ai-assistant/specs --spec-file-pattern='(gemini-cli-service|config)-spec'
→ 37 passing
```
