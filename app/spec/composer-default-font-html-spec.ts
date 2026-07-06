import { wrapHTMLWithDefaultFont } from '../src/components/composer-editor/conversion';

describe('wrapHTMLWithDefaultFont', () => {
  it('wraps the HTML in a div carrying the default font-family and font-size', () => {
    const out = wrapHTMLWithDefaultFont('<p>Hello</p>', 'sans-serif', '11');
    expect(out).toBe('<div style="font-family: sans-serif; font-size: 11pt;"><p>Hello</p></div>');
  });

  it('omits font-size when no default size is configured', () => {
    const out = wrapHTMLWithDefaultFont('<p>Hello</p>', 'sans-serif', undefined);
    expect(out).toBe('<div style="font-family: sans-serif;"><p>Hello</p></div>');
  });

  it('omits font-family when no default face is configured', () => {
    const out = wrapHTMLWithDefaultFont('<p>Hello</p>', undefined, '11');
    expect(out).toBe('<div style="font-size: 11pt;"><p>Hello</p></div>');
  });

  it('returns the HTML unwrapped when neither default is configured', () => {
    const out = wrapHTMLWithDefaultFont('<p>Hello</p>', undefined, undefined);
    expect(out).toBe('<p>Hello</p>');
  });

  it('returns falsy/empty HTML unchanged', () => {
    expect(wrapHTMLWithDefaultFont('', 'sans-serif', '11')).toBe('');
  });
});
