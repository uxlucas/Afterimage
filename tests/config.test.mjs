import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig, projectExcludes } from '../src/cli/config.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

const configPath = root => path.join(root, 'afterimage.config.json');

test('a config round trips through writeConfig and readConfig', async t => {
  const root = await temp(t);
  const config = { source: 'dist', build: 'npm run build', history: 'afterimage', out: '.afterimage/site', exclude: ['cache'], type: 'vite' };
  await writeConfig(root, config);
  assert.deepEqual(await readConfig(root), config);
});

test('the config file is 2-space JSON with a trailing newline', async t => {
  const root = await temp(t);
  const config = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'plain' };
  await writeConfig(root, config);
  assert.equal(await fs.readFile(configPath(root), 'utf8'), JSON.stringify(config, null, 2) + '\n');
});

test('missing fields are filled with defaults', async t => {
  const root = await temp(t);
  await fs.writeFile(configPath(root), JSON.stringify({ source: 'dist', build: 'npm run build' }));
  assert.deepEqual(await readConfig(root), {
    source: 'dist', build: 'npm run build', history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown'
  });
});

test('no config file says to run init', async t => {
  const root = await temp(t);
  await assert.rejects(readConfig(root), { message: 'No afterimage.config.json here. Run "afterimage init" first.' });
});

test('a config that is not JSON is rejected by name', async t => {
  const root = await temp(t);
  await fs.writeFile(configPath(root), '{ "source": ');
  await assert.rejects(readConfig(root), /afterimage\.config\.json is not valid JSON/);
});

test('a config with a wrongly typed field is rejected by name', async t => {
  const root = await temp(t);
  for (const bad of [[], 'dist', { source: 3 }, { build: 7 }, { exclude: 'cache' }, { exclude: [1] }, { history: '' }]) {
    await fs.writeFile(configPath(root), JSON.stringify(bad));
    await assert.rejects(readConfig(root), /afterimage\.config\.json/, JSON.stringify(bad));
  }
});

test('project excludes cover the project-level names, the configured folders and config.exclude, once each', () => {
  const base = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: ['cache', 'node_modules'], type: 'plain' };
  assert.deepEqual(projectExcludes(base), [
    'node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', 'afterimage.config.json', 'vercel.json', 'netlify.toml', '.afterimage/site', 'cache'
  ]);
  assert.deepEqual(projectExcludes({ ...base, history: 'versions-here/', out: './site-out' }), [
    'node_modules', 'afterimage', '.afterimage', 'package.json', 'package-lock.json', 'afterimage.config.json', 'vercel.json', 'netlify.toml', 'versions-here', 'site-out', 'cache'
  ]);
});

test('a build folder source uses only config.exclude', () => {
  const config = { source: 'dist', build: 'npm run build', history: 'afterimage', out: '.afterimage/site', exclude: ['cache'], type: 'vite' };
  assert.deepEqual(projectExcludes(config), ['cache']);
  assert.deepEqual(projectExcludes({ ...config, exclude: [] }), []);
});

test('source, history and out are normalized when read', async t => {
  const root = await temp(t);
  await fs.writeFile(configPath(root), JSON.stringify({ source: 'src\\..', history: '.\\afterimage\\', out: 'x/../site/' }));
  const config = await readConfig(root);
  assert.deepEqual([config.source, config.history, config.out], ['.', 'afterimage', 'site']);
  assert.ok(projectExcludes(config).includes('site'));
});

test('a path that is absolute or leaves the project is rejected by field name', async t => {
  const root = await temp(t);
  const absolute = path.resolve(os.tmpdir(), 'elsewhere');
  for (const [field, value] of [['source', '..'], ['source', '../app'], ['out', absolute], ['history', 'a/../../h'], ['out', 'C:\\site'], ['out', '/site']]) {
    await fs.writeFile(configPath(root), JSON.stringify({ [field]: value }));
    await assert.rejects(readConfig(root), new RegExp(`needs "${field}" to be a folder inside the project`), `${field}=${value}`);
  }
  // A folder that merely starts with two dots is fine.
  await fs.writeFile(configPath(root), JSON.stringify({ out: '..site' }));
  assert.equal((await readConfig(root)).out, '..site');
});

test('a prototype at the project root leaves out the project\'s own docs, in any case and with any extension', () => {
  const base = { source: '.', build: null, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'plain' };
  const names = ['README.md', 'readme.txt', 'LICENSE', 'License.md', 'CLAUDE.md', 'AGENTS.md', 'index.html', 'readme-assets', 'READMEs.md', 'notes.md'];
  const excluded = projectExcludes(base, names);
  for (const name of ['README.md', 'readme.txt', 'LICENSE', 'License.md', 'CLAUDE.md', 'AGENTS.md']) assert.ok(excluded.includes(name), name);
  for (const name of ['index.html', 'readme-assets', 'READMEs.md', 'notes.md']) assert.ok(!excluded.includes(name), name);
  // A build folder is the prototype itself, so its files are its own.
  assert.deepEqual(projectExcludes({ ...base, source: 'dist' }, ['README.md']), []);
});
