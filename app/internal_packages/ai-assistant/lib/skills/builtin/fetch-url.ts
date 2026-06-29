import { Skill } from '../types';
import { isPublicHttpUrl } from '../../ssrf';
import { htmlToText } from '../../chunking';

export const fetchUrlSkill: Skill = {
  name: 'fetch_url',
  tier: 'read',
  description: 'Fetch the readable text of a public web page.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async run({ url }: { url: string }) {
    if (!isPublicHttpUrl(url)) throw new Error('Refusing to fetch a non-public/local URL.');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= 5; hop++) {
        if (hop === 5) throw new Error('Too many redirects');
        const res = await fetch(currentUrl, { signal: ctrl.signal, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) throw new Error('Redirect with no Location header');
          const next = new URL(location, currentUrl).href;
          if (!isPublicHttpUrl(next))
            throw new Error('Refusing to follow redirect to a non-public URL.');
          currentUrl = next;
          continue;
        }
        const html = (await res.text()).slice(0, 200000);
        return htmlToText(html).slice(0, 8000);
      }
    } finally {
      clearTimeout(t);
    }
  },
};
