import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileFor, requestPath, sendFile } from '../src/cli/static-files.js';

const root = path.resolve('site');

test('a path inside the folder resolves, and a folder serves its index.html', () => {
  assert.equal(fileFor(root, '/versions/v1/index.html'), path.join(root, 'versions', 'v1', 'index.html'));
  assert.equal(fileFor(root, '/'), path.join(root, 'index.html'));
});

test('paths that leave the folder are refused', () => {
  assert.equal(fileFor(root, '/../secret.txt'), null);
  assert.equal(fileFor(root, '/versions/../../secret.txt'), null);
});

test('hidden files and folders are refused, whichever slash spells the path', () => {
  assert.equal(fileFor(root, '/.vite/manifest.json'), null);
  assert.equal(fileFor(root, '/versions/v1\\..\\..\\.vite\\manifest.json'), null);
  assert.equal(fileFor(root, '/versions/v1/.env'), null);
});

test('a request path is decoded, and one that cannot be decoded is null', () => {
  assert.equal(requestPath('/versions/v1/a%20b.png?x=1'), '/versions/v1/a b.png');
  assert.equal(requestPath('/%E0%A4%A'), null);
});

test('a path with a NUL byte is refused like one that cannot be decoded', () => {
  assert.equal(requestPath('/versions/v1/a%00.png'), null);
});

// Every type a saved version commonly holds is served as itself, so a PDF or a model opens in the frame instead of
// downloading. Anything else is plain bytes.
test('files are served with the type their extension names, and unknown ones as bytes', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const expected = {
    'sitemap.xml': 'application/xml', 'doc.pdf': 'application/pdf', 'site.webmanifest': 'application/manifest+json',
    'model.glb': 'model/gltf-binary', 'model.gltf': 'model/gltf+json', 'captions.vtt': 'text/vtt', 'data.csv': 'text/csv',
    'notes.md': 'text/markdown', 'clip.mov': 'video/quicktime', 'voice.m4a': 'audio/mp4', 'scene.riv': 'application/octet-stream',
    'DATA.CSV': 'text/csv', 'data.parquet': 'application/octet-stream', '_redirects': 'application/octet-stream'
  };
  for (const [name, type] of Object.entries(expected)) {
    await fs.writeFile(path.join(folder, name), 'x');
    const headers = {};
    await sendFile({ setHeader: (key, value) => { headers[key] = value; }, end: () => {} }, path.join(folder, name));
    assert.equal(headers['Content-Type'], type, name);
  }
});
