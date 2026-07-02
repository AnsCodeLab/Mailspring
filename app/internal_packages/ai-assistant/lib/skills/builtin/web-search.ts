import { Skill } from '../types';
import { AIConfig, KEY_WEBSEARCH_API } from '../../config';
import { isPublicHttpUrl } from '../../ssrf';
import { KeyManager } from 'mailspring-exports';

type SearchResult = { title: string; url: string; snippet: string };

// Built-in fallback: DuckDuckGo HTML scrape. No API key or configuration required.
async function runDDGSearch(query: string, count: number): Promise<SearchResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    body: `q=${encodeURIComponent(query)}&kl=us-en`,
  });
  const html = await res.text();
  const results: SearchResult[] = [];

  // Extract result blocks: each result is a <div class="result"> containing title <a>, snippet <a class="result__snippet">
  const blockRe =
    /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null && results.length < count) {
    const rawUrl = m[1];
    // DDG wraps URLs in redirects like //duckduckgo.com/l/?uddg=...
    let url = rawUrl;
    const uddg = rawUrl.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    // Skip ads / internal DDG pages
    if (!url.startsWith('http')) continue;
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const snippet = m[3].replace(/<[^>]+>/g, '').trim();
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

function detectProvider(url: string): 'brave' | 'tavily' | 'serper' | 'searxng' {
  if (url.includes('brave.com')) return 'brave';
  if (url.includes('tavily.com')) return 'tavily';
  if (url.includes('serper.dev')) return 'serper';
  return 'searxng';
}

async function runSearch(
  query: string,
  url: string,
  key: string | null,
  count: number
): Promise<SearchResult[]> {
  const provider = detectProvider(url);
  const authHeaders: Record<string, string> = {};

  if (provider === 'brave') {
    if (key) authHeaders['X-Subscription-Token'] = key;
    const res = await fetch(`${url}?q=${encodeURIComponent(query)}&count=${count}`, {
      headers: { Accept: 'application/json', ...authHeaders },
    });
    const json = await res.json();
    return (json.web?.results || [])
      .slice(0, count)
      .map((r: any) => ({ title: r.title, url: r.url, snippet: r.description || '' }));
  }

  if (provider === 'tavily') {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ api_key: key || undefined, query, max_results: count }),
    });
    const json = await res.json();
    return (json.results || [])
      .slice(0, count)
      .map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '' }));
  }

  if (provider === 'serper') {
    if (key) authHeaders['X-API-KEY'] = key;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ q: query, num: count }),
    });
    const json = await res.json();
    return (json.organic || [])
      .slice(0, count)
      .map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet || '' }));
  }

  // SearXNG
  const res = await fetch(`${url}/search?q=${encodeURIComponent(query)}&format=json`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  const json = await res.json();
  return (json.results || [])
    .slice(0, count)
    .map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '' }));
}

export const webSearchSkill: Skill = {
  name: 'web_search',
  tier: 'read',
  description:
    'Search the web. Returns titles, URLs, and snippets. ' +
    'Uses a configured provider (Brave/Tavily/Serper/SearXNG) when set, otherwise falls back to DuckDuckGo.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  // Always available — DDG requires no API key or configuration.
  enabled: () => true,
  async run({ query }) {
    const url = AIConfig.getWebSearchUrl();
    const count = AIConfig.getWebSearchResults();

    // Use configured provider if present; otherwise fall back to built-in DDG.
    if (url && isPublicHttpUrl(url)) {
      const key = await KeyManager.getPassword(KEY_WEBSEARCH_API);
      return runSearch(query, url, key, count);
    }

    return runDDGSearch(query, count);
  },
};
