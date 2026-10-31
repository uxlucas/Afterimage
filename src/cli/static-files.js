// Serving files from a folder over local HTTP. Shared by afterimage dev and the end-to-end harness, so both guard paths the same way.
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', wasm: 'application/wasm', txt: 'text/plain' };

// The decoded path of a request URL, or null when it can't be decoded or holds a NUL byte (no file has one, and
// the file system would throw on it).
export function requestPath(url) {
  try {
    const decoded = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

// The file under `root` that `relative` (a URL path starting with /) asks for, or null when it would leave
// `root` or reach a hidden file or folder. Both slashes count as separators, since Windows accepts either.
export function fileFor(root, relative) {
  if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) return null;
  const file = path.resolve(root, '.' + relative + (relative.endsWith('/') ? 'index.html' : ''));
  return file.startsWith(path.resolve(root) + path.sep) ? file : null;
}

// Sends `file` uncached, or a 404 when it isn't there.
export async function sendFile(res, file) {
  try {
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) console.error(error);
    res.statusCode = 404;
    res.end('Not found');
  }
}
