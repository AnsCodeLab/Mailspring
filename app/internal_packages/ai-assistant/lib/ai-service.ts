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

function isLocalEndpoint(url: string): boolean {
  return (
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.') ||
    url.startsWith('http://[::1]') ||
    url.startsWith('http://0.0.0.0')
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const key = await KeyManager.getPassword(KEY_API);
  const endpoint = AIConfig.getEndpoint();
  const isCloud =
    endpoint.includes('api.openai.com') ||
    endpoint.includes('api.anthropic.com') ||
    endpoint.includes('generativelanguage.googleapis.com');
  // Local/custom endpoints (e.g. Ollama) need no key; only require one for cloud providers.
  if (!key && isCloud) {
    throw new AIError('missing-config', 'No API key configured. Go to Preferences > AI Assistant.');
  }
  // Refuse to send an API key over an unencrypted non-local connection.
  if (key && !endpoint.startsWith('https://') && !isLocalEndpoint(endpoint)) {
    throw new AIError(
      'missing-config',
      'API key will not be sent to a non-HTTPS endpoint. Update the endpoint URL to https:// in Preferences > AI Assistant.'
    );
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  if (endpoint.includes('api.anthropic.com')) headers['anthropic-version'] = '2023-06-01';
  return headers;
}

function mapHttpError(status: number, text: string): AIError {
  if (status === 401 || status === 403)
    return new AIError(
      'auth',
      'Authentication failed. Check your API key in Preferences > AI Assistant.'
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
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
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

  async chatWithTools({
    messages,
    tools,
    signal,
  }: {
    messages: any[];
    tools?: any[];
    signal?: AbortSignal;
  }): Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; name: string; arguments: any }>;
  }> {
    const endpoint = AIConfig.getEndpoint();
    const body: any = { model: AIConfig.getModel(), messages, stream: false };
    if (tools && tools.length) body.tools = tools;
    let res: Response;
    try {
      res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new AIError('network', `Could not reach ${endpoint}.`);
    }
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    return {
      content: msg?.content || undefined,
      tool_calls: msg?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments:
          typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || tc.arguments || {},
      })),
    };
  },

  // Streaming variant of chatWithTools — yields content tokens via onToken for live UI updates,
  // and accumulates tool_call deltas from the SSE stream. Returns the same shape as chatWithTools.
  async chatWithToolsStream({
    messages,
    tools,
    signal,
    onToken,
  }: {
    messages: any[];
    tools?: any[];
    signal?: AbortSignal;
    onToken?: (tok: string) => void;
  }): Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; name: string; arguments: any }>;
  }> {
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
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new AIError('network', `Could not reach ${endpoint}.`);
    }
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));
    if (!res.body) throw new AIError('network', 'Response body is null');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    // tool_call builders indexed by tool_call delta index
    const tcBuilders: Record<number, { id: string; name: string; args: string }> = {};
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSEChunk(buffer);
        buffer = rest;
        for (const ev of events) {
          const line = ev.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '[DONE]') continue;
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = json?.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onToken?.(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!tcBuilders[idx]) tcBuilders[idx] = { id: '', name: '', args: '' };
              if (tc.id) tcBuilders[idx].id = tc.id;
              if (tc.function?.name) tcBuilders[idx].name += tc.function.name;
              if (tc.function?.arguments) tcBuilders[idx].args += tc.function.arguments;
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new AIError('network', `Stream interrupted: ${err?.message ?? String(err)}`);
    }
    const toolCalls = Object.values(tcBuilders)
      .filter((tc) => tc.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: (() => {
          try {
            return JSON.parse(tc.args);
          } catch {
            return {};
          }
        })(),
      }));
    return {
      content: content || undefined,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    };
  },

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${AIConfig.getEndpoint()}/models`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []).map((m: any) => String(m.id)).sort();
    } catch {
      return [];
    }
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    // Use GET /models — instant health check that works even before a model is warm.
    try {
      const res = await fetch(`${AIConfig.getEndpoint()}/models`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      const models: string[] = (json.data ?? []).map((m: any) => m.id);
      const label = models.length
        ? `${models.length} model${models.length > 1 ? 's' : ''} available`
        : 'Connected';
      return { ok: true, error: label };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },
};
