import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli/main.js';
import { writeConfig } from '../src/cli/config.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// Collects what a command writes so tests can read it back. The build's own output is dropped.
async function run(cwd, args) {
  const out = [];
  const err = [];
  const code = await main(args, { cwd, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, buildStdio: 'ignore' });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

// The build copies page.txt to dist/index.html, so a test changes the build output by rewriting page.txt.
const copyBuild = `node -e "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html',fs.readFileSync('page.txt'))"`;
const configWith = build => ({ source: 'dist', build, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown' });

async function project(t, build = copyBuild) {
  const root = await temp(t);
  await writeConfig(root, configWith(build));
  await fs.writeFile(path.join(root, 'page.txt'), '<h1>One</h1>');
  return root;
}

const listing = async directory => (await fs.readdir(directory, { recursive: true })).sort();

test('save builds, then saves the build output as the next version', async t => {
  const root = await project(t);
  const first = await run(root, ['save', 'First draft', '--note', 'Rough layout', '--note', 'No copy yet']);
  assert.equal(first.code, 0);
  assert.equal(first.stdout, 'Saved v1 "First draft".\n');
  await fs.writeFile(path.join(root, 'page.txt'), '<h1>Two</h1>');
  const second = await run(root, ['save', 'Second draft']);
  assert.equal(second.code, 0);
  assert.equal(second.stdout, 'Saved v2 "Second draft".\n');
  const history = path.join(root, 'afterimage');
  assert.equal(await fs.readFile(path.join(history, 'versions/v1/index.html'), 'utf8'), '<h1>One</h1>');
  assert.equal(await fs.readFile(path.join(history, 'versions/v2/index.html'), 'utf8'), '<h1>Two</h1>');
  const manifest = JSON.parse(await fs.readFile(path.join(history, 'versions.json'), 'utf8'));
  assert.deepEqual(manifest.versions.map(version => version.id), ['v2', 'v1']);
  assert.deepEqual(manifest.versions[1].notes, ['Rough layout', 'No copy yet']);
});

test('save with no change says so and writes nothing', async t => {
  const root = await project(t);
  await run(root, ['save', 'First draft']);
  const before = await listing(path.join(root, 'afterimage'));
  const again = await run(root, ['save', 'Same again']);
  assert.equal(again.code, 0);
  assert.equal(again.stdout, 'Nothing changed since v1 "First draft". Nothing was saved.\n');
  assert.deepEqual(await listing(path.join(root, 'afterimage')), before);
});

test('save without a build command saves the source folder as it is', async t => {
  const root = await project(t, null);
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Hand made</h1>');
  const result = await run(root, ['save', 'By hand']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Saved v1 "By hand".\n');
});

test('a failing build saves nothing and leaves no lock or stage folder', async t => {
  const root = await project(t);
  await run(root, ['save', 'First draft']);
  await writeConfig(root, configWith('node -e "process.exit(3)"'));
  // The leftover output differs from v1, so a save that ignored the failed build would show up as v2.
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Left over</h1>');
  const history = path.join(root, 'afterimage');
  const before = await listing(history);
  const result = await run(root, ['save', 'Second draft']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /The build failed \(exit code 3\)\. Nothing was saved\./);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.deepEqual(await listing(history), before);
  assert.deepEqual((await fs.readdir(history)).filter(name => name.startsWith('.afterimage-')), []);
});

test('a plain folder set up by init saves, without the project files init wrote next to it', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Plain</h1>');
  assert.equal((await run(root, ['init'])).code, 0);
  const result = await run(root, ['save', 'First draft']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await fs.readdir(path.join(root, 'afterimage/versions/v1')), ['index.html']);
});

test('save outside a project points to init', async t => {
  const root = await temp(t);
  const result = await run(root, ['save', 'First draft']);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'No afterimage.config.json here. Run "afterimage init" first.\n');
});

test('save without a name explains the usage', async t => {
  const root = await project(t);
  const result = await run(root, ['save']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /needs a name/);
  assert.match(result.stderr, /Usage: afterimage save "Name" \[--note "\.\.\."\]/);
  assert.equal((await fs.readdir(root)).includes('afterimage'), false);
});

test('save rejects a second name and unknown options as usage errors', async t => {
  const root = await project(t);
  const extra = await run(root, ['save', 'One', 'Two']);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /one name/);
  const unknown = await run(root, ['save', 'One', '--notes', 'typo']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Usage: afterimage save/);
});

test('an invalid name is a plain message, not a stack', async t => {
  const root = await project(t);
  const result = await run(root, ['save', 'x'.repeat(121)]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'Provide a version name up to 120 characters and notes up to 500 characters each.\n');
});

test('help lists the commands and unknown commands exit 2', async t => {
  const root = await temp(t);
  for (const args of [['--help'], ['-h'], ['help'], []]) {
    const result = await run(root, args);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /afterimage save "Name"/);
  }
  const one = await run(root, ['help', 'save']);
  assert.equal(one.code, 0);
  assert.match(one.stdout, /^Usage: afterimage save/);
  assert.equal((await run(root, ['save', '--help'])).code, 0);
  const unknown = await run(root, ['frobnicate']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command "frobnicate"/);
  assert.equal((await run(root, ['help', 'frobnicate'])).code, 2);
  assert.equal((await run(root, ['toString'])).code, 2);
});

