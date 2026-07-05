# RAG Hybrid Retrieval + Relevance Threshold — Design

**Date:** 2026-07-05
**Status:** Approved, implementation in progress
**Scope:** Improves the existing knowledge-base retrieval pipeline in `app/internal_packages/ai-assistant/`. Builds on B3 (knowledge base) from `docs/superpowers/specs/2026-06-28-ai-assistant-design.md`. Two items from a wider RAG-architecture review, approved by the user as "1 + 2":

1. **Hybrid retrieval** — fuse the existing dense-vector search with a new BM25 keyword search, so exact terms (names, invoice numbers, order IDs) that a small local embedding model represents poorly are still found.
2. **Relevance threshold + honest no-match note** — drop vector candidates below a minimum similarity instead of always returning `retrieveK` chunks regardless of relevance, and tell the model plainly when the knowledge base found nothing so it doesn't guess.

## Context: what existed before this change

The pipeline was Naive RAG: fixed-size char chunking → local MiniLM-L6 embeddings → SQLite blob store (`chunks` table, one row per chunk, no ANN index) → brute-force cosine top-K in `retriever.ts` → prompt injection with `[n]` citations. Retrieval always returned exactly `k` chunks with no floor on relevance, so an off-topic corpus could still inject `k` irrelevant chunks into the prompt. There was no keyword/exact-match path — `search_mailbox` (SQL `LIKE` on subject/sender) existed as a *separate* agent tool but was never fused with semantic retrieval in the automatic per-turn retrieval used by the chat flow.

## Goal

Make the one automatic retrieval call per chat turn (`retriever.ts:retrieve`) hybrid and relevance-aware, without adding new runtime dependencies, without changing on-disk chunk layout, and without requiring users to re-index.

## Decisions

