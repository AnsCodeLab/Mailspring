import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AIConfig } from './config';

export type CliMessage = { role: string; content: string };

export class AntigravityCliError extends Error {
  kind: 'not-found' | 'error';
  constructor(kind: AntigravityCliError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export const ANTIGRAVITY_PROMPT_INSTRUCTION =
  'Respond in plain text only. Do not call any tools. Do not write or execute commands.';

export const CURATED_ANTIGRAVITY_MODELS = [
  'gemini-3.8-flash-medium',
  'gemini-3.6-flash-medium',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
] as const;

export const MAX_PROMPT_BYTES = 80_000;

export const GETTING_STARTED_URL = 'https://antigravity.google/docs/getting-started';

// Fold system messages into the prompt body, then label turns.
export function buildTranscript(messages: CliMessage[]): { prompt: string } {
  const systemParts: string[] = [];
  const turns: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    const label =
      m.role === 'assistant' ? 'Assistant' : m.role === 'tool' ? 'Tool result' : 'Human';
    turns.push(`${label}: ${m.content}`);
  }
  const parts: string[] = [];
  if (systemParts.length) {
    parts.push(`System:\n${systemParts.join('\n\n')}`);
  }
  if (turns.length) parts.push(turns.join('\n\n'));
  return { prompt: parts.join('\n\n') };
}

export function buildPrintPrompt(transcript: string): string {
  const prompt = `${ANTIGRAVITY_PROMPT_INSTRUCTION}\n\n${transcript}`;
  if (Buffer.byteLength(prompt, 'utf8') >= MAX_PROMPT_BYTES) {
    throw new AntigravityCliError(
      'error',
      `Prompt is too large for Antigravity CLI argv (limit ${MAX_PROMPT_BYTES} bytes). Shorten the thread context or switch to the OpenAI-compatible API provider.`
    );
  }
  return prompt;
}

// Security boundary: plan + sandbox + no slash commands. Never dangerously-skip-permissions.
export function baseArgs(outputFormat: 'json' | 'stream-json', printPrompt: string): string[] {
  const args = [
    '-p',
    printPrompt,
    '--mode',
    'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--output-format',
    outputFormat,
  ];
  const model = AIConfig.getAntigravityCliModel();
  if (model) args.push('--model', model);
  return args;
}

export function spawnOptions(cwd: string): { cwd: string; windowsHide: boolean } {
  return { cwd, windowsHide: true };
}

export function prepareWorkdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailspring-agy-'));
}

function cleanupWorkdir(cwd: string) {
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function spawnCli(
  args: string[],
  signal?: AbortSignal
): { child: ReturnType<typeof spawn>; cwd: string } {
  const bin = AIConfig.getAntigravityCliPath();
  const cwd = prepareWorkdir();
  const child = spawn(bin, args, spawnOptions(cwd));
  // Prompt is entirely on argv (-p); close stdin so the process does not wait on a pipe.
  try {
    child.stdin.end();
  } catch {
    /* ignore */
  }
  if (signal) {
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => signal.removeEventListener('abort', onAbort));
  }
  return { child, cwd };
}

export function notFoundError(): AntigravityCliError {
  return new AntigravityCliError(
    'not-found',
    `Antigravity CLI not found at "${AIConfig.getAntigravityCliPath()}". Install via ${GETTING_STARTED_URL} (binary "agy") or set the correct path in Preferences > AI Assistant.`
  );
}

export function resultError(rawMessage: string | undefined): AntigravityCliError {
  const message = rawMessage || 'Antigravity CLI returned an error.';
  if (
    /authentication required/i.test(message) ||
    /not logged in/i.test(message) ||
    /please (log|sign) in/i.test(message) ||
    /FatalAuthenticationError/i.test(message)
  ) {
    return new AntigravityCliError(
      'error',
      `Antigravity CLI is not authenticated. Open a terminal, run "agy", complete sign-in, then try again. Install guide: ${GETTING_STARTED_URL}`
    );
  }
  return new AntigravityCliError('error', message);
}

