# Issue #23 — Test cases

## Automated

| ID | Case | Expected |
|---|---|---|
| A1 | `buildTranscript` folds system + labels turns | System/Human/Assistant/Tool present |
| A2 | `baseArgs` includes `-p` instruction, `--approval-mode plan`, `--skip-trust`, `-e none` | Exact flags |
| A3 | `baseArgs` negatives | No `-y` / `--yolo` / `auto_edit` / `--force` |
| A4 | `prepareWorkdir` under tmp + settings | `disableYoloMode`, exclude shell/write/exit_plan_mode |
| A5 | Stream: assistant `delta:true` | Yields content |
| A6 | Stream: non-delta / warning / init / tools | Ignored |
| A7 | Stream: severity error / result error | Throws rewritten error |
| A8 | JSON `response` parse + auth rewrite | OK / GEMINI_API_KEY messaging |
| A9 | Antigravity / ineligible rewrite | Actionable copy |
| A10 | `notFoundError` | Path + Preferences |
| A11 | Curated `listModels` | Static Gemini IDs |
| A12 | Config defaults | path `gemini`, model `''`, provider union |

## Manual

| ID | Case | Expected |
|---|---|---|
| M1 | Preferences → Transport → Gemini CLI | Path/model + Gemini auth note |
| M2 | Test connection with `GEMINI_API_KEY` or working login | ok |
| M3 | Chat panel stream | Tokens stream; skills unavailable |
| M4 | Composer assist | Rewrite works via AIService routing |
| M5 | Missing binary | Actionable not-found message |
