import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AIConfig } from './config';

export type CliMessage = { role: string; content: string };

export class GeminiCliError extends Error {
  kind: 'not-found' | 'error';
  constructor(kind: GeminiCliError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export const GEMINI_PROMPT_INSTRUCTION =
  'Respond in plain text only. Do not call any tools or exit plan mode.';

export const CURATED_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
] as const;

export const EXCLUDED_GEMINI_TOOLS = [
  'run_shell_command',
  'write_file',
  'replace',
  'exit_plan_mode',
] as const;

// Fold system messages into the prompt body (Gemini has no --system-prompt), then label turns.
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

// Security boundary: plan mode + skip-trust + no extensions. Never yolo/auto_edit.
// Transcript goes on stdin; -p is only the short text-only instruction (ARG_MAX-safe).
export function baseArgs(outputFormat: 'json' | 'stream-json'): string[] {
  const args = [
    '-p',
    GEMINI_PROMPT_INSTRUCTION,
    '--approval-mode',
    'plan',
    '--skip-trust',
    '-e',
    'none',
    '--output-format',
    outputFormat,
  ];
  const model = AIConfig.getGeminiCliModel();
  if (model) args.push('-m', model);
  return args;
}

export function workspaceSettings(): object {
  return {
    security: { disableYoloMode: true },
    tools: { exclude: [...EXCLUDED_GEMINI_TOOLS] },
  };
}

// Dedicated workdir under os.tmpdir() with workspace .gemini/settings.json hardenings.
export function prepareWorkdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailspring-gemini-'));
  const geminiDir = path.join(dir, '.gemini');
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(
    path.join(geminiDir, 'settings.json'),
    JSON.stringify(workspaceSettings(), null, 2),
    'utf8'
  );
  return dir;
}

export function spawnOptions(cwd: string): { cwd: string; windowsHide: boolean } {
  return { cwd, windowsHide: true };
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
  prompt: string,
  signal?: AbortSignal
): { child: ReturnType<typeof spawn>; cwd: string } {
  const bin = AIConfig.getGeminiCliPath();
  const cwd = prepareWorkdir();
  const child = spawn(bin, args, spawnOptions(cwd));
  child.stdin.on('error', () => {
    // Swallow EPIPE if the process exits before we finish writing.
  });
  child.stdin.write(prompt);
  child.stdin.end();
  if (signal) {
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => signal.removeEventListener('abort', onAbort));
  }
  return { child, cwd };
}

export function notFoundError(): GeminiCliError {
  return new GeminiCliError(
    'not-found',
    `Gemini CLI not found at "${AIConfig.getGeminiCliPath()}". Install @google/gemini-cli (binary "gemini") or set the correct path in Preferences > AI Assistant.`
  );
}

// Rewrite auth / Antigravity / API-key failures into Mailspring-actionable copy.
export function resultError(rawMessage: string | undefined): GeminiCliError {
  const message = rawMessage || 'Gemini CLI returned an error.';
  if (
    /ineligible/i.test(message) ||
    /antigravity/i.test(message) ||
    /unsupported_client/i.test(message)
  ) {
    return new GeminiCliError(
      'error',
      'Gemini CLI Google login is unavailable for this account (Code Assist free tier may require Antigravity). Set GEMINI_API_KEY from AI Studio, or use Vertex / a paid Code Assist account, then try again.'
    );
  }
  if (
    /not logged in/i.test(message) ||
    /authenticat/i.test(message) ||
    /api[_ ]?key/i.test(message) ||
    /GEMINI_API_KEY/i.test(message)
  ) {
    return new GeminiCliError(
      'error',
      'Gemini CLI is not authenticated. Run "gemini" to sign in with Google, or set the GEMINI_API_KEY environment variable, then try again.'
    );
  }
  return new GeminiCliError('error', message);
}

