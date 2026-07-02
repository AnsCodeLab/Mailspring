import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AIConfig } from './config';

export type CliMessage = { role: string; content: string };

export class ClaudeCliError extends Error {
  kind: 'not-found' | 'error';
  constructor(kind: ClaudeCliError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

// The CLI is a single-shot completion tool, not a chat API — fold the message list into a
// plain transcript (system content goes to --system-prompt, everything else becomes labeled turns).
export function buildTranscript(messages: CliMessage[]): { systemPrompt: string; prompt: string } {
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
  return { systemPrompt: systemParts.join('\n\n'), prompt: turns.join('\n\n') };
}

export function baseArgs(outputFormat: 'json' | 'stream-json', systemPrompt: string): string[] {
  const args = [
    '-p',
    '--output-format',
    outputFormat,
    // Disable every built-in tool (Bash/Read/Write/Edit/WebFetch/...) — this service only ever
    // sees email content, which is untrusted; the CLI must never get filesystem/shell access.
    '--tools',
    '',
    // Skip CLAUDE.md/skills/plugins/hooks/MCP/custom-commands auto-discovery from cwd or ~/.claude.
    '--safe-mode',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  if (outputFormat === 'stream-json') args.push('--include-partial-messages', '--verbose');
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  const model = AIConfig.getClaudeCliModel();
  if (model) args.push('--model', model);
  return args;
}

function spawnCli(args: string[], prompt: string, signal?: AbortSignal) {
  const bin = AIConfig.getClaudeCliPath();
  const child = spawn(bin, args, {
    // Never run inside the app's own working directory — defense in depth alongside --safe-mode.
    cwd: os.tmpdir(),
    windowsHide: true,
  });
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

// Reads the Claude Code CLI's own OAuth access token so we can query the official
// /v1/models endpoint for the models the user's subscription actually offers.
// Read-only; the token is ONLY ever sent to the hardcoded api.anthropic.com host below.
function readCliOAuthToken(): string | null {
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json');
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    const oauth = json?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && Date.now() > oauth.expiresAt) return null;
    return String(oauth.accessToken);
  } catch {
    return null;
  }
}

function notFoundError(): ClaudeCliError {
  return new ClaudeCliError(
    'not-found',
    `Claude CLI not found at "${AIConfig.getClaudeCliPath()}". Install it or set the correct path in Preferences > AI Assistant.`
  );
}

// The CLI's own "Not logged in" message tells the user to run /login, a slash command that
// only makes sense inside an interactive Claude Code session - meaningless in Mailspring.
// Rewrite it into an instruction a Mailspring user can actually follow.
export function resultError(rawMessage: string | undefined): ClaudeCliError {
  const message = rawMessage || 'Claude CLI returned an error.';
  if (/not logged in/i.test(message) || /run\s+\/login/i.test(message)) {
    return new ClaudeCliError(
      'error',
      'Not logged in to Claude Code. Open a terminal, run "claude", and sign in, then try again.'
    );
  }
  return new ClaudeCliError('error', message);
}

export const ClaudeCliService = {
  async chat({
    messages,
    signal,
  }: {
    messages: CliMessage[];
    signal?: AbortSignal;
  }): Promise<string> {
    const { systemPrompt, prompt } = buildTranscript(messages);
    const args = baseArgs('json', systemPrompt);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnCli(args, prompt, signal);
      } catch (err: any) {
        reject(new ClaudeCliError('not-found', `Could not launch Claude CLI: ${err.message}`));
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err: any) => {
        reject(err.code === 'ENOENT' ? notFoundError() : new ClaudeCliError('error', err.message));
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
          resolve(json.result || '');
        } catch {
          reject(new ClaudeCliError('error', stderr.trim() || 'Claude CLI returned no output.'));
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
    const { systemPrompt, prompt } = buildTranscript(messages);
    const args = baseArgs('stream-json', systemPrompt);
    let child;
    try {
      child = spawnCli(args, prompt, signal);
    } catch (err: any) {
      throw new ClaudeCliError('not-found', `Could not launch Claude CLI: ${err.message}`);
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
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          ev.type === 'stream_event' &&
          ev.event?.type === 'content_block_delta' &&
          ev.event.delta?.type === 'text_delta'
        ) {
          queue.push(ev.event.delta.text);
          gotOutput = true;
        } else if (ev.type === 'result' && ev.is_error) {
          error = resultError(ev.result);
        }
      }
      notify();
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err: any) => {
      error = err.code === 'ENOENT' ? notFoundError() : new ClaudeCliError('error', err.message);
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
            throw new ClaudeCliError('error', stderr.trim() || 'Claude CLI returned no output.');
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

  // Model IDs the user's subscription offers, via the official /v1/models endpoint using the
  // CLI's own OAuth session. Returns [] when the CLI is not logged in or the request fails —
  // the preferences UI falls back to a free-text input in that case.
  async listModels(): Promise<string[]> {
    const token = readCliOAuthToken();
    if (!token) return [];
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []).map((m: any) => String(m.id));
    } catch {
      return [];
    }
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
