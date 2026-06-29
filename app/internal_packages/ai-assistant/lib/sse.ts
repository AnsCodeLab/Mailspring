// PURE Server-Sent-Events helpers for OpenAI-compatible /chat/completions streams.

// Split a growing buffer on the SSE event delimiter (blank line). Returns the complete
// event blocks and the leftover partial to carry into the next chunk.
export function parseSSEChunk(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts.map((p) => p.trim()).filter(Boolean), rest };
}

// Extract the assistant text delta from one `data:` line. null = nothing to emit
// (the [DONE] sentinel, a role-only delta, or a non-data line).
export function extractDelta(eventData: string): string | null {
  const line = eventData.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return null;
  const payload = line.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    const content = json?.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content.length ? content : null;
  } catch {
    return null;
  }
}
