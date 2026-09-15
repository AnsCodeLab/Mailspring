import proxyquire from 'proxyquire';
import { PassThrough } from 'stream';

let fetchSpy: jasmine.Spy;
let writeStreamSpy: jasmine.Spy;
let createdWriteStream: PassThrough;
let downloadFile: (url: string, destPath: string) => Promise<void>;

function loadModule() {
  fetchSpy = jasmine.createSpy('fetch');
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  createdWriteStream = new PassThrough();
  writeStreamSpy = jasmine.createSpy('createWriteStream').andReturn(createdWriteStream);

  const mod = proxyquire('../src/browser/download-file', {
    fs: { createWriteStream: writeStreamSpy, '@noCallThru': false },
  });
  downloadFile = mod.downloadFile;
}

function webReadableFromChunks(chunks: string[]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

describe('downloadFile', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    loadModule();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends a User-Agent header on the request', async () => {
    fetchSpy.andReturn(
      Promise.resolve({
        ok: true,
        status: 200,
        body: webReadableFromChunks(['hello']),
      })
    );

    await downloadFile('https://example.com/asset.deb', '/tmp/asset.deb');

    expect(fetchSpy).toHaveBeenCalled();
    const [, options] = fetchSpy.mostRecentCall.args;
    expect(options.headers['User-Agent']).toBeTruthy();
  });

  it('pipes the response body to the destination write stream', async () => {
    fetchSpy.andReturn(
      Promise.resolve({
        ok: true,
        status: 200,
        body: webReadableFromChunks(['hello ', 'world']),
      })
    );

    const written: string[] = [];
    createdWriteStream.on('data', (chunk) => written.push(chunk.toString()));

    await downloadFile('https://example.com/asset.deb', '/tmp/asset.deb');

    expect(writeStreamSpy).toHaveBeenCalledWith('/tmp/asset.deb');
    expect(written.join('')).toEqual('hello world');
  });

  it('rejects on a non-OK response instead of writing an error page to disk', async () => {
    fetchSpy.andReturn(
      Promise.resolve({
        ok: false,
        status: 404,
        body: null,
      })
    );

    let caught: Error | null = null;
    try {
      await downloadFile('https://example.com/missing.deb', '/tmp/missing.deb');
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught.message.includes('404')).toBe(true);
    expect(writeStreamSpy).not.toHaveBeenCalled();
  });
});