export type StreamParseState = {
  activeStepsWithDelta: Set<number>;
  yieldedAny: boolean;
  sawSuccessResult: boolean;
};

export function createStreamParseState(): StreamParseState {
  return {
    activeStepsWithDelta: new Set(),
    yieldedAny: false,
    sawSuccessResult: false,
  };
}

// Parse one NDJSON stdout line from Antigravity stream-json.
export function parseStreamLine(line: string, state: StreamParseState): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev: any;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null; // skip malformed
  }
  if (ev.event === 'init') return null;
  if (ev.event === 'result') {
    const result = ev.result || {};
    if (result.status === 'SUCCESS') {
      state.sawSuccessResult = true;
      if (!state.yieldedAny && typeof result.response === 'string' && result.response) {
        state.yieldedAny = true;
        return result.response;
      }
      return null;
    }
    throw resultError(result.error || result.response || 'Antigravity CLI run failed.');
  }
  if (ev.event === 'step_update') {
    const step = ev.step_update || {};
    if (step.step_type === 'tool') return null;
    if (step.step_type !== 'agent_response') return null;
    const delta = typeof step.text_delta === 'string' ? step.text_delta : '';
    if (!delta) return null;
    const idx = typeof step.step_index === 'number' ? step.step_index : -1;
    if (step.state === 'ACTIVE') {
      if (idx >= 0) state.activeStepsWithDelta.add(idx);
      state.yieldedAny = true;
      return delta;
    }
    if (step.state === 'DONE') {
      // Avoid re-yielding a full DONE payload when ACTIVE deltas already streamed.
      if (idx >= 0 && state.activeStepsWithDelta.has(idx)) return null;
      state.yieldedAny = true;
      return delta;
    }
  }
  return null;
}

export function parseJsonResponse(stdout: string): string {
  const text = stdout.trim();
  if (!text) throw new AntigravityCliError('error', 'Antigravity CLI returned no output.');
  const lastLine = text.split('\n').filter(Boolean).pop() || text;
  let json: any;
  try {
    json = JSON.parse(lastLine);
  } catch {
    try {
      json = JSON.parse(text);
    } catch {
      throw new AntigravityCliError('error', 'Antigravity CLI returned unparseable JSON.');
    }
  }
  if (json.status && json.status !== 'SUCCESS') {
    throw resultError(json.error || json.response || `Antigravity CLI status ${json.status}`);
  }
  if (typeof json.response === 'string') return json.response;
  throw new AntigravityCliError('error', 'Antigravity CLI JSON response missing "response" field.');
}

export function failureFromCliOutput(
  stdout: string,
  stderr: string,
  code?: number | null
): AntigravityCliError {
  if (!stdout.trim()) {
    return resultError(
      stderr.trim() ||
        (code ? `Antigravity CLI exited with code ${code}.` : 'Antigravity CLI returned no output.')
    );
  }
  try {
    parseJsonResponse(stdout);
    return resultError(stderr.trim() || 'Antigravity CLI failed.');
  } catch (err) {
    if (stderr.trim()) return resultError(stderr.trim());
    if (err instanceof AntigravityCliError) return err;
    return new AntigravityCliError(
      'error',
      code ? `Antigravity CLI exited with code ${code}.` : 'Antigravity CLI returned no output.'
    );
  }
}

export function parseListModelsOutput(stdout: string): string[] {
  const models: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^fetching/i.test(trimmed)) continue;
    // "slug\tDisplay Name" or "slug  Display Name"
    const m = trimmed.match(/^(\S+)\s+/);
    if (m) models.push(m[1]);
  }
  return models;
}

