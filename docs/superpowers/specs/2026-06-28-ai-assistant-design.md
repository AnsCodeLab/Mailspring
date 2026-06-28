# AI Assistant — Design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Scope:** Project **B** of the larger effort (A = composer toolbar polish, shipped in v1.21.1.20260628). This spec covers the AI assistant: provider connection (B1), chat panel + composer assist (B2), and the local knowledge base / RAG (B3). Implementation is **staged**: B1+B2 first, then B3 builds on them.

## Goal

Add an AI assistant to Mailspring, implemented as a new internal package `app/internal_packages/ai-assistant/`. It connects to an OpenAI-compatible endpoint (cloud or local), provides a thread chat panel and in-composer assistance (commands + on-demand next-line suggestions), and builds a fully-local knowledge base over all email so the assistant can answer using relevant past messages (retrieval-augmented generation).

## Decisions (from brainstorming)

- **Provider:** OpenAI-compatible, configurable (base URL + model + API key). Covers OpenAI cloud, Azure, OpenRouter, and local models (Ollama / LM Studio) behind one client.
- **Surfaces:** both a thread **chat panel** and **in-composer assist** (commands + on-demand next-line ghost text).
- **Next-line suggestion:** on-demand (Tab / button → ghost text → Tab accept, Esc dismiss). Not automatic/Copilot-style.
- **Privacy:** trust the configured endpoint with a **one-time first-use notice**; "use a local endpoint for full privacy" is made prominent.
- **Embeddings (knowledge base):** **local only**, pluggable — default **in-app** (transformers.js, bundled-on-first-use model), or a configurable **local server** endpoint (Ollama/LM Studio). Email is never sent out to build the index.
- **Master switch:** `ai-assistant.enabled` (default **off**) gates everything; `ai-assistant.knowledgeBase.enabled` (default **off**) separately gates indexing.
- **Best practices** applied throughout (security, robustness, performance, testing).

## Non-Goals (this cycle)

- Automatic Copilot-style continuous autocomplete (on-demand only).
- Persistent cross-session chat history (chat is ephemeral per-thread).
- Cloud embeddings (indexing is local-only by decision).
- Multi-model orchestration / agents calling external tools.
- An ANN/vector index extension (brute-force cosine is sufficient at this scale; revisit later).

## Architecture

New internal package, renderer-side (matches the grammar-check plugin precedent of calling an external API from the renderer). A thin `fetch`-based client avoids adding an AI SDK dependency.

```
app/internal_packages/ai-assistant/
  package.json            # windowTypes, config schema (enabled, endpoint, model, kb.*)
  lib/
    main.ts               # activate()/deactivate(); registers UI + preferences; gates on `enabled`
    ai-service.ts         # OpenAI-compatible chat client (stream + non-stream), AbortController, typed errors
    prompts.ts            # PURE prompt builders (chat/reply/rewrite/next-line) w/ optional retrievedContext + token budget
    embeddings/
      provider.ts         # EmbeddingProvider interface + factory (selects backend from config)
      in-app.ts           # transformers.js backend (lazy-loaded model, cached in app data)
      server.ts           # local-server backend (POST /v1/embeddings)
    vector-store.ts       # plugin-owned better-sqlite3 file; upsert/query; cosine top-K
    chunking.ts           # PURE HTML->text + passage chunking
    similarity.ts         # PURE cosine similarity / top-K
    retriever.ts          # embed query -> vector-store top-K -> retrievedContext
    indexer.ts            # bulk + incremental ingestion, idle-throttled, resumable, progress
    chat-panel.tsx        # thread chat UI (streamed), "Draft reply"
    composer-assist.tsx   # composer toolbar AI menu (Draft/Rewrite/Shorter/Longer/Tone/Grammar)
    next-line.ts          # on-demand ghost-text suggestion in the Slate editor
    preferences.tsx       # AI preferences tab (toggles, endpoint, model, key, embeddings, index controls)
    privacy-notice.tsx    # one-time first-use notice
```

