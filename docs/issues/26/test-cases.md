# Test cases — Antigravity CLI provider (#26)

| ID | Case | Expected |
|---|---|---|
| TC-01 | `baseArgs` | Includes `-p`, `--mode plan`, `--sandbox`, `--disable-slash-commands`, `--output-format`; never `--dangerously-skip-permissions` |
| TC-02 | Model override | `--model` only when config set |
| TC-03 | Prompt size | `<80KB` embeds transcript; `≥80KB` throws clear error |
| TC-04 | Stream ACTIVE | Yields `text_delta` |
| TC-05 | Stream DONE dupe guard | No second yield after ACTIVE for same `step_index` |
| TC-06 | Stream tools/init/malformed | Ignored / skipped |
| TC-07 | Result ERROR | Auth rewrite mentions `agy` + getting-started URL |
| TC-08 | Auth negative | Bare "login.toml" not rewritten |
| TC-09 | notFoundError | Path + Preferences + getting-started URL |
| TC-10 | Config defaults | path `agy`, model `''`, provider default still `api` |
| TC-11 | Wiring | `isCliProvider` includes `antigravity-cli`; prefs option + chat badge |
| TC-12 | Composer audit | Uses `AIService` only — no separate provider gates |
