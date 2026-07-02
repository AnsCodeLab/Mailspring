import { Skill } from '../types';
import { isPublicHttpUrl } from '../../ssrf';
import { htmlToText } from '../../chunking';

// Browser-like headers so sites don't return bot-detection pages or empty shells.
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Accept-Encoding': 'identity',
};

export const fetchUrlSkill: Skill = {
  name: 'fetch_url',
  tier: 'read',
  description:
    'Fetch the readable text of a public web page. Returns structured data, meta tags, and page text. ' +
    'If a page returns little content (JS-rendered SPA), try a different URL or add the site to a web_search query.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async run({ url }: { url: string }) {
    if (!isPublicHttpUrl(url)) return { error: 'Refusing to fetch a non-public or local URL.' };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= 5; hop++) {
        if (hop === 5) return { error: 'Too many redirects.' };
        const res = await fetch(currentUrl, {
          signal: ctrl.signal,
          redirect: 'manual',
          headers: FETCH_HEADERS,
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return { error: 'Redirect with no Location header.' };
          const next = new URL(location, currentUrl).href;
          if (!isPublicHttpUrl(next))
            return { error: 'Refusing to follow redirect to a non-public URL.' };
          currentUrl = next;
          continue;
        }
        if (!res.ok) {
          return {
            error: `HTTP ${res.status} from ${currentUrl}. Try a different URL or search for the information instead.`,
          };
        }
        const html = (await res.text()).slice(0, 400000);
        const content = htmlToText(html).slice(0, 15000);
        if (!content.trim()) {
          return {
            error:
              'Page returned no readable content (likely a JS-rendered SPA). Try fetching a different URL, or use web_search to find the information.',
          };
        }
        return { content };
      }
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      clearTimeout(t);
    }
  },
};
