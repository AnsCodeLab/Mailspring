import { computeAutoTune, autoTuneDescription } from '../lib/auto-tune';
import { RAG_DEFAULTS } from '../lib/config';

describe('computeAutoTune', () => {
  it('falls back to RAG_DEFAULTS chunk size when corpus is empty', () => {
    const result = computeAutoTune({ messageCount: 0, chunkCount: 0, medianChunkLen: 0 }, 'gpt-4o');
    expect(result.chunkSize).toBe(RAG_DEFAULTS.chunkSize);
  });

  it('derives chunk size from median length with 10% headroom', () => {
    // median 700 * 1.1 = 770, rounded to nearest 50 = 750
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4o'
    );
    expect(result.chunkSize).toBe(750);
  });

  it('clamps chunk size to 400 minimum', () => {
    const result = computeAutoTune(
      { messageCount: 10, chunkCount: 30, medianChunkLen: 100 },
      'gpt-4o'
    );
    expect(result.chunkSize).toBe(400);
  });

  it('clamps chunk size to 1600 maximum', () => {
    const result = computeAutoTune(
      { messageCount: 10, chunkCount: 30, medianChunkLen: 9000 },
      'gpt-4o'
    );
    expect(result.chunkSize).toBe(1600);
  });

  it('sets overlap to 18% of chunk size rounded to 25', () => {
    // chunk 750 → 750 * 0.18 = 135, rounded to 25 = 125
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4o'
    );
    expect(result.chunkOverlap).toBe(125);
  });

  it('recognises gpt-4o context window (128k tokens = 524288 chars)', () => {
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4o'
    );
    // 524288 * 0.25 = 131072 → clamped to 128000 → rounded to 128000
    expect(result.contextBudget).toBe(128000);
  });

  it('recognises gpt-4 (8k context) and caps budget at 12k minimum', () => {
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4'
    );
    // 32768 * 0.25 = 8192 → clamped to minimum 12000
    expect(result.contextBudget).toBe(12000);
  });

  it('recognises claude context window', () => {
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'claude-3-opus'
    );
    // 800000 * 0.25 = 200000 → clamped to 128000
    expect(result.contextBudget).toBe(128000);
  });

  it('uses safe default for unknown models', () => {
    const result = computeAutoTune(
      { messageCount: 10, chunkCount: 30, medianChunkLen: 700 },
      'unknown-model-xyz'
    );
    // default 131072 * 0.25 = 32768, rounded to 33000 (nearest 1000 above)
    expect(result.contextBudget >= 12000).toBe(true);
    expect(result.contextBudget <= 128000).toBe(true);
  });

  it('keeps K within [3, 20]', () => {
    const result = computeAutoTune(
      { messageCount: 5, chunkCount: 10, medianChunkLen: 100 },
      'gpt-4o'
    );
    expect(result.retrieveK >= 3).toBe(true);
    expect(result.retrieveK <= 20).toBe(true);
  });

  it('keeps history fraction, max steps, and web results at their proven defaults', () => {
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4o'
    );
    expect(result.historyFraction).toBe(RAG_DEFAULTS.historyFraction);
    expect(result.maxAgentSteps).toBe(RAG_DEFAULTS.maxAgentSteps);
    expect(result.webSearchResults).toBe(RAG_DEFAULTS.webSearchResults);
    expect(result.minScore).toBe(RAG_DEFAULTS.minScore);
  });

  it('rounds context budget to the nearest 1000', () => {
    const result = computeAutoTune(
      { messageCount: 100, chunkCount: 300, medianChunkLen: 700 },
      'gpt-4o'
    );
    expect(result.contextBudget % 1000).toBe(0);
  });
});

describe('autoTuneDescription', () => {
  it('returns empty string when no messages indexed', () => {
    expect(
      autoTuneDescription({ messageCount: 0, chunkCount: 0, medianChunkLen: 0 }, 'gpt-4o')
    ).toBe('');
  });

  it('includes message and segment counts', () => {
    const desc = autoTuneDescription(
      { messageCount: 500, chunkCount: 1500, medianChunkLen: 720 },
      'gpt-4o-mini'
    );
    expect(desc).toContain('500');
    expect(desc).toContain('1,500');
    expect(desc).toContain('720');
    expect(desc).toContain('gpt-4o-mini');
  });
});
