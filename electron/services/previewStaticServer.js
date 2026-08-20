/*
 * Vista previa para el proyecto que no tiene nada declarado: una carpeta con
 * `index.html`.
 *
 * Es el primer proyecto de casi cualquier alumno y hasta ahora era el unico que
 * Vibe no podia mostrar, porque toda la vista previa pasaba por `npm run dev`.
 * Este servidor entrega esos archivos y nada mas: solo lectura, solo GET y
 * HEAD, siempre dentro de la carpeta del proyecto, sin ejecutar una sola linea
 * del proyecto.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const MAX_STATIC_FILE_BYTES = 64 * 1024 * 1024;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'], ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  ['.txt', 'text/plain; charset=utf-8'], ['.md', 'text/plain; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'], ['.wasm', 'application/wasm'],
]);

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Traduce la URL pedida a un archivo real dentro de la carpeta, o `null`.
 *
 * Se resuelve la ruta real antes de responder: un enlace simbolico que apunte
 * fuera de la carpeta queda descartado igual que un `..`.
 */
function resolveStaticFile(root, requestUrl, { statSync = fs.lstatSync, realpathSync = fs.realpathSync, existsSync = fs.existsSync } = {}) {
  const rootReal = path.resolve(root);
  let decoded;
  try { decoded = decodeURIComponent(String(requestUrl || '/').split('?')[0].split('#')[0]); } catch { return null; }
  if (!decoded || decoded.includes('\0')) return null;
  const candidate = path.resolve(rootReal, decoded.replace(/^[/\\]+/, ''));
  if (!isInside(rootReal, candidate)) return null;
  if (!existsSync(candidate)) return null;
  let stats;
  try { stats = statSync(candidate); } catch { return null; }
  if (stats.isSymbolicLink()) return null;
  const target = stats.isDirectory() ? path.join(candidate, 'index.html') : candidate;
  if (target !== candidate) {
    if (!existsSync(target)) return null;
    try { if (!statSync(target).isFile()) return null; } catch { return null; }
  } else if (!stats.isFile()) return null;
  try {
    const real = realpathSync(target);
    if (!isInside(realpathSync(rootReal), real)) return null;
  } catch { return null; }
  return target;
}

function createStaticServer(root, { host, port }) {
  const rootReal = path.resolve(root);
  const server = http.createServer((request, response) => {
    const send = (status, body = '') => {
      response.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed');
    const filePath = resolveStaticFile(rootReal, request.url);
    if (!filePath) return send(404, 'Not found');
    let stats;
    try { stats = fs.statSync(filePath); } catch { return send(404, 'Not found'); }
    if (stats.size > MAX_STATIC_FILE_BYTES) return send(413, 'File too large');
    response.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

module.exports = { contentTypeFor, createStaticServer, resolveStaticFile };