- **Keyword index: SQLite FTS5**, not a new dependency. `better-sqlite3` (already a dep) supports FTS5 virtual tables natively. A `chunks_fts` virtual table mirrors `chunks` (`rowid` = `chunks.id`), ranked with `bm25()`.
- **Fusion: Reciprocal Rank Fusion (RRF)**, not score normalization. Cosine similarity and BM25 scores live on incomparable scales; RRF only uses each list's *rank*, so no scale-matching hack is needed. Formula: `score(id) = Σ 1/(c + rank + 1)` over whichever list(s) contain `id`, `c = 60` (standard RRF constant).
- **Relevance floor applies to the vector list only.** A low cosine score plausibly means "unrelated topic." A BM25 keyword hit is an exact substring/term match — if the user's query contains "INV-4421" and a chunk contains "INV-4421", that's evidence of relevance independent of embedding quality, so keyword hits are never filtered by `minScore`.
- **`minScore` is a new tunable RAG parameter** (default **0.25**), following the same pattern as `chunkSize`/`retrieveK`/etc.: a config key with a getter clamped to `[0, 1]`, included in `RAG_DEFAULTS`, computed by auto-tune (passthrough of the default — corpus stats don't inform a good threshold the way they inform chunk size), and editable in the Custom preferences grid.
- **No re-index required.** FTS5 backfill happens once, transparently, the first time an existing `ai-index.db` is opened after this change (detected via `sqlite_master` lookup for `chunks_fts`; if absent, the table is created and populated from current `chunks` rows). New/changed messages keep `chunks_fts` in sync via the same `upsertMessage`/`removeMessage`/`clear` write paths that maintain `chunks` today (delete-then-reinsert on upsert, matching the existing chunk-replacement semantics).
- **FTS operator safety.** User queries (and the agent's tool-call queries) must never be interpreted as FTS5 query syntax (`AND`, `OR`, `NOT`, parentheses, etc.) — a query containing those tokens as plain words (e.g. "and the invoice") must not error or behave unexpectedly. `keywordSearch` splits the input on whitespace, strips quote characters from each token, wraps each token in double quotes, and joins with `OR`, so every token is always treated as a literal phrase match.
- **No-match honesty, not silent injection.** When the knowledge base *was searched* (`kbEnabled` and an index exists) and hybrid retrieval returns zero results, `buildChatPrompt` injects a system note telling the model the search found nothing relevant, instead of omitting the sources block silently (which is indistinguishable, from the model's perspective, from "retrieval was never attempted"). This directly supports the existing grounded-only answering guardrail (spec section "Grounding & Answer Verification", item 1) and is a lightweight instance of Corrective RAG's "detect low relevance, don't just proceed" idea — full corrective re-querying/re-routing is out of scope for this change.

## Non-Goals (this change)

- Cross-encoder reranking of the fused candidate list (future work; needs a bundled reranker model).
- HyDE-style query rewriting/expansion before embedding (future work; adds an LLM round-trip per query).
- Fixing the underlying performance debt of `store.allVectors()` loading every chunk into memory per query, or lack of `accountId` filtering — orthogonal, tracked separately, not touched here.
- Graph-based retrieval using thread/sender/date metadata as structured filters.
- Any change to chunking strategy, embedding model, or on-disk vector storage format.

## Architecture

Only files inside the existing `app/internal_packages/ai-assistant/` package change; no new package, no new npm dependency.

```
app/internal_packages/ai-assistant/lib/
  vector-store.ts   # + chunks_fts virtual table (create + backfill on open); + keywordSearch(query, k)
                     #   kept in sync in upsertMessage/removeMessage/clear
  fusion.ts          # NEW — PURE fuseHybrid({vector, keyword, k, minScore}): RRF merge + minScore filter
  retriever.ts       # retrieve() now calls both store.keywordSearch and vector topK, merges via fuseHybrid
  config.ts          # + ai-assistant.rag.minScore key, RAG_DEFAULTS.minScore, getMinScore() clamped [0,1]
  auto-tune.ts       # AutoTuneResult.minScore passthrough (= RAG_DEFAULTS.minScore; not corpus-derived)
  prompts.ts         # buildChatPrompt(..., kbSearched?: boolean) — injects a "no relevant sources" system
                     #   note when kbSearched is true and retrieved is empty
  chat-panel.tsx     # passes kbSearched: true when the KB was actually queried this turn
  preferences.tsx    # Relevance threshold field in the default/auto-tune (read-only) and custom
                     #   (editable) RAG parameter grids
```

### Data flow (retrieval, revised)

```
query ──┬─> embed(query) ─> cosine topK over all chunk vectors ─┐
        │                                                        ├─> fuseHybrid(minScore) ─> top retrieveK ─> RetrievedSource[]
        └─> store.keywordSearch(query) (BM25 over chunks_fts) ──┘
```

If the fused result is empty and the KB was searched, `buildChatPrompt` adds the no-match system note instead of a sources block.

## Testing

TDD throughout (per `superpowers:test-driven-development`), specs under `app/internal_packages/ai-assistant/specs/`, run via the Electron Jasmine harness (`DISPLAY=:0 node_modules/electron/dist/electron ./app --enable-logging --test -f <pattern>`, per `memory/dev-verify-workflow`):

- **`vector-store-spec.ts`**: `keywordSearch` finds term matches, limits to k, empty query/no-match returns `[]`, FTS operator syntax in the query doesn't throw, keyword results are removed/replaced alongside `removeMessage`/re-`upsertMessage`/`clear`, and a pre-existing (pre-FTS) database is backfilled correctly on open.
- **`fusion-spec.ts`** (new, pure): an item found by both lists outranks single-list items; vector candidates below `minScore` are filtered while keyword-only matches at the same low vector score are kept; empty-input and `k`-limiting behavior; stable order for a single list.
- **`config-spec.ts`** / **`auto-tune-spec.ts`**: `getMinScore()` default and `[0,1]` clamping; `computeAutoTune` includes `minScore` at the proven default.
- **`retriever-spec.ts`** (new): against a real temp `VectorStore` with a spied embedding provider — semantically similar chunks are returned; chunks below the relevance floor are dropped; a chunk with an orthogonal embedding but an exact keyword match is still found; an irrelevant-only corpus returns `[]`; display ids are sequential for citations.
- **`prompts-spec.ts`**: the no-relevant-sources note appears only when `kbSearched` is true and `retrieved` is empty; no note when sources exist or when the KB wasn't searched at all.
- **Manual/e2e**: verified live in the dev app per `memory/dev-verify-workflow` — ask a question whose answer exists only as an exact term (e.g. an order number) in a low-semantic-similarity email, confirm it's found; ask an out-of-corpus question, confirm the model says it can't find it rather than fabricating an answer.

## Risks

- **FTS5 backfill cost on first open of a large existing index** — a one-time `INSERT ... SELECT` over all existing chunk rows; proportional to current corpus size, runs once per database file.
- **RRF constant `c = 60` is a standard default, not tuned to this corpus** — acceptable starting point; revisit if hybrid results feel mis-ranked in practice.
- **`minScore` default of 0.25 is a judgment call for MiniLM-L6 cosine scores** — may need adjustment once observed against real mailboxes; it's user-tunable via the Custom RAG mode as a mitigation.
