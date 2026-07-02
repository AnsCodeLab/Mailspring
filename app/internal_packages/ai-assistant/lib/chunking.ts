import crypto from 'crypto';
import { AIConfig } from './config';

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string): string {
  if (!html) return '';

  // 1. JSON-LD structured data — present on most e-commerce product pages even when the
  //    rest of the page is JS-rendered. Contains product name, price, description, specs.
  const jsonLdBlocks: string[] = [];
  html.replace(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        // Flatten to readable key: value lines rather than raw JSON noise.
        const flat = (obj: any, prefix = ''): string[] => {
          if (!obj || typeof obj !== 'object') return [];
          return Object.entries(obj).flatMap(([k, v]) => {
            const key = prefix ? `${prefix}.${k}` : k;
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) return flat(v, key);
            if (Array.isArray(v))
              return v.flatMap((item, i) =>
                typeof item === 'object' ? flat(item, `${key}[${i}]`) : [`${key}: ${item}`]
              );
            return v !== undefined && v !== null && String(v).trim() ? [`${key}: ${v}`] : [];
          });
        };
        jsonLdBlocks.push(flat(parsed).join('\n'));
      } catch {
        // malformed JSON-LD — skip
      }
      return '';
    }
  );

  // 2. Meta tags — server-rendered on almost all pages including SPAs.
  const metaLines: string[] = [];
  const titleM = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  if (titleM) metaLines.push(`title: ${decodeEntities(titleM[1].trim())}`);
  const metaRe =
    /<meta\s+(?:[^>]*\s+)?(?:name|property)=["']([^"']+)["'][^>]*\s+content=["']([^"']{1,500})["']/gi;
  let mm: RegExpExecArray | null;
  while ((mm = metaRe.exec(html)) !== null) {
    const name = mm[1].toLowerCase();
    if (
      /description|og:title|og:description|product:|price|brand|availability|keywords/.test(name)
    ) {
      metaLines.push(`${mm[1]}: ${decodeEntities(mm[2].trim())}`);
    }
  }

  // 3. Plain text — strip all remaining tags.
  const plain = html
    .replace(/<(script|style|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Prioritise structured data → meta → plain text.
  const parts: string[] = [];
  if (jsonLdBlocks.length) parts.push('[Structured data]\n' + jsonLdBlocks.join('\n---\n'));
  if (metaLines.length) parts.push('[Page meta]\n' + metaLines.join('\n'));
  if (plain) parts.push('[Page text]\n' + decodeEntities(plain));

  return parts.join('\n\n');
}

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? AIConfig.getChunkSize();
  const overlap = opts.overlap ?? AIConfig.getChunkOverlap();
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
