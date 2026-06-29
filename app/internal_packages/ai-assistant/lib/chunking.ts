import crypto from 'crypto';

export function htmlToText(html: string): string {
  return (html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 2000;
  const overlap = opts.overlap ?? 200;
  if (text.length <= size) return text ? [text] : [];
  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += step;
  }
  return chunks;
}

export function contentHash(text: string): string {
  // change-detection only, not security-critical
  return crypto.createHash('sha1').update(text).digest('hex');
}
