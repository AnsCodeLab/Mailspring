# RAG Hybrid Retrieval + Relevance Threshold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:test-driven-development for every task below — write the failing spec, watch it fail, then write the minimal code to pass. Steps use checkbox (`- [ ]`) syntax for tracking; already-completed steps are checked with a note on how they were verified.

**Goal:** Implement the two approved improvements from `docs/superpowers/specs/2026-07-05-rag-hybrid-retrieval-design.md`: (1) hybrid dense-vector + BM25 keyword retrieval fused with reciprocal rank fusion, and (2) a relevance threshold on the vector side plus an honest "no relevant sources found" prompt note when the fused result is empty.

**Spec:** `docs/superpowers/specs/2026-07-05-rag-hybrid-retrieval-design.md` — read it before starting; it has the full rationale for RRF over score-normalization, why the relevance floor doesn't apply to keyword hits, and the FTS-operator-safety requirement.

## Global Constraints

- No new npm dependency — FTS5 ships inside `better-sqlite3`, already a dependency.
- No change to on-disk chunk layout (`chunks` table schema) or embedding model.
- No re-index required: the FTS5 table is created and backfilled transparently the first time an existing `ai-index.db` is opened after this change ships.
- All new/changed logic gets a spec first (`superpowers:test-driven-development`, Iron Law: no production code without a failing test first). Specs live in `app/internal_packages/ai-assistant/specs/`.
- Test harness: `DISPLAY=:0 node_modules/electron/dist/electron ./app --enable-logging --test -f <pattern>` (per `memory/dev-verify-workflow`; `/tmp/electron-41` may not exist — use `node_modules/electron/dist/electron` directly). Lint: `./node_modules/.bin/eslint -c .eslintrc "app/internal_packages/ai-assistant/**/*.{ts,tsx}"`. Typecheck: `./node_modules/.bin/tsc -p app/tsconfig.json --noEmit`.
- User queries passed to `keywordSearch` must never be interpreted as FTS5 operator syntax — every token is quoted as a literal phrase.
- The relevance floor (`minScore`) filters vector candidates only; keyword (BM25) hits are never filtered by it.

## File Structure (files touched, all pre-existing package)

```
app/internal_packages/ai-assistant/
  lib/
    vector-store.ts   # MODIFY: + chunks_fts virtual table, backfill-on-open, keywordSearch()
    fusion.ts         # NEW: PURE fuseHybrid()
    retriever.ts      # MODIFY: hybrid retrieval + minScore
    config.ts         # MODIFY: + minScore key/default/getter
    auto-tune.ts       # MODIFY: + minScore passthrough
    prompts.ts        # MODIFY: + kbSearched no-match note
    chat-panel.tsx    # MODIFY: pass kbSearched through
    preferences.tsx   # MODIFY: + Relevance threshold field in RAG param grids
  specs/
    vector-store-spec.ts   # MODIFY: + keywordSearch tests
    fusion-spec.ts          # NEW
    retriever-spec.ts       # NEW
    config-spec.ts          # MODIFY: + minScore tests
    auto-tune-spec.ts       # MODIFY: + minScore passthrough test
    prompts-spec.ts         # MODIFY: + kbSearched note tests
```

---

## Task 1: BM25 keyword index in `VectorStore`

**Files:** `lib/vector-store.ts`, `specs/vector-store-spec.ts`

**Interfaces:**
- Produces: `VectorStore.keywordSearch(query: string, k: number): Array<{ id: string; messageId: string; threadId: string; sender: string; subject: string; date: string; chunkText: string }>`.
- A `chunks_fts` FTS5 virtual table (`chunkText`, `subject`, `sender`; `rowid` = `chunks.id`), created and backfilled from existing `chunks` rows on first open of a database that doesn't have it yet. Kept in sync by `upsertMessage` (delete+reinsert per message, matching existing chunk-replacement semantics), `removeMessage`, and `clear`.

