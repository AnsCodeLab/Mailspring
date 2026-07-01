import { RAG_DEFAULTS } from './config';

export type CorpusStats = {
  messageCount: number;
  chunkCount: number;
  medianChunkLen: number;
};

export type AutoTuneResult = {
  chunkSize: number;
  chunkOverlap: number;
  retrieveK: number;
  contextBudget: number;
  historyFraction: number;
  maxAgentSteps: number;
  webSearchResults: number;
};

// Approximate context window in chars (tokens * 4) per known model families.
const MODEL_CONTEXT_CHARS: Array<[string, number]> = [
  ['gpt-4o', 524288], // 128k tokens
  ['gpt-4-turbo', 524288],
  ['gpt-4', 32768], // 8k
  ['gpt-3.5-turbo', 64000], // 16k
  ['o1', 524288],
  ['o3', 800000],
  ['claude-3', 800000], // 200k
  ['claude-2', 400000], // 100k
  ['claude', 800000],
  ['gemini-1.5', 4000000], // 1M
  ['gemini', 524288], // 128k
  ['llama-3', 524288],
  ['llama', 131072], // 32k
  ['mistral', 131072],
  ['qwen', 524288],
  ['deepseek', 524288],
];

function modelContextChars(modelName: string): number {
  const lower = modelName.toLowerCase();
  for (const [key, chars] of MODEL_CONTEXT_CHARS) {
    if (lower.includes(key)) return chars;
  }
  return 131072; // safe default: 32k tokens
}

export function computeAutoTune(stats: CorpusStats, modelName: string): AutoTuneResult {
  // Chunk size: target median segment length + 10% headroom, clamped to [400, 1600], rounded to 50.
  // If no data yet, fall back to the proven default.
  const rawChunkSize =
    stats.medianChunkLen > 0 ? stats.medianChunkLen * 1.1 : RAG_DEFAULTS.chunkSize;
  const chunkSize = Math.round(Math.max(400, Math.min(1600, rawChunkSize)) / 50) * 50;

  // Overlap: 18% of chunk size, rounded to 25.
  const chunkOverlap = Math.round((chunkSize * 0.18) / 25) * 25;

  // Context budget: 25% of model context window, clamped to [12k, 128k], rounded to 1k.
  const contextBudget =
    Math.round(Math.max(12000, Math.min(128000, modelContextChars(modelName) * 0.25)) / 1000) *
    1000;

  // K: fill ~25% of context budget with KB sources using the tuned chunk size.
  const retrieveK = Math.max(3, Math.min(20, Math.round((contextBudget * 0.25) / chunkSize)));

  return {
    chunkSize,
    chunkOverlap,
    retrieveK,
    contextBudget,
    historyFraction: RAG_DEFAULTS.historyFraction,
    maxAgentSteps: RAG_DEFAULTS.maxAgentSteps,
    webSearchResults: RAG_DEFAULTS.webSearchResults,
  };
}

export function autoTuneDescription(stats: CorpusStats, modelName: string): string {
  if (stats.messageCount === 0) return '';
  return `Computed from ${stats.messageCount.toLocaleString()} messages (${stats.chunkCount.toLocaleString()} segments, median ${stats.medianChunkLen} chars). Context budget scaled to ${modelName}.`;
}
