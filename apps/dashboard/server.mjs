import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function sendFile(res, filePath, cacheControl) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': contentType };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

async function resolvePublicFile(urlPathname) {
  const pathname = decodeURIComponent(urlPathname);
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = path.join(distDir, normalized);

  if (!requestedPath.startsWith(distDir)) return null;

  try {
    const stat = await fs.stat(requestedPath);
    if (stat.isFile()) return requestedPath;
  } catch {
    return null;
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;
    const filePath = await resolvePublicFile(pathname);

    if (filePath) {
      const isHashedAsset = /-[a-f0-9]{8,}\./i.test(path.basename(filePath));
      const cacheControl = isHashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=600';
      sendFile(res, filePath, cacheControl);
      return;
    }

    if (path.extname(pathname)) {
      sendNotFound(res);
      return;
    }

    const indexPath = path.join(distDir, 'index.html');
    sendFile(res, indexPath, 'no-cache');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
    console.error('[dashboard-server] request failed', error);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[dashboard-server] listening on port ${port}`);
});