- [x] **Step 1: Write the failing tests** — added to `specs/vector-store-spec.ts`: finds chunks containing query terms; limits results to k; empty results for no-match and for empty/whitespace queries; does not throw on FTS operator syntax (`AND`, `(`, `NOT`, `"`) in the query and still matches the literal terms; removed messages drop out of keyword results; re-upsert replaces old keyword entries (no stale hits); `clear()` empties the keyword index; opening a pre-existing (pre-FTS) database backfills `chunks_fts` from its current `chunks` rows.
- [x] **Step 2: Verify RED** — ran `-f ai-assistant/specs/vector-store`; failed with `TypeError: store.keywordSearch is not a function` (5 new failures), confirming the tests exercise the missing behavior, not a typo.
- [x] **Step 3: Implement** — constructor checks `sqlite_master` for `chunks_fts`; if absent, `CREATE VIRTUAL TABLE chunks_fts USING fts5(chunkText, subject, sender)` then backfills via `INSERT INTO chunks_fts (rowid, chunkText, subject, sender) SELECT id, chunkText, subject, sender FROM chunks`. `upsertMessage` deletes old FTS rows for the message (via a new `deleteFtsForMessage` helper) before deleting/reinserting `chunks`, and inserts an FTS row per chunk using `lastInsertRowid` from the `chunks` insert. `removeMessage` also calls `deleteFtsForMessage`. `clear()` adds `DELETE FROM chunks_fts`. `keywordSearch` splits the query on whitespace, strips `"` characters from each token, filters empties, wraps each surviving token in double quotes and joins with `OR` (so tokens are always literal phrase matches, never FTS operators), and returns `[]` immediately if no tokens survive; otherwise runs a `chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?` query joined back to `chunks`.
- [x] **Step 4: Verify GREEN** — `-f ai-assistant/specs/vector-store` → 13 passing (8 pre-existing + 5 new... actually 8 new assertions across the `keywordSearch` describe block; full file green).
- [x] **Step 5: Lint** — clean as part of the full-suite lint pass in Task 7.

---

## Task 2: Pure RRF fusion helper

**Files:** `lib/fusion.ts` (new), `specs/fusion-spec.ts` (new)

**Interfaces:**
- Produces: `fuseHybrid(args: { vector: Array<{id: string; score: number}>; keyword: Array<{id: string}>; k: number; minScore?: number; c?: number }): Array<{id: string; score: number}>`. Pure, no I/O.

- [x] **Step 1: Write the failing tests** — `specs/fusion-spec.ts`: an id present in both lists outranks single-list ids; vector candidates below `minScore` are filtered out; a keyword-only match survives even when every vector score is below `minScore`; empty result when nothing passes (all vector scores below floor and no keyword hits; or both lists empty); results are capped at `k`; a single list's relative order is preserved when the other list is empty.
- [x] **Step 2: Verify RED** — ran `-f ai-assistant/specs/fusion`; failed on module load (`Cannot find module '../lib/fusion'`) — this also surfaced a spec-runner quirk where a load error hangs the harness instead of exiting; documented in Task 7 below (kill via `pkill -9 -x electron` and rerun with output captured to a file if this recurs).
- [x] **Step 3: Implement** — `fuseHybrid` filters `vector` entries by `score >= minScore` (default 0), leaves `keyword` untouched, then for each of the two lists adds `1 / (c + rank + 1)` (`c` default 60, the standard RRF constant) to a per-id running total keyed by rank-within-that-list, sorts descending by total score, and slices to `k`.
- [x] **Step 4: Verify GREEN** — `-f ai-assistant/specs/fusion` → 6 passing.
- [x] **Step 5: Lint** — clean as part of the full-suite lint pass in Task 7 (one unrelated prettier formatting fix applied via `eslint --fix` to `prompts.ts`, `fusion-spec.ts`, `retriever-spec.ts`).

---

## Task 3: `minScore` config parameter

