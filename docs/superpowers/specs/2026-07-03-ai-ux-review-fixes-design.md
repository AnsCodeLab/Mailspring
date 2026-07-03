# AI Assistant UX Review Fixes — Design

**Date:** 2026-07-03
**Scope:** All 12 findings from the 2026-07-03 dogfooding UX review of the custom AI assistant and composer features (P0 data safety, P1 workflow friction, P2 polish).
**Package:** `app/internal_packages/ai-assistant/` (plus one CSS-only composer change).

## Decisions locked during brainstorming

- Composer cold-start: **mitigate only** (stable layout, accept ~2s button delay). No upstream window-loading changes.
- Long-running requests: **soft warning only, never auto-cancel.** Local models legitimately take minutes.
- History list: **light investment** (search, date grouping, hover-delete, date-deduped titles). No AI-generated titles, no schema changes.

---

## 1. Data safety: split chat history out of `ai-index.db` (P0)

**Problem.** `ChatStore` persists conversations (irreplaceable user data) inside `ai-index.db`, the same file `VectorStore` uses for the rebuildable embedding cache. The preferences UI has "Clear index" / "Re-index" buttons pointed at that file. Today those spare the `chats` tables, but the architecture makes conversations one code change or one support-forum "delete the index" tip away from destruction.

**Approaches considered.**
1. New dedicated `ai-chat.db` with one-time migration — **chosen**.
2. Keep the shared file, guard the clear paths. Rejected: doesn't remove the standing risk.
3. Store chats in `edgehill.db`. Rejected: sync-engine-owned, read-only from the UI.

**Design.**
- `ChatStore` opens `<configDir>/ai-chat.db` instead of `ai-index.db`.
- A unit-testable `migrateChats(newDbPath, oldDbPath)` helper runs on `ChatStore` construction:
  - If `ai-chat.db` already has `chats` rows → skip (idempotent).
  - Else if `ai-index.db` exists and has `chats` rows: `ATTACH` the old DB, copy `chats` + `chat_refs` inside one transaction, verify row counts match, `COMMIT`.
  - Only after verified copy: drop `chats` + `chat_refs` from `ai-index.db`.
  - Partial-copy recovery: if a previous copy died midway (new DB has rows but counts mismatch and old tables still exist), wipe the new tables and re-copy.
- **Error handling:** if migration throws, `ChatStore` falls back to opening the old `ai-index.db` path for that session (conversations remain visible, nothing lost) and migration retries next launch.
- Runs identically in dev (`Mailspring-dev`) and the installed production app, since it executes wherever `ChatStore` is constructed (`chat-panel.tsx`).

## 2. Latency affordances for long-running requests (P0)

**Problem.** Clicking a suggestion pill against a local model produced a bare blinking cursor for 90+ seconds — no way to distinguish "working" from "hung". (Root cause observed: llama-swap model cold-load + small model with 24k-char context.)

**Design.**
- `_send` in `chat-panel.tsx` gains a phase field + start timestamp: `retrieving` → `waiting` → `streaming` (tool steps keep the existing `🔧 <skill>…` display as their own phase).
- The pending assistant bubble shows subtle italic status text instead of a bare cursor:
  - `retrieving`: "Retrieving context…"
  - `waiting` (request sent, zero tokens yet): "Waiting for the model… (12s)" — elapsed seconds ticked by a 1s interval that runs only while busy.
  - After **30s** with zero tokens: "Still waiting — local models can take a while to load. (45s)" and the Stop button gets a highlighted style.
- First token → normal streaming rendering.
- **Never auto-cancel.** Stop remains the only cancellation path.
- The phase transitions live in a small helper testable without React.

## 3. Empty-state header persists during conversation (P0)

**Problem.** With no thread selected, the "AI Assistant / Ask about your mailbox…" block keeps rendering above an in-progress conversation.

**Design.** Render the empty-state block only when `!thread && turns.length === 0`.

**Suggestion-pill / chip matrix (locked with user):**

| State | What shows |
|---|---|
| No turns, no thread | Global suggestion pills |
| No turns, thread focused | Thread suggestion pills |
| Turns exist, same thread | Just the conversation |
| Turns exist, focused thread changed | Conversation + thread-change chip above input (see §7) |

## 4. Composer action-bar cold start (P1, mitigate only)

