import { Skill } from '../types';
import { AIConfig, KEY_WEBSEARCH_API } from '../../config';
import { KeyManager } from 'mailspring-exports';

export const webSearchSkill: Skill = {
  name: 'web_search',
  tier: 'read',
  description: 'Search the web. Returns titles, URLs, and snippets.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  enabled: () => AIConfig.isWebSearchEnabled() && !!AIConfig.getWebSearchUrl(),
  async run({ query }) {
    const url = AIConfig.getWebSearchUrl();
    const key = await KeyManager.getPassword(KEY_WEBSEARCH_API);
    // SearXNG JSON API shape: /search?q=...&format=json . Other providers differ; the
    // implementer maps the configured provider's response to {title,url,snippet}[].
    const res = await fetch(`${url}/search?q=${encodeURIComponent(query)}&format=json`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    const json = await res.json();
    return (json.results || [])
      .slice(0, 5)
      .map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }));
  },
};
