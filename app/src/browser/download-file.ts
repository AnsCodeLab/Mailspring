import fs from 'fs';

// GitHub's API (and, by extension, requests it 302-redirects to) 403s a
// request with no `User-Agent` header at all. Electron's bundled runtime
// has a native global `fetch` that follows redirects by default, so no
// hand-rolled redirect loop or extra HTTP-client dependency is needed here
// — just this header.
const USER_AGENT = 'Mailspring-AnsCodeLab-Fork';

/**
 * Downloads `url` to `destPath`, streaming the response body to disk one
 * chunk at a time via the Web Streams reader API rather than buffering the
 * whole response in memory. Deliberately reads via `response.body.getReader()`
 * instead of `Readable.fromWeb(response.body)`: Node's `Readable.fromWeb`
 * requires its *own* internal `stream/web` `ReadableStream` class instance,
 * which is a different realm/class than the platform `ReadableStream` this
 * repo's Electron process (main and the Electron-hosted spec harness alike)
 * actually vends from `fetch` — `instanceof` fails across that boundary.
 * The reader-loop approach works with any spec-compliant `ReadableStream`
 * regardless of which realm it came from.
 *
 * Throws (and writes nothing further to disk) on a non-OK response, so a
 * 404/error page is never silently saved as if it were the real asset.
 */
export async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const fileStream = fs.createWriteStream(destPath);
  const reader = response.body.getReader();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await writeChunk(fileStream, value);
      }
    }
  } finally {
    fileStream.end();
  }
}

function writeChunk(fileStream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  fileStream.write(chunk, (error) => {
    if (error) reject(error);
    else resolve();
  });
  return promise;
}