### Data flow

- **Chat:** question + thread messages (+ optional retrievedContext from B3) → `buildChatPrompt` → `ai-service.chatStream` → render tokens → optional "Draft reply" → `DraftStore` opens a reply draft with the text.
- **Composer command:** button → read draft/selection → prompt builder → `ai-service` (stream) → insert/replace in the Slate editor (sanitized, undoable).
- **Next-line:** Tab → `buildNextLinePrompt(draftSoFar)` → `ai-service` → ghost text → Tab inserts / Esc dismisses.
- **Index:** messages (`DatabaseStore`) → `chunking` (HTML→text, passages) → `EmbeddingProvider.embed` (local) → `vector-store` (SQLite).
- **Retrieve:** query → embed → `vector-store` cosine top-K → `retrievedContext` → prompt builders.

## Section 1 — AI client & settings (B1)

**`ai-service.ts`** — one responsibility: talk to an OpenAI-compatible endpoint.
- `chatStream({ messages, signal }): AsyncIterable<string>` parsing the `/v1/chat/completions` SSE stream; `chat()` for non-streamed calls.
- Reads `endpoint` + `model` from `AppEnv.config` (`ai-assistant.endpoint`, `ai-assistant.model`); reads the API key from `KeyManager` (secure storage — never in config or logs).
- `AbortController` + per-request timeout; transient errors (network, 429, 5xx) retried with backoff.
- Typed errors: `MissingConfigError`, `AuthError`, `RateLimitError`, `NetworkError` → friendly UI messages pointing to settings.

**Settings (`preferences.tsx`)** — an **AI** preferences tab:
- Master **Enable AI assistant** toggle (`ai-assistant.enabled`, default off).
- Chat endpoint URL (default `https://api.openai.com/v1`), model (default `gpt-4o-mini`), API key field (write-only into `KeyManager`), **Test connection** button.
- Embeddings: backend select (in-app | local server), local-server URL + model.
- Knowledge base: **Enable** toggle (`ai-assistant.knowledgeBase.enabled`, default off), index progress, pause/resume, re-index, **Clear index**.
- Config schema declared in `package.json`. The **one-time privacy notice** fires on first actual request.

## Section 2 — Chat panel + composer assist (B2)

**Chat panel (`chat-panel.tsx`)** — injected into the thread/message view via `ComponentRegistry` (right-side region). Reads the open thread via `FocusedContentStore` + `thread.messages()`. Streams answers; keeps **ephemeral per-thread** history (resets on thread switch; cancels in-flight request via AbortController). Actions: free chat ("summarize", "what are they asking?") and **Draft reply** → opens a composer draft with the generated reply.

**Composer assist (`composer-assist.tsx`)** — an AI menu/button in the composer toolbar; commands operate on the **draft or selected text**: Draft reply, Rewrite, Make shorter, Make longer, Change tone (formal/casual), Fix grammar. Each: read text → prompt builder → stream → insert/replace in the Slate editor (sanitized via `SanitizeTransformer`, undoable).

**Next-line (`next-line.ts`)** — on-demand: Tab at end of draft (or a button) → `buildNextLinePrompt` → grey **ghost text**; Tab accepts (insert), Esc dismisses.

**`prompts.ts`** — PURE builders (`buildChatPrompt`, `buildReplyPrompt`, `buildRewritePrompt`, `buildNextLinePrompt`), each taking thread/draft text **plus an optional `retrievedContext`** slot (the B3 seam), trimming to a token budget. Unit-tested.

## Section 3 — Knowledge base (B3)

**`EmbeddingProvider` (`embeddings/provider.ts`)** — `embed(texts): Promise<number[][]>`; factory selects the backend from config:
- `in-app.ts` (default): transformers.js with a small model (`all-MiniLM-L6-v2`, 384-dim). Model is **downloaded once on first enable** into the app data dir and cached, then runs offline. Lazy-loaded only when the knowledge base is enabled.
- `server.ts`: POST to the configured local endpoint (`/v1/embeddings`, e.g. Ollama `nomic-embed-text`).

