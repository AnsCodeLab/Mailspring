import { Skill } from '../types';
import { AIConfig, KEY_WEBSEARCH_API } from '../../config';
import { KeyManager } from 'mailspring-exports';

type SearchResult = { title: string; url: string; snippet: string };

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
  description: 'Search the web. Returns titles, URLs, and snippets.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  enabled: () => AIConfig.isWebSearchEnabled() && !!AIConfig.getWebSearchUrl(),
  async run({ query }) {
    const url = AIConfig.getWebSearchUrl();
    const key = await KeyManager.getPassword(KEY_WEBSEARCH_API);
    return runSearch(query, url, key, AIConfig.getWebSearchResults());
  },
};