**Files:** `lib/config.ts`, `lib/auto-tune.ts`, `specs/config-spec.ts`, `specs/auto-tune-spec.ts`

**Interfaces:**
- Produces: config key `ai-assistant.rag.minScore`; `RAG_DEFAULTS.minScore = 0.25`; `AIConfig.getMinScore(): number` clamped to `[0, 1]`; `AutoTuneResult.minScore` (passthrough of `RAG_DEFAULTS.minScore` — corpus stats don't inform a better threshold the way they inform chunk size/context budget).

- [x] **Step 1: Write the failing tests** — `config-spec.ts`: `getMinScore()` defaults to `0.25`; a second describe block spies `AppEnv.config.get` to return out-of-range values and asserts clamping to `0` / `1` / a pass-through in-range value. `auto-tune-spec.ts`: extended the existing "keeps history fraction, max steps, and web results at their proven defaults" test to also assert `result.minScore === RAG_DEFAULTS.minScore`.
- [x] **Step 2: Verify RED** — ran both spec files together (`-f "ai-assistant/specs/(config|auto-tune)"`); 2 failing in config (missing `getMinScore`), 1 failing in auto-tune (missing `minScore` on the result) — 27 passing / 2 failing on the first pass, then after adding `getMinScore` alone, config went green and auto-tune's new assertion was the sole remaining failure, confirming each addition was tested independently before being implemented.
- [x] **Step 3: Implement** — added `minScore: 'ai-assistant.rag.minScore'` to the `K` key map, `minScore: 0.25` to `RAG_DEFAULTS` with a comment on why 0 disables the floor, `getMinScore: () => Math.min(1, Math.max(0, get(K.minScore, RAG_DEFAULTS.minScore)))`. In `auto-tune.ts`, added `minScore` to the `AutoTuneResult` type and to `computeAutoTune`'s return value as `RAG_DEFAULTS.minScore`.
- [x] **Step 4: Verify GREEN** — both spec files → 29 passing.
- [x] **Step 5: Lint** — clean as part of the full-suite lint pass in Task 7 (one unrelated prettier formatting fix applied via `eslint --fix` to `prompts.ts`, `fusion-spec.ts`, `retriever-spec.ts`).

---

## Task 4: Wire hybrid retrieval + threshold into `retriever.ts`

**Files:** `lib/retriever.ts`, `specs/retriever-spec.ts` (new)

**Interfaces:**
- Modifies: `retrieve(query, store, k?)` now runs both `topK` (vector) and `store.keywordSearch` (keyword), fuses via `fuseHybrid` with `minScore: AIConfig.getMinScore()`, maps fused ids back to full chunk records, and assigns sequential display ids (`"1"`, `"2"`, ...) as before.

- [x] **Step 1: Write the failing tests** — `specs/retriever-spec.ts`, against a real temp `VectorStore` (`fs.mkdtempSync`) with `getEmbeddingProvider` spied to always embed to `[1, 0]` so cosine similarity is deterministic (1 for same-direction chunk vectors, 0 for orthogonal): returns semantically similar chunks; drops a chunk whose vector is orthogonal to the query (cosine 0, below the 0.25 default floor) when a relevant chunk is also present; finds an exact-term match via keyword search even though its embedding is orthogonal to the query (cosine 0); returns `[]` when nothing in the corpus is relevant by either path; assigns sequential `"1"`/`"2"` display ids across two relevant results.
- [x] **Step 2: Verify RED** — ran `-f ai-assistant/specs/retriever`; 3 passing / 2 failing — the "drops below threshold" and "returns empty when nothing is relevant" cases failed because the pre-change `retriever.ts` had no relevance floor at all (it always returned up to `k` chunks regardless of score), confirming those two tests exercise the new behavior specifically.
- [x] **Step 3: Implement** — rewrote `retriever.ts`: compute `vector = topK(qv, allChunks, limit)` as before, compute `keyword = store.keywordSearch(query, limit)`, fuse with `fuseHybrid({ vector, keyword, k: limit, minScore: AIConfig.getMinScore() })`, then map fused ids back through the existing `byId` lookup built from `allVectors()` (unchanged), preserving the sequential-id-assignment behavior other code (citations) depends on.
- [x] **Step 4: Verify GREEN** — `-f ai-assistant/specs/retriever` → 5 passing.
- [x] **Step 5: Lint** — clean as part of the full-suite lint pass in Task 7 (one unrelated prettier formatting fix applied via `eslint --fix` to `prompts.ts`, `fusion-spec.ts`, `retriever-spec.ts`).

---

## Task 5: No-relevant-sources prompt note

**Files:** `lib/prompts.ts`, `lib/chat-panel.tsx`, `specs/prompts-spec.ts`

**Interfaces:**
- Modifies: `buildChatPrompt(args: { ...; kbSearched?: boolean })` — when `kbSearched` is true and the sources block would otherwise be empty (no retrieved sources), injects a `system` message stating the knowledge-base search (semantic + keyword) found nothing relevant, instructing the model not to invent email content and to say so or try other search tools. No note when sources exist, and no note when `kbSearched` is falsy (KB not searched at all — distinct from "searched, found nothing").
- Modifies: `chat-panel.tsx`'s send flow sets a local `kbSearched` flag to `true` only on the branch that actually calls `retrieve()` (KB enabled and an index store exists), and passes it into `buildChatPrompt`.

- [x] **Step 1: Write the failing tests** — `prompts-spec.ts`: note appears and contains "found no relevant sources" when `retrieved: []` and `kbSearched: true`; note is absent when sources are present (`retrieved: [src(...)]`, `kbSearched: true`); note is absent when `kbSearched` is omitted entirely (default undefined/false), even with empty `retrieved`.
- [x] **Step 2: Verify RED** — ran `-f ai-assistant/specs/prompts`; 1 failing ("notes that the knowledge base had no relevant sources..."), 12 passing (pre-existing tests unaffected, confirming the new optional field doesn't break existing callers).
- [x] **Step 3: Implement** — added `kbSearched?: boolean` to `buildChatPrompt`'s args type with an inline comment on the true/false/absent distinction; in the body, the existing `if (sb) ctx.push(...)` sources-block branch gained an `else if (args.kbSearched)` branch pushing the no-match system message. Then in `chat-panel.tsx`, introduced `let kbSearched = false` alongside the existing `let retrieved: RetrievedSource[] = []`, set `kbSearched = true` right after the existing `retrieved = await retrieve(q, Indexer.store())` call (inside the same `if (AIConfig.isKnowledgeBaseEnabled() && Indexer.store())` branch), and passed `kbSearched` into the `buildChatPrompt({...})` call.
- [x] **Step 4: Verify GREEN** — `-f ai-assistant/specs/prompts` → 13 passing.
- [x] **Step 5: Lint** — clean as part of the full-suite lint pass in Task 7 (one unrelated prettier formatting fix applied via `eslint --fix` to `prompts.ts`, `fusion-spec.ts`, `retriever-spec.ts`).

---

## Task 6: Surface `minScore` in the Preferences UI

**Files:** `lib/preferences.tsx`

**Interfaces:** No new pure logic (UI wiring against already-tested `AIConfig`/`RAG_DEFAULTS`/`AutoTuneResult`), so no new spec — matches how the existing RAG param grid fields (chunkSize, retrieveK, etc.) are handled (config get/set, covered indirectly by `config-spec.ts`/`auto-tune-spec.ts`).

- [x] Add `minScore` to the component's `adv` state type and initializer (`AIConfig.getMinScore()`).
- [x] Add `[K.minScore]: RAG_DEFAULTS.minScore` to `_resetAdvanced`'s config-write map and to its `adv` state reset.
- [x] Add `AppEnv.config.set(K.minScore, values.minScore)` to `_applyParamValues` (used by both auto-tune "Compute now"/"Recompute" and RAG-mode switching to `default`).
- [x] Add a **Relevance threshold** field to the read-only `readOnlyGrid` (shown in Default and Auto-tune modes) with a hint explaining "Minimum similarity for a source to be used (0 disables)".
- [x] Add a **Relevance threshold** editable `<input type="number" min={0} max={1} step={0.05}>` to the Custom mode's `editableGrid`, with validation hints: warn when `0` ("every top-K source is injected, relevant or not"), warn above `0.6` ("very strict, most sources filtered out"), otherwise explain that keyword matches always pass regardless of the threshold.
- [x] **Verify live** — launched the dev app via Playwright `_electron` + raw CDP (per `memory/dev-verify-workflow`; `window.eval` is blocked so navigation used `$m.Actions.openPreferences()` / `$m.Actions.switchPreferencesTab('AIAssistant')` directly rather than a DOM click path). Confirmed the **Relevance threshold** field renders in Default, Auto-tune, and Custom modes (`.ai-rag-mode-selector` buttons all present and clickable; "Relevance threshold" text confirmed present after switching to each). In Custom mode, set the input to `0.4` and dispatched `change` + `focusout` (not `blur` — blur doesn't bubble, so React's delegated listener never saw it; `focusout` does bubble and is what React listens for) — `AppEnv.config.get('ai-assistant.rag.minScore')` read back `0.4` afterward, confirming the `onBlur` persists correctly.
- [x] **Lint** — clean as part of the full-suite lint pass below.

---

## Task 7: Full verification + commit

- [x] Run the complete `ai-assistant` spec suite: `DISPLAY=:0 node_modules/electron/dist/electron ./app --enable-logging --test -f ai-assistant/specs` → **176 passing**, no regressions in specs untouched by this change (agent, chat-store, chunking, citations, indexer, registry, similarity, skills, sse, ssrf, suggestions, claude-cli-service, chat-status, embeddings-server, composer-assist, history-utils).
- [x] Lint: `./node_modules/.bin/eslint -c .eslintrc "app/internal_packages/ai-assistant/**/*.{ts,tsx}"` → 3 prettier-only formatting errors found on first run (in `prompts.ts`, `fusion-spec.ts`, `retriever-spec.ts`); fixed via `eslint --fix` on those 3 files; re-run → clean.
- [x] Typecheck: `./node_modules/.bin/tsc -p app/tsconfig.json --noEmit` → clean.
- [x] Manual/e2e, retrieval logic: `retriever-spec.ts` (Task 4) already exercises the exact-term-match-despite-low-similarity and no-answer-anywhere scenarios against a real temp `VectorStore`, which is the deterministic equivalent of the live scenario at the unit level. **Not run**: a full live chat turn through a real configured AI provider with a real indexed mailbox (would need a live model endpoint + populated corpus; out of scope for this pass — the prompt-note behavior itself is unit-tested in `prompts-spec.ts`, Task 5).
- [x] Manual/e2e, preferences UI: verified live per Task 6's "Verify live" entry above (Playwright `_electron` + CDP), including that an edited value actually persists to config.
- [x] Note in the harness: if a spec file fails to load (e.g. a typo'd import), the Jasmine runner can hang instead of exiting — if a test run doesn't return within ~60s, `pkill -9 -x electron` and rerun with output redirected to a file so the actual error is visible (this happened during Task 2's RED step, caused by `fusion.ts` not existing yet). Separately, dispatching synthetic DOM events for live verification must use `focusout`, not `blur` — `blur` doesn't bubble so React's delegated listener never sees it and the corresponding `onBlur` handler silently never fires.
- [x] Commit with a message describing both changes together (they share the retriever code path and were approved as one unit).

**Known follow-ups, not this change:** cross-encoder reranking, HyDE query rewriting, `store.allVectors()` per-query full deserialization + missing `accountId` filtering (performance debt, orthogonal), thread/sender/date metadata as retrieval filters. See the wider RAG-architecture review for the full prioritized list.
