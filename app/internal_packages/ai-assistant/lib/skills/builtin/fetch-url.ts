import { Skill } from '../types';
import { isPublicHttpUrl } from '../../ssrf';
import { htmlToText } from '../../chunking';

export const fetchUrlSkill: Skill = {
  name: 'fetch_url',
  tier: 'read',
  description: 'Fetch the readable text of a public web page.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async run({ url }) {
    if (!isPublicHttpUrl(url)) throw new Error('Refusing to fetch a non-public/local URL.');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const html = (await res.text()).slice(0, 200000); // size cap
      return htmlToText(html).slice(0, 8000);
    } finally {
      clearTimeout(t);
    }
  },
};
