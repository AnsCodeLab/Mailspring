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
  minScore: number;
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

export function computeAutoTune(
  stats: CorpusStats,
  modelName: string,
  opts: { preferSpeed?: boolean } = {}
): AutoTuneResult {
  // Chunk size: target median segment length + 10% headroom, clamped to [400, 1600], rounded to 50.
  // If no data yet, fall back to the proven default.
  const rawChunkSize =
    stats.medianChunkLen > 0 ? stats.medianChunkLen * 1.1 : RAG_DEFAULTS.chunkSize;
  const chunkSize = Math.round(Math.max(400, Math.min(1600, rawChunkSize)) / 50) * 50;

  // Overlap: 18% of chunk size, rounded to 25.
  const chunkOverlap = Math.round((chunkSize * 0.18) / 25) * 25;

  // Context budget: a model's rated context window doesn't tell us how fast it runs on this
  // machine, so "prioritize speed" shrinks the slice of that window we actually spend, rather
  // than assuming "local model" == "small window" (auto-tune already knows the real window).
  const budgetPct = opts.preferSpeed ? 0.05 : 0.25;
  const budgetClamp: [number, number] = opts.preferSpeed ? [3000, 8000] : [12000, 128000];
  const contextBudget =
    Math.round(
      Math.max(budgetClamp[0], Math.min(budgetClamp[1], modelContextChars(modelName) * budgetPct)) /
        1000
    ) * 1000;

  // K: fill ~25% of context budget with KB sources using the tuned chunk size.
  const retrieveK = Math.max(3, Math.min(20, Math.round((contextBudget * 0.25) / chunkSize)));

  const maxAgentSteps = opts.preferSpeed
    ? Math.max(2, Math.round(RAG_DEFAULTS.maxAgentSteps / 2))
    : RAG_DEFAULTS.maxAgentSteps;

  return {
    chunkSize,
    chunkOverlap,
    retrieveK,
    minScore: RAG_DEFAULTS.minScore,
    contextBudget,
    historyFraction: RAG_DEFAULTS.historyFraction,
    maxAgentSteps,
    webSearchResults: RAG_DEFAULTS.webSearchResults,
  };
}

export function autoTuneDescription(
  stats: CorpusStats,
  modelName: string,
  preferSpeed = false
): string {
  if (stats.messageCount === 0) return '';
  const base = `Computed from ${stats.messageCount.toLocaleString()} messages (${stats.chunkCount.toLocaleString()} segments, median ${stats.medianChunkLen} chars). Context budget scaled to ${modelName}.`;
  return preferSpeed ? `${base} Speed mode: budget trimmed for faster responses.` : base;
}
