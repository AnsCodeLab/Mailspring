import { spawn } from 'child_process';
import os from 'os';
import { AIConfig } from './config';

export type CliMessage = { role: string; content: string };

export class CursorCliError extends Error {
  kind: 'not-found' | 'error';
  constructor(kind: CursorCliError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

// Cursor has no --system-prompt flag — fold system messages into the prompt body, then label turns.
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

// Security boundary: always print + ask mode + trust. Never force/yolo/sandbox-disabled.
export function baseArgs(outputFormat: 'json' | 'stream-json'): string[] {
  const args = ['-p', '--mode', 'ask', '--trust', '--output-format', outputFormat];
  if (outputFormat === 'stream-json') args.push('--stream-partial-output');
  const model = AIConfig.getCursorCliModel();
  if (model) args.push('--model', model);
  return args;
}

export function spawnOptions(): { cwd: string; windowsHide: boolean } {
  // Never run inside the app's own working directory — defense in depth alongside --mode ask.
  return { cwd: os.tmpdir(), windowsHide: true };
}

function spawnCli(args: string[], prompt: string, signal?: AbortSignal) {
  const bin = AIConfig.getCursorCliPath();
  const child = spawn(bin, args, spawnOptions());
  child.stdin.on('error', () => {
    // Swallow EPIPE if the process exits before we finish writing; 'close'/'error' below report it.
  });
  child.stdin.write(prompt);
  child.stdin.end();
  if (signal) {
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => signal.removeEventListener('abort', onAbort));
  }
  return child;
}

export function notFoundError(): CursorCliError {
  return new CursorCliError(
    'not-found',
    `Cursor CLI not found at "${AIConfig.getCursorCliPath()}". Install it or set the correct path in Preferences > AI Assistant.`
  );
}

// Rewrite auth failures into an instruction a Mailspring user can follow (`agent login`).
export function resultError(rawMessage: string | undefined): CursorCliError {
  const message = rawMessage || 'Cursor CLI returned an error.';
  if (
    /not logged in/i.test(message) ||
    /authenticat/i.test(message) ||
    /run\s+agent\s+login/i.test(message)
  ) {
    return new CursorCliError(
      'error',
      'Not logged in to Cursor Agent. Open a terminal, run "agent login", then try again.'
    );
  }
  return new CursorCliError('error', message);
}

function extractAssistantText(ev: any): string {
  const content = ev?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c: any) => c && (c.type === 'text' || typeof c.text === 'string'))
    .map((c: any) => String(c.text || ''))
    .join('');
}

// Parse one NDJSON stdout line from Cursor ask+stream-json+stream-partial-output.
// Timestamped assistant events are partial deltas; non-timestamped finals are duplicates.
export function parseStreamLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev: any;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (ev.type === 'result' && ev.is_error) {
    throw resultError(ev.result);
  }
  if (ev.type === 'assistant' && ev.timestamp_ms != null) {
    const text = extractAssistantText(ev);
    return text || null;
  }
  return null;
}

// Parse `agent --list-models` text lines shaped like `id - Label`.
// IDs may contain hyphens (e.g. gpt-5.3-codex-low); split on the first " - ".
export function parseListModelsOutput(text: string): string[] {
  const ids: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+-\s+/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export const CursorCliService = {
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
      try {
        child = spawnCli(args, prompt, signal);
      } catch (err: any) {
        reject(new CursorCliError('not-found', `Could not launch Cursor CLI: ${err.message}`));
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err: any) => {
        reject(err.code === 'ENOENT' ? notFoundError() : new CursorCliError('error', err.message));
      });
      child.on('close', () => {
        if (signal?.aborted) {
          const abortErr: any = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
          return;
        }
        try {
          const lastLine = stdout.trim().split('\n').pop() || '{}';
          const json = JSON.parse(lastLine);
          if (json.is_error) {
            reject(resultError(json.result));
            return;
          }
          // Cursor --output-format json returns a result event with a `result` string.
          resolve(typeof json.result === 'string' ? json.result : json.result || '');
        } catch {
          reject(new CursorCliError('error', stderr.trim() || 'Cursor CLI returned no output.'));
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
    try {
      child = spawnCli(args, prompt, signal);
    } catch (err: any) {
      throw new CursorCliError('not-found', `Could not launch Cursor CLI: ${err.message}`);
    }

    const queue: string[] = [];
    let closed = false;
    let error: Error | null = null;
    let buffer = '';
    let stderr = '';
    let gotOutput = false;
    let wake: (() => void) | null = null;

    const notify = () => {
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const text = parseStreamLine(line);
          if (text) {
            queue.push(text);
            gotOutput = true;
          }
        } catch (err: any) {
          error = err;
        }
      }
      notify();
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err: any) => {
      error = err.code === 'ENOENT' ? notFoundError() : new CursorCliError('error', err.message);
      closed = true;
      notify();
    });
    child.on('close', () => {
      closed = true;
      notify();
    });

    try {
      for (;;) {
        if (queue.length) {
          const next = queue.shift();
          if (next !== undefined) yield next;
          continue;
        }
        if (error) throw error;
        if (closed) {
          if (signal?.aborted) {
            const abortErr: any = new Error('Aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }
          if (!gotOutput) {
            throw new CursorCliError('error', stderr.trim() || 'Cursor CLI returned no output.');
          }
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      if (!closed) child.kill();
    }
  },

  // Model IDs from `agent --list-models`. Returns [] when the binary is missing or output is empty —
  // the preferences UI falls back to a free-text input in that case.
  async listModels(): Promise<string[]> {
    const bin = AIConfig.getCursorCliPath();
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(bin, ['--list-models'], spawnOptions());
      } catch {
        resolve([]);
        return;
      }
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.on('error', () => resolve([]));
      child.on('close', () => {
        resolve(parseListModelsOutput(stdout));
      });
    });
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.chat({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        signal: AbortSignal.timeout(30000),
      });
      return {
        ok: true,
        error: result.trim() ? `Connected (replied "${result.trim().slice(0, 40)}")` : 'Connected',
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },
};
