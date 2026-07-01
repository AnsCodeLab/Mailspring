import path from 'path';
import { DatabaseStore } from 'mailspring-exports';
import { VectorStore } from './vector-store';
import { getEmbeddingProvider } from './embeddings/provider';
import { htmlToText, chunkText, contentHash } from './chunking';

export function reconcile(dbIds: Set<string>, indexedIds: Set<string>): { toRemove: string[] } {
  return { toRemove: [...indexedIds].filter((id) => !dbIds.has(id)) };
}

export function needsModelReindex(storeModel: string | undefined, activeModel: string): boolean {
  return !storeModel || storeModel !== activeModel;
}

class IndexerImpl {
  private vs: VectorStore | null = null;
  private unsub: (() => void) | null = null;
  private running = false;
  private done = 0;
  private total = 0;
  private paused = false;

  store(): VectorStore {
    if (!this.vs) {
      this.vs = new VectorStore(path.join(AppEnv.getConfigDirPath(), 'ai-index.db'));
    }
    return this.vs;
  }

  progress() {
    return { done: this.done, total: this.total, running: this.running };
  }

  async start() {
    const store = this.store();
    const provider = getEmbeddingProvider();
    // Model guard: if the embedding model changed, the stored vectors are incompatible.
    if (needsModelReindex(store.getMeta('model'), provider.id())) {
      store.clear();
      store.setMeta('model', provider.id());
    }
    // Incremental: react to mail DB deltas.
    const sub = DatabaseStore.listen((change: any) => this._onChange(change));
    this.unsub = () => (sub.dispose ? sub.dispose() : sub());
    // Wait for backend to be ready (model loaded / server reachable) before bulk indexing.
    try {
      await provider.ready();
    } catch (e) {
      console.error('[AI] Embedding backend not ready, indexing paused:', (e as Error).message);
      this.stop();
      return;
    }
    this._bulkAndReconcile();
  }

  stop() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.paused = true;
  }

  clear() {
    this.store().clear();
    this.done = 0;
    this.total = 0;
  }

  async reindexAll() {
    this.clear();
    await this._bulkAndReconcile();
  }

  private async _onChange(change: any) {
    const cls = change.objectClass && (change.objectClass.name || change.objectClass);
    if (cls !== 'Message') return;
    if (change.type === 'unpersist') {
      for (const m of change.objects) this.store().removeMessage(m.id);
      return;
    }
    if (change.type === 'persist') {
      for (const m of change.objects) {
        if (!m.draft) await this._indexMessage(m);
      }
    }
  }

  private async _indexMessage(message: any) {
    const text = htmlToText(message.body || '');
    if (!text) return;
    const hash = contentHash(text);
    if (this.store().isIndexed(message.id, hash)) return; // idempotent
    const provider = getEmbeddingProvider();
    const chunks = chunkText(text);
    const vectors = await provider.embed(chunks);
    const dim = vectors[0]?.length || 0;
    this.store().upsertMessage(
      {
        messageId: message.id,
        threadId: message.threadId,
        accountId: message.accountId,
        date: message.date ? new Date(message.date).toISOString().slice(0, 10) : '',
        sender: message.from?.[0]?.name || message.from?.[0]?.email || '',
        subject: message.subject || '',
        contentHash: hash,
        model: provider.id(),
        dim,
      },
      chunks.map((c, i) => ({ text: c, vector: vectors[i] }))
    );
  }

  private async _bulkAndReconcile() {
    this.paused = false;
    this.running = true;
    try {
      const { Message } = require('mailspring-exports');
      const all = await DatabaseStore.findAll(Message).include(Message.attributes.body);
      this.total = all.length;
      this.done = 0;
      const dbIds = new Set<string>(all.map((m: any) => m.id));
      // Reconcile removals first.
      for (const id of reconcile(dbIds, this.store().indexedMessageIds()).toRemove) {
        this.store().removeMessage(id);
      }
      // Index missing/changed, idle-throttled in small batches.
      for (const m of all) {
        if (this.paused) break;
        if (!m.draft) await this._indexMessage(m);
        this.done++;
        if (this.done % 25 === 0) await new Promise((r) => setTimeout(r, 50)); // yield to UI
      }
    } finally {
      this.running = false;
    }
  }
}

export const Indexer = new IndexerImpl();