// Parse one NDJSON stdout line from Gemini stream-json.
// Yield only assistant message deltas (delta === true). Ignore warnings and non-delta finals.
export function parseStreamLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev: any;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (ev.type === 'error' && ev.severity === 'error') {
    throw resultError(ev.message);
  }
  if (ev.type === 'result' && ev.status === 'error') {
    throw resultError(ev.error?.message || ev.message);
  }
  if (ev.type === 'message' && ev.role === 'assistant' && ev.delta === true) {
    const text = typeof ev.content === 'string' ? ev.content : '';
    return text || null;
  }
  return null;
}

export function parseJsonResponse(stdout: string): string {
  const text = stdout.trim();
  if (!text) throw new GeminiCliError('error', 'Gemini CLI returned no output.');
  // Prefer the last JSON object line (stream-compatible) or the whole buffer.
  const lastLine = text.split('\n').filter(Boolean).pop() || text;
  let json: any;
  try {
    json = JSON.parse(lastLine);
  } catch {
    try {
      json = JSON.parse(text);
    } catch {
      throw new GeminiCliError('error', 'Gemini CLI returned unparseable JSON.');
    }
  }
  if (json.error) {
    throw resultError(json.error.message || String(json.error));
  }
  if (typeof json.response === 'string') return json.response;
  throw new GeminiCliError('error', 'Gemini CLI JSON response missing "response" field.');
}

// Prefer stderr (where Gemini prints auth/Antigravity failures) when stdout is empty or unusable.
export function failureFromCliOutput(
  stdout: string,
  stderr: string,
  code?: number | null
): GeminiCliError {
  if (!stdout.trim()) {
    return resultError(
      stderr.trim() ||
        (code ? `Gemini CLI exited with code ${code}.` : 'Gemini CLI returned no output.')
    );
  }
  try {
    // If stdout parses as a JSON error payload, parseJsonResponse throws already-rewritten errors.
    parseJsonResponse(stdout);
    // Unexpected success path — treat as generic.
    return resultError(stderr.trim() || 'Gemini CLI failed.');
  } catch (err) {
    if (stderr.trim()) return resultError(stderr.trim());
    if (err instanceof GeminiCliError) return err;
    return new GeminiCliError(
      'error',
      code ? `Gemini CLI exited with code ${code}.` : 'Gemini CLI returned no output.'
    );
  }
}

export const GeminiCliService = {
  async chat({
    messages,
    signal,
  }: {
    messages: CliMessage[];
    signal?: AbortSignal;
  }): Promise<string> {
    const { prompt } = buildTranscript(messages);
    const args = baseArgs('json');
    return new Promise((resolve, reject) => {
      let child;
      let cwd = '';
      try {
        ({ child, cwd } = spawnCli(args, prompt, signal));
      } catch (err: any) {
        reject(new GeminiCliError('not-found', `Could not launch Gemini CLI: ${err.message}`));
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err: any) => {
        cleanupWorkdir(cwd);
        reject(err.code === 'ENOENT' ? notFoundError() : new GeminiCliError('error', err.message));
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
    const { prompt } = buildTranscript(messages);
    const args = baseArgs('stream-json');
    let child;
    let cwd = '';
    try {
      ({ child, cwd } = spawnCli(args, prompt, signal));
    } catch (err: any) {
      throw new GeminiCliError('not-found', `Could not launch Gemini CLI: ${err.message}`);
    }

    let stderr = '';
    let buffer = '';
    let error: Error | null = null;
    const queue: string[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

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
          const delta = parseStreamLine(line);
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
      error = err.code === 'ENOENT' ? notFoundError() : new GeminiCliError('error', err.message);
      wake();
    });
    child.on('close', (code) => {
      if (!error && buffer.trim()) {
        try {
          const delta = parseStreamLine(buffer);
          if (delta) queue.push(delta);
        } catch (err: any) {
          error = err;
        }
      }
      if (!error && signal?.aborted) {
        const abortErr: any = new Error('Aborted');
        abortErr.name = 'AbortError';
        error = abortErr;
      } else if (!error && code && code !== 0 && queue.length === 0) {
        error = resultError(stderr.trim() || `Gemini CLI exited with code ${code}.`);
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
    return [...CURATED_GEMINI_MODELS];
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await GeminiCliService.chat({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },
};
