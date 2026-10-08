import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const compress = promisify(gzip);
const acceptsGzip = header => header.split(',').some(value => {
  const [encoding, ...parameters] = value.toLowerCase().split(';').map(part => part.trim());
  const quality = parameters.find(part => part.startsWith('q='))?.slice(2) ?? '1';
  return encoding === 'gzip' && Number(quality) > 0;
});
const runtimes = new Set([
  '/node_modules/@mujoco/mujoco/mujoco.wasm',
  '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
]);

// Vite serves these large runtime binaries uncompressed during development.
// Compress each pinned file once and let clients revalidate the cached bytes.
export function compressPreviewWasm() {
  return {
    name: 'duckrobe-preview-wasm',
    configureServer(server) {
      const cached = new Map();
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname.startsWith(server.config.base) ? url.pathname.slice(server.config.base.length - 1) : url.pathname;
        if (!['GET', 'HEAD'].includes(req.method) || !runtimes.has(pathname) ||
            url.searchParams.has('import') || url.searchParams.has('url') ||
            !acceptsGzip(req.headers['accept-encoding'] || '')) return next();
        if (!cached.has(pathname)) {
          const result = readFile(`${server.config.root}${pathname}`)
            .then(bytes => compress(bytes, { level: 1 }))
            .then(bytes => ({ bytes, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` }));
          cached.set(pathname, result);
          result.catch(() => cached.delete(pathname));
        }
        cached.get(pathname).then(({ bytes, etag }) => {
          const vary = String(res.getHeader('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
          if (!vary.some(value => value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
          res.setHeader('Vary', vary.join(', '));
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', bytes.length);
          res.end(req.method === 'HEAD' ? undefined : bytes);
        }).catch(next);
      });
    },
  };
}
