import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileFor, requestPath } from '../src/cli/static-files.js';

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