test('"afterimage help <command>" prints exactly what "<command> --help" prints, for every command', async t => {
  const root = await temp(t);
  for (const name of ['init', 'save', 'dev', 'build']) {
    const viaHelp = await run(root, ['help', name]);
    const viaFlag = await run(root, [name, '--help']);
    assert.equal(viaHelp.code, 0, name);
    assert.equal(viaFlag.code, 0, name);
    assert.equal(viaHelp.stdout, viaFlag.stdout, name);
    assert.match(viaHelp.stdout, new RegExp(`^Usage: afterimage ${name}`));
  }
  // Each flag a command takes is described in its help.
  assert.match((await run(root, ['help', 'init'])).stdout, /\n {2}--source[\s\S]*\n {2}--build[\s\S]*\n {2}--agent[\s\S]*\n {2}--no-input/);
  assert.match((await run(root, ['help', 'save'])).stdout, /\n {2}--note/);
  assert.match((await run(root, ['help', 'dev'])).stdout, /\n {2}--port/);
});

test('the afterimage binary prints help and lists save', () => {
  const bin = fileURLToPath(new URL('../bin/afterimage.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\bsave\b/);
});

test('a plain folder at the project root saves without its README, LICENSE and agent notes', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Plain</h1>');
  for (const name of ['README.md', 'LICENSE', 'CLAUDE.md', 'agents.md']) await fs.writeFile(path.join(root, name), 'project notes');
  assert.equal((await run(root, ['init'])).code, 0);
  const result = await run(root, ['save', 'First draft']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await fs.readdir(path.join(root, 'afterimage/versions/v1')), ['index.html']);
  const built = await run(root, ['build']);
  assert.equal(built.code, 0, built.stderr);
  for (const name of ['README.md', 'LICENSE', 'CLAUDE.md', 'agents.md']) {
    assert.ok(!await fs.stat(path.join(root, '.afterimage/site', name)).catch(() => null), `${name} is not deployed`);
  }
});

test('pages named like the docs stay in a save: license.html, agents.html and an agents/ folder', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Plain</h1>');
  for (const name of ['license.html', 'agents.html', 'README.md', 'LICENSE', 'CLAUDE.md']) await fs.writeFile(path.join(root, name), '<p>page</p>');
  await fs.mkdir(path.join(root, 'agents'));
  await fs.writeFile(path.join(root, 'agents/index.html'), '<h1>Agents</h1>');
  assert.equal((await run(root, ['init'])).code, 0);
  const result = await run(root, ['save', 'First draft']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await listing(path.join(root, 'afterimage/versions/v1')), ['agents', 'agents.html', path.join('agents', 'index.html'), 'index.html', 'license.html'].sort());
});