**Problem.** The popout composer is typeable seconds before plugin action-bar buttons (✨ AI, send-later, templates) register; buttons pop in and shift layout.

**Design.** CSS-only: stable `min-height` on the composer action bar so late-arriving buttons never shift layout vertically; buttons appear when ready. Accepted: ~2s delay before ✨ AI is visible.

## 5. Local-model context preset + Advanced affordance (P1)

**Problem.** The default 24k-char context budget is tuned for cloud models; against a 4B local model it produces minutes-long prompts. Auto-tune exists but hides behind "Advanced settings (click to expand)", which looks like plain text.

**Design.**
- The RAG mode selector (Default / Auto-tune / Custom) gains a fourth preset: **"Local model (fast)"** — context budget 6000 chars, retrieve K 4, max agent steps 4; chunk size/overlap, history fraction, and web-search results keep their RAG_DEFAULTS values. Applied through the same `_applyParamValues` path Auto-tune uses.
- "Advanced settings" gets a chevron (▸/▾) and link styling so it reads as a control.

## 6. "↺" → "＋ New chat" (P1)

**Problem.** The header "↺" looks like refresh; it actually starts a new session (nothing is deleted — the old conversation stays in history).

**Design.** Icon becomes "＋", title "New chat". Behavior unchanged.

## 7. History list scale — light (P1)

**Design (rendering-only, no schema changes).**
- Filter input at the top of the history panel; substring match against title + preview.
- Items grouped under "Today / This week / Older" headers.
- Delete button shown only on row hover.
- Duplicate titles get the date appended ("Draft a reply · Jul 2").

**Thread-change chip (P2-12, same component).** The panel records which thread the current conversation started under. If the focused thread changes while turns exist, a small dismissible chip appears above the input: "Now chatting about: *<subject>* · **New chat**". Tapping New chat starts a fresh session. No chip when the conversation is empty (suggestion pills already serve that state).

## 8. Signature stripping for composer AI commands (P1)

**Problem.** "Sent from Mailspring…" signatures are sent to the model on Rewrite/Grammar/Next-line — wasted tokens, branding can leak into rewrites, and the signature can get mangled.

**Design.**
- Exported helper `splitSignature(body)` in `composer-assist.tsx` (same exported-helper pattern as `claude-cli-service.ts`) using `RegExpUtils.mailspringSignatureRegex()` → `{ content, signature }`.
- All composer AI commands (Rewrite/Shorter/Longer/Formal/Casual, Fix grammar, Suggest next line) send only `content` to the model.
- On result, the untouched `signature` HTML is re-appended after the AI output. No signature → behavior unchanged.

## 9. Composer AI menu formatting hint (P2)

**Design.** One-line muted footer in the ✨ AI dropdown: "Rewrite commands output plain text · Fix grammar keeps formatting".

## 10. Time-aware global suggestion pills (P2)

**Design.** Pure function `getGlobalSuggestions(now: Date)`:
- Morning (before 12:00): leads with "What's new today?"
- Monday: includes "Summarize last week"
- Friday: includes "Summarize this week"
- Otherwise: current set ("What's new today?", "Summarize this week", "Summarize this month", "Find unread emails").

## 11. Preferences layout (P2)

**Design.** The AI Assistant tab's 600px column gets `margin: 0 auto` to center in wide windows.

---

## Testing strategy

**Unit specs (Jasmine, existing harness):**
- `migrateChats()`: fresh copy, idempotent re-run, partial-copy recovery, verify-then-drop, fallback on error.
- `splitSignature()`: with/without signature, signature followed by quoted text.
- Time-aware pill selection: fixed dates in → expected pills out.
- History helpers: title dedupe, date grouping buckets.
- Latency phase machine: retrieving → waiting → streaming transitions, 30s soft-warning threshold.

**Live verification (Playwright `_electron` harness, per dev-verify workflow):**
- Migration end-to-end against a seeded `ai-index.db`.
- Status text progression during a real local-model request.
- Empty-state/pill/chip matrix, hover-delete, history filter + grouping.
- Composer: signature preserved after Fix grammar, action-bar min-height stability.

**Gate before commit:** full `npm test` (1599+ specs), `npm run lint:check`, `npm run typecheck` — all green (matches CI).
