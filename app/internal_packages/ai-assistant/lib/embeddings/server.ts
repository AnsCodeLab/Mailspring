import { KeyManager } from 'mailspring-exports';
import { KEY_EMBED_API } from '../config';
import { EmbeddingProvider } from './provider';

export class ServerEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private url: string,
    private model: string
  ) {}

  id() {
    return `server:${this.model}`;
  }

  async ready(): Promise<void> {
    await this.embed(['ping']);
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const key = await KeyManager.getPassword(KEY_EMBED_API);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    const res = await fetch(`${this.url}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
      signal,
    });
    if (!res.ok) throw new Error(`Embedding server error ${res.status}`);
    const json = await res.json();
    return json.data.map((d: any) => d.embedding);
  }

  async dim(): Promise<number> {
    return (await this.embed(['x']))[0].length;
  }
}
