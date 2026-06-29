import { AIConfig } from '../config';

export interface EmbeddingProvider {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  dim(): Promise<number>;
  id(): string;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (AIConfig.getEmbeddingBackend() === 'server') {
    const { ServerEmbeddingProvider } = require('./server');
    return new ServerEmbeddingProvider(
      AIConfig.getEmbeddingServerUrl(),
      AIConfig.getEmbeddingModel()
    );
  }
  const { InAppEmbeddingProvider } = require('./in-app');
  return new InAppEmbeddingProvider(AIConfig.getEmbeddingModel());
}
