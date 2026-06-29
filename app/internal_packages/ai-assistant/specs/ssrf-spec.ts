import { isPublicHttpUrl } from '../lib/ssrf';

describe('isPublicHttpUrl', () => {
  it('allows normal https URLs', () =>
    expect(isPublicHttpUrl('https://example.com/page')).toBe(true));
  it('rejects non-http schemes', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('ftp://x')).toBe(false);
  });
  it('rejects localhost and loopback', () => {
    expect(isPublicHttpUrl('http://localhost/x')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/x')).toBe(false);
  });
  it('rejects private ranges', () => {
    expect(isPublicHttpUrl('http://10.0.0.5')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.1.1')).toBe(false);
  });
});