**Vector store (`vector-store.ts`)** — a **plugin-owned** `better-sqlite3` file at `<configDirPath>/ai-index.db`, opened **writable** (independent of the read-only main DB). Schema: `(id, messageId, threadId, accountId, date, sender, subject, chunkText, embedding BLOB, dim)`. Retrieval computes **cosine top-K in JS** over candidate vectors (`similarity.ts`) — adequate for tens of thousands of chunks; an ANN index is a later optimization.

**Chunking (`chunking.ts`)** — PURE: HTML→plain text, split into ~500-token passages with small overlap; attach message metadata. Unit-tested.

**Indexer (`indexer.ts`)**
- *Bulk*: on knowledge-base enable, a background **idle-throttled, batched** pass over existing messages (read bodies from `DatabaseStore`); resumable across restarts via persisted progress.
- *Incremental*: subscribe to `DatabaseStore` Message persists → embed new mail as it arrives.
- *Controls*: pause/resume, re-index, clear. Indexes all accounts by default.
- Progress surfaced in the settings tab ("Indexed 3,200 / 12,000").

**Retriever (`retriever.ts`)** — embed the query → `vector-store` cosine top-K → return matching chunks (with `messageId`/`threadId` for source links) as `retrievedContext` for the prompt builders. This makes chat/compose mailbox-aware.

## Section 4 — Cross-cutting

- **Security:** API key only in `KeyManager`, never config/logs. AI output inserted into the composer is sanitized via the existing `SanitizeTransformer` (same path as paste). Network requests go only to configured endpoints. Model output is never executed.
- **Robustness:** AbortController + timeout per request; backoff retry on transient failures; graceful degradation (missing config → message to settings); indexing resumable and restart-safe.
- **Performance:** streaming for chat/commands; bulk embedding idle-throttled and batched (never blocks UI); transformers.js + model lazy-loaded only when the knowledge base is on; prompts + retrieved context trimmed to a token budget.
- **Privacy:** indexing always local (in-app or local server). Fully on-device if the chat endpoint is also local; if chat is cloud, only the question + retrieved snippets go to the chat model (one-time notice covers this).
- **Master gating:** when `ai-assistant.enabled` is off, `main.ts` registers no UI and starts no indexing/network. Knowledge base additionally gated by `ai-assistant.knowledgeBase.enabled`.

## Testing

- **Unit (Jasmine, `app/spec/`):** prompt builders; HTML→text + chunking; cosine similarity / top-K; SSE stream parsing; retriever and vector-store with small fixtures (a temp SQLite file).
- **Manual / e2e:** chat panel, composer assist commands, next-line ghost text, settings + Test connection, and a small end-to-end index→retrieve→answer flow — verified in the live app via the Playwright `_electron` + CDP harness (see `memory/dev-verify-workflow`).
- Lint + tsc clean; specs run via the Electron test harness.

## Risks

- **transformers.js footprint / first-run model download** — mitigated by lazy-load + download-on-first-enable + caching; the feature is opt-in.
- **Large mailboxes** — bulk indexing cost/time; mitigated by throttling, batching, resumability, and per-account scope; brute-force cosine may need an ANN index at very large scale (noted as future work).
- **Cloud chat + retrieved context** — retrieved email snippets reach the chat model when chat is cloud; surfaced via the one-time notice; fully-local config avoids it.
- **Slate ghost-text** — on-demand keeps it simpler than continuous autocomplete; still needs careful insert/dismiss handling in the editor.

## Staging

1. **B1** — `ai-service`, settings tab + config schema, KeyManager, Test connection, privacy notice, master gating.
2. **B2** — `prompts`, chat panel, composer assist commands, next-line ghost text.
3. **B3** — embeddings providers, vector store, chunking, similarity, indexer, retriever; wire `retrievedContext` into prompts.

Each stage is independently shippable behind the master toggle.
