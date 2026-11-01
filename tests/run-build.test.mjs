import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBuild } from '../src/cli/run-build.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// Sets environment variables for one test and puts them back after it.
function withEnv(t, values) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// A build like SvelteKit's adapter-static: it writes build/ on a laptop and .vercel/output/static when VERCEL is set. It
// also records VERCEL_URL, to show only VERCEL is taken away.
const adapterLikeBuild = `node -e "const fs=require('fs');const dir=process.env.VERCEL?'.vercel/output/static':'build';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/index.html','<h1>Hi</h1>');fs.writeFileSync('seen.txt',String(process.env.VERCEL_URL))"`;

test('the build runs without VERCEL, so a tool that switches output on it still writes its plain folder', async t => {
  const root = await temp(t);
  withEnv(t, { VERCEL: '1', VERCEL_URL: 'demo.vercel.app' });
  await runBuild(adapterLikeBuild, root, { stdio: 'ignore' });
  assert.equal(await fs.readFile(path.join(root, 'build/index.html'), 'utf8'), '<h1>Hi</h1>');
  await assert.rejects(fs.access(path.join(root, '.vercel')));
  assert.equal(await fs.readFile(path.join(root, 'seen.txt'), 'utf8'), 'demo.vercel.app', 'the other Vercel variables are kept');
});

test('the build is not changed when VERCEL is not set', async t => {
  const root = await temp(t);
  withEnv(t, { VERCEL_URL: 'demo.vercel.app' });
  delete process.env.VERCEL;
  await runBuild(adapterLikeBuild, root, { stdio: 'ignore' });
  assert.equal(await fs.readFile(path.join(root, 'build/index.html'), 'utf8'), '<h1>Hi</h1>');
});

test('the rest of the environment reaches the build', async t => {
  const root = await temp(t);
  withEnv(t, { AFTERIMAGE_TEST_MARK: 'kept' });
  await runBuild(`node -e "require('fs').writeFileSync('mark.txt',process.env.AFTERIMAGE_TEST_MARK)"`, root, { stdio: 'ignore' });
  assert.equal(await fs.readFile(path.join(root, 'mark.txt'), 'utf8'), 'kept');
});
