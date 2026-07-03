import { splitSignature } from '../lib/composer-assist';

describe('splitSignature', () => {
  const SIG =
    '<signature id="abc-123">Sent from <a href="https://getmailspring.com">Mailspring</a></signature>';

  it('separates the signature from the content', () => {
    const body = `<div>Hello world</div>${SIG}`;
    const { content, signature } = splitSignature(body);
    expect(content).toBe('<div>Hello world</div>');
    expect(signature).toBe(SIG);
  });

  it('keeps trailing quoted text with the content', () => {
    const body = `<div>Reply text</div>${SIG}<blockquote class="gmail_quote">old</blockquote>`;
    const { content, signature } = splitSignature(body);
    expect(content).toContain('gmail_quote');
    expect(signature).toBe(SIG);
  });

  it('returns the body unchanged when there is no signature', () => {
    const { content, signature } = splitSignature('<div>plain</div>');
    expect(content).toBe('<div>plain</div>');
    expect(signature).toBe('');
  });
});