export const AntigravityCliService = {
  async chat({
    messages,
    signal,
  }: {
    messages: CliMessage[];
    signal?: AbortSignal;
  }): Promise<string> {
    const { prompt: transcript } = buildTranscript(messages);
    const printPrompt = buildPrintPrompt(transcript);
    const args = baseArgs('json', printPrompt);
    return new Promise((resolve, reject) => {
      let child;
      let cwd = '';
      try {
        ({ child, cwd } = spawnCli(args, signal));
      } catch (err: any) {
        reject(
          new AntigravityCliError('not-found', `Could not launch Antigravity CLI: ${err.message}`)
        );
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err: any) => {
        cleanupWorkdir(cwd);
        reject(
          err.code === 'ENOENT' ? notFoundError() : new AntigravityCliError('error', err.message)
        );
      });
      child.on('close', (code) => {
        cleanupWorkdir(cwd);
        if (signal?.aborted) {
          const abortErr: any = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
          return;
        }
        try {
          resolve(parseJsonResponse(stdout));
        } catch {
          reject(failureFromCliOutput(stdout, stderr, code));
        }
      });
    });
  },

  async *chatStream({
    messages,
    signal,
  }: {
    messages: CliMessage[];
    signal?: AbortSignal;
  }): AsyncIterable<string> {
    const { prompt: transcript } = buildTranscript(messages);
    const printPrompt = buildPrintPrompt(transcript);
    const args = baseArgs('stream-json', printPrompt);
    let child;
    let cwd = '';
    try {
      ({ child, cwd } = spawnCli(args, signal));
    } catch (err: any) {
      throw new AntigravityCliError(
        'not-found',
        `Could not launch Antigravity CLI: ${err.message}`
      );
    }

    let stderr = '';
    let buffer = '';
    let error: Error | null = null;
    const queue: string[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    const state = createStreamParseState();

    const wake = () => {
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    child.stdout.on('data', (d) => {
      buffer += d.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const delta = parseStreamLine(line, state);
          if (delta) {
            queue.push(delta);
            wake();
          }
        } catch (err: any) {
          error = err;
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          wake();
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err: any) => {
      cleanupWorkdir(cwd);
      error =
        err.code === 'ENOENT' ? notFoundError() : new AntigravityCliError('error', err.message);
      wake();
    });
    child.on('close', (code) => {
      if (!error && buffer.trim()) {
        try {
          const delta = parseStreamLine(buffer, state);
          if (delta) queue.push(delta);
        } catch (err: any) {
          error = err;
        }
      }
      if (!error && signal?.aborted) {
        const abortErr: any = new Error('Aborted');
        abortErr.name = 'AbortError';
        error = abortErr;
      } else if (!error && !state.sawSuccessResult && !state.yieldedAny) {
        error = resultError(
          stderr.trim() ||
            (code
              ? `Antigravity CLI exited with code ${code}.`
              : 'Antigravity CLI returned no output.')
        );
      }
      cleanupWorkdir(cwd);
      done = true;
      wake();
    });

    while (!done || queue.length) {
      if (queue.length) {
        const next = queue.shift();
        if (next !== undefined) yield next;
        continue;
      }
      if (error) throw error;
      if (done) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    if (error) throw error;
  },

  async listModels(): Promise<string[]> {
    const bin = AIConfig.getAntigravityCliPath();
    const cwd = prepareWorkdir();
    try {
      const stdout: string = await new Promise((resolve, reject) => {
        const child = spawn(bin, ['models'], spawnOptions(cwd));
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.stderr.on('data', (d) => (err += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code && code !== 0 && !out.trim()) {
            reject(new Error(err.trim() || `agy models exited ${code}`));
            return;
          }
          resolve(out);
        });
      });
      const parsed = parseListModelsOutput(stdout);
      return parsed.length ? parsed : [...CURATED_ANTIGRAVITY_MODELS];
    } catch {
      return [...CURATED_ANTIGRAVITY_MODELS];
    } finally {
      cleanupWorkdir(cwd);
    }
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await AntigravityCliService.chat({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },
};
