import { KeyManager } from 'mailspring-exports';
import { AIConfig, KEY_API } from './config';
import { parseSSEChunk, extractDelta } from './sse';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
};

export class AIError extends Error {
  kind: 'missing-config' | 'auth' | 'rate-limit' | 'network' | 'http';
  constructor(kind: AIError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const key = await KeyManager.getPassword(KEY_API);
  // Local/custom endpoints (e.g. Ollama) need no key; only require one for OpenAI cloud.
  if (!key && AIConfig.getEndpoint().includes('api.openai.com')) {
    throw new AIError('missing-config', 'No API key configured. Go to Preferences › AI Assistant.');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

function mapHttpError(status: number, text: string): AIError {
  if (status === 401 || status === 403)
    return new AIError(
      'auth',
      'Authentication failed — check your API key in Preferences › AI Assistant.'
    );
  if (status === 429) return new AIError('rate-limit', 'Rate limit reached. Try again shortly.');
  return new AIError('http', `Request failed (${status}): ${text.slice(0, 200)}`);
}

export const AIService = {
  async *chatStream({
    messages,
    signal,
    tools,
  }: {
    messages: ChatMessage[];
    signal?: AbortSignal;
    tools?: any[];
  }): AsyncIterable<string> {
    const endpoint = AIConfig.getEndpoint();
    const body: any = { model: AIConfig.getModel(), messages, stream: true };
    if (tools && tools.length) body.tools = tools;
    let res: Response;
    try {
      res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new AIError('network', `Could not reach ${endpoint}. Is the endpoint/model running?`);
    }
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));
    if (!res.body) throw new AIError('network', 'Response body is null');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSEChunk(buffer);
        buffer = rest;
        for (const ev of events) {
          const delta = extractDelta(ev);
          if (delta) yield delta;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new AIError('network', `Stream interrupted: ${err?.message ?? String(err)}`);
    }
  },

  async chat(args: { messages: ChatMessage[]; signal?: AbortSignal }): Promise<string> {
    let out = '';
    for await (const t of this.chatStream(args)) out += t;
    return out;
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.chat({ messages: [{ role: 'user', content: 'ping' }] });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },
};
