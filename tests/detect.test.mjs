import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject } from '../src/cli/detect.js';

async function project(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

const pkg = (dependencies = {}, devDependencies = {}) => JSON.stringify({ name: 'demo', dependencies, devDependencies });

async function detect(t, files, expected) {
  const found = await detectProject(await project(t, files));
  assert.equal(found.type, expected.type);
  assert.equal(found.source, expected.source);
  assert.equal(found.build, expected.build);
  assert.equal(typeof found.reason, 'string');
  assert.ok(found.reason.length > 0);
  return found;
}

test('an index.html at the root with no package.json is plain', async t => {
  await detect(t, { 'index.html': '<!doctype html>' }, { type: 'plain', source: '.', build: null });
});

test('a single folder holding an index.html is the plain source', async t => {
  await detect(t, { 'prototype/index.html': '<!doctype html>', 'notes/readme.txt': 'hi' }, { type: 'plain', source: 'prototype', build: null });
});

test('two folders holding an index.html are unknown', async t => {
  await detect(t, { 'a/index.html': '', 'b/index.html': '' }, { type: 'unknown', source: null, build: null });
});

test('an empty folder is unknown', async t => {
  await detect(t, {}, { type: 'unknown', source: null, build: null });
});

test('vite builds to dist', async t => {
  const found = await detect(t, { 'package.json': pkg({}, { vite: '^7.0.0' }), 'vite.config.js': 'export default {}' }, { type: 'vite', source: 'dist', build: 'npm run build' });
  assert.match(found.reason, /vite/);
  assert.match(found.reason, /dist/);
});

test('next with output: export builds to out', async t => {
  await detect(t, {
    'package.json': pkg({ next: '16.0.0' }),
    'next.config.mjs': "const config = {\n  output: 'export',\n};\nexport default config;\n"
  }, { type: 'next-static', source: 'out', build: 'npm run build' });
});

test('next config written as TypeScript or with double quotes is read the same way', async t => {
  await detect(t, {
    'package.json': pkg({ next: '16.0.0' }),
    'next.config.ts': 'const config: NextConfig = { output: "export" };\nexport default config;\n'
  }, { type: 'next-static', source: 'out', build: 'npm run build' });
});

test('Next without output: export is next-server, with a reason naming output: export', async t => {
  const found = await detect(t, {
    'package.json': pkg({ next: '16.0.0' }),
    'next.config.mjs': 'export default {};\n'
  }, { type: 'next-server', source: null, build: null });
  assert.match(found.reason, /output: 'export'/);
});

test('next with no config file at all is next-server', async t => {
  await detect(t, { 'package.json': pkg({ next: '16.0.0' }) }, { type: 'next-server', source: null, build: null });
});

test('astro builds to dist', async t => {
  await detect(t, { 'package.json': pkg({ astro: '^5.0.0' }), 'astro.config.mjs': 'export default {};' }, { type: 'astro', source: 'dist', build: 'npm run build' });
});

// @astrojs/vercel writes Vercel's own output (.vercel/output), so it is a server project unless the config says static.
for (const [title, config] of [
  ['without a config file', null],
  ['with output: server', "import vercel from '@astrojs/vercel';\nexport default { output: 'server', adapter: vercel() };\n"],
  ['with no output set', "import vercel from '@astrojs/vercel';\nexport default { adapter: vercel() };\n"]
]) {
  test(`astro with @astrojs/vercel ${title} is astro-server, with a reason naming the adapter and output: 'static'`, async t => {
    const files = { 'package.json': pkg({ astro: '^5.0.0', '@astrojs/vercel': '^8.0.0' }) };
    if (config) files['astro.config.mjs'] = config;
    const found = await detect(t, files, { type: 'astro-server', source: null, build: null });
    assert.match(found.reason, /@astrojs\/vercel/);
    assert.match(found.reason, /output: 'static'/);
  });
}

test('astro with @astrojs/vercel and output: static builds to dist', async t => {
  await detect(t, {
    'package.json': pkg({ astro: '^5.0.0', '@astrojs/vercel': '^8.0.0' }),
    'astro.config.ts': "import vercel from '@astrojs/vercel';\nexport default defineConfig({ output: \"static\", adapter: vercel() });\n"
  }, { type: 'astro', source: 'dist', build: 'npm run build' });
});

test('sveltekit with adapter-static defaults to build', async t => {
  await detect(t, {
    'package.json': pkg({}, { '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-static': '^3.0.0', vite: '^7.0.0' }),
    'svelte.config.js': "import adapter from '@sveltejs/adapter-static';\nexport default { kit: { adapter: adapter() } };\n"
  }, { type: 'sveltekit-static', source: 'build', build: 'npm run build' });
});

test('sveltekit with adapter-static reads the pages option', async t => {
  await detect(t, {
    'package.json': pkg({}, { '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-static': '^3.0.0' }),
    'svelte.config.js': "export default { kit: { adapter: adapter({ pages: 'public-site', fallback: '200.html' }) } };\n"
  }, { type: 'sveltekit-static', source: 'public-site', build: 'npm run build' });
});

test('sveltekit without adapter-static is unknown', async t => {
  const found = await detect(t, {
    'package.json': pkg({}, { '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-auto': '^3.0.0' })
  }, { type: 'unknown', source: null, build: null });
  assert.match(found.reason, /adapter-static/);
});

test('a package.json with no known framework is unknown', async t => {
  await detect(t, { 'package.json': pkg({ lodash: '4.0.0' }), 'index.html': '<!doctype html>' }, { type: 'unknown', source: null, build: null });
});

test('a package.json that is not valid JSON is unknown', async t => {
  const found = await detect(t, { 'package.json': '{ nope' }, { type: 'unknown', source: null, build: null });
  assert.match(found.reason, /package\.json/);
});

// What a plain HTML folder has after the setup prompt's "npm init -y" and the install: no framework, no build.
const wrapper = (extra = {}) => JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'echo "Error: no test specified" && exit 1' }, devDependencies: { 'afterimage-cli': '^0.1.0' }, ...extra });

test('a package.json with only afterimage-cli and no build is still a plain folder', async t => {
  await detect(t, { 'package.json': wrapper(), 'index.html': '<!doctype html>' }, { type: 'plain', source: '.', build: null });
  await detect(t, { 'package.json': wrapper(), 'prototype/index.html': '<!doctype html>' }, { type: 'plain', source: 'prototype', build: null });
});

test('a package.json with only afterimage-cli and no index.html anywhere is unknown, and says so', async t => {
  const found = await detect(t, { 'package.json': wrapper() }, { type: 'unknown', source: null, build: null });
  assert.match(found.reason, /no index\.html/);
  assert.doesNotMatch(found.reason, /no package\.json/);
});

test('a package.json with a build script is not taken for a plain folder', async t => {
  await detect(t, { 'package.json': wrapper({ scripts: { build: 'node make.js' } }), 'index.html': '<!doctype html>' }, { type: 'unknown', source: null, build: null });
});
