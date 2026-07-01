import { EmbeddingProvider } from './provider';

// Lazy-loaded transformers.js pipeline. The model downloads once on first use and is
// cached under the app data dir; nothing is sent off-device.
export class InAppEmbeddingProvider implements EmbeddingProvider {
  private pipe: any = null;

  constructor(private model: string = 'Xenova/all-MiniLM-L6-v2') {
    // Bare names without an org prefix default to the Xenova HF namespace.
    if (!model.includes('/')) this.model = `Xenova/${model}`;
  }

  id() {
    return `in-app:${this.model}`;
  }

  private async ensure() {
    if (this.pipe) return;
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = require('path').join(AppEnv.getConfigDirPath(), 'ai-models');
    this.pipe = await pipeline('feature-extraction', this.model);
  }

  async ready(): Promise<void> {
    await this.ensure();
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    await this.ensure();
    const out: number[][] = [];
    for (const t of texts) {
      const r = await this.pipe(t, { pooling: 'mean', normalize: true });
      out.push(Array.from(r.data as Float32Array));
    }
    return out;
  }

  async dim(): Promise<number> {
    return (await this.embed(['x']))[0].length;
  }
}
