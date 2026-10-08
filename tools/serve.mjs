/**
 * A static server for local development. Node only, no dependencies.
 *
 *   node tools/serve.mjs [port]
 *
 * `python -m http.server` is not used here because this machine has no Python,
 * and because ES modules need a real HTTP origin - opening index.html with
 * `file://` fails on the module imports with an opaque CORS error.
 *
 * Two details that matter:
 *
 *   - it is concurrent. A browser opens several connections at once, and a
 *     single-threaded server serves them one at a time; a stalled request then
 *     blocks every later module and the page appears to hang with no error.
 *     Node's HTTP server already handles requests concurrently, so this is free.
 *   - it supports `Range:`, because a real static host does and the local run
 *     should match what is deployed.
 *
 * It also accepts `/__result__/<message>` and prints the message. The headless
 * harnesses use that to report back, because under Chrome's
 * `--virtual-time-budget` the page's own clock races ahead of real time, so an
 * in-page timer is useless for measuring anything.
 */

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8765;
const BEACON = '/__result__/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Resolves a URL path to a file inside ROOT, or null if it escapes. */
function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(ROOT, `.${clean}`);
  // A path that resolves outside the project is a traversal attempt, not a file.
  if (!target.startsWith(ROOT)) return null;
  return target;
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith(BEACON)) {
    process.stdout.write(`[beacon] ${decodeURIComponent(req.url.slice(BEACON.length))}\n`);
    res.writeHead(204).end();
    return;
  }

  let target = resolve(req.url);
  if (!target) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    let stat = await fs.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fs.stat(target);
    }

    const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    const match = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());

    if (match) {
      const [, startText, endText] = match;
      const start = startText === '' ? Math.max(0, stat.size - Number(endText)) : Number(startText);
      let end = startText === '' || endText === '' ? stat.size - 1 : Number(endText);
      end = Math.min(end, stat.size - 1);
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      createReadStream(target, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      // No caching, so a reload always shows the current file.
      'Cache-Control': 'no-store',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`deepcore serving ${ROOT} on http://127.0.0.1:${PORT}\n`);
});
