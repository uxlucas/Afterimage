import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { readConfig } from '../src/cli/config.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// answers lists what the terminal would reply, in order; without it the run has no TTY. questions collects what was asked.
async function run(cwd, args = [], { answers } = {}) {
  const out = [];
  const err = [];
  const questions = [];
  const ctx = { cwd, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, isTTY: Boolean(answers) };
  if (answers) {
    ctx.ask = async question => {
      questions.push(question);
      return answers.shift() ?? '';
    };
  }
  const code = await main(['init', ...args], ctx);
  return { code, stdout: out.join(''), stderr: err.join(''), questions };
}

const write = (root, name, text) => fs.writeFile(path.join(root, name), text);
const read = (root, name) => fs.readFile(path.join(root, name), 'utf8');
const readJson = async (root, name) => JSON.parse(await read(root, name));
const exists = async (root, name) => fs.stat(path.join(root, name)).then(() => true, () => false);

// Every file in the project with its bytes, so a second run can be compared byte for byte.
async function snapshot(root) {
  const files = {};
  for (const name of (await fs.readdir(root, { recursive: true })).sort()) {
    const stat = await fs.stat(path.join(root, name));
    if (stat.isFile()) files[name] = await fs.readFile(path.join(root, name));
  }
  return files;
}

const hostBuild = 'npm run afterimage:build';
const hostOutput = '.afterimage/site';
const lines = text => text.split(/\r?\n/);

test('init in a plain folder creates package.json and ignores node_modules', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);

  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: '.', build: null, type: 'plain' });
  assert.deepEqual(await readJson(root, 'package.json'), {
    private: true,
    scripts: { 'afterimage:save': 'afterimage save', 'afterimage:dev': 'afterimage dev', 'afterimage:build': 'afterimage build' }
  });
  assert.deepEqual(lines(await read(root, '.gitignore')).filter(Boolean), ['.afterimage/', 'node_modules/']);
  assert.deepEqual(lines(await read(root, '.gitattributes')).filter(Boolean), ['afterimage/** -text']);
  assert.match(result.stdout, /^Created afterimage\.config\.json/m);
  assert.match(result.stdout, /^Created package\.json \(added 3 scripts\)$/m);
  assert.match(result.stdout, /^Created \.gitignore$/m);
  assert.match(result.stdout, /^Created \.gitattributes$/m);
  assert.match(result.stdout, /^Created vercel\.json$/m);
  assert.match(result.stdout, /^Created netlify\.toml$/m);
  assert.ok(result.stdout.trimEnd().endsWith('Next: npx afterimage save "First version"'));
});

test('init reads the project before it creates package.json', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'site'));
  await write(root, 'site/index.html', '<h1>Hi</h1>');
  assert.equal((await run(root)).code, 0);
  assert.equal((await readConfig(root)).source, 'site');
});

test('init in a vite project saves its build output', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ name: 'demo', scripts: { build: 'vite build' }, devDependencies: { vite: '1.0.0' } }, null, 2) + '\n');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'dist', build: 'npm run build', type: 'vite' });
  const manifest = await readJson(root, 'package.json');
  assert.equal(manifest.name, 'demo');
  assert.equal(manifest.scripts.build, 'vite build');
  assert.equal(manifest.scripts['afterimage:build'], 'afterimage build');
  assert.match(result.stdout, /^Updated package\.json \(added 3 scripts\)$/m);
});

test('package.json keeps its scripts and only gets the ones it lacks', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'package.json', '{\n\t"devDependencies": { "vite": "1.0.0" },\n\t"scripts": {\n\t\t"afterimage:save": "my own save"\n\t}\n}\n');
  const result = await run(root);
  assert.match(result.stdout, /^Updated package\.json \(added 2 scripts\)$/m);
  const text = await read(root, 'package.json');
  assert.match(text, /^\t"scripts"/m, 'keeps the tab indent');
  const manifest = JSON.parse(text);
  assert.equal(manifest.scripts['afterimage:save'], 'my own save');
  assert.equal(manifest.scripts['afterimage:dev'], 'afterimage dev');
  assert.equal(manifest.scripts['afterimage:build'], 'afterimage build');
});

test('a different afterimage:build script is kept and called out', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' }, scripts: { 'afterimage:build': 'echo nope' } }));
  const result = await run(root);
  assert.equal((await readJson(root, 'package.json')).scripts['afterimage:build'], 'echo nope');
  assert.match(result.stdout, /already has "afterimage:build": "echo nope"/);
});

test('git files are appended without duplicating lines, in their own line ending', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, '.gitignore', 'dist\r\n/node_modules\r\n');
  await write(root, '.gitattributes', '* text=auto\nafterimage/** -text -diff');
  const result = await run(root);
  assert.equal(await read(root, '.gitignore'), 'dist\r\n/node_modules\r\n.afterimage/\r\n');
  assert.equal(await read(root, '.gitattributes'), '* text=auto\nafterimage/** -text -diff');
  assert.match(result.stdout, /^Updated \.gitignore \(added \.afterimage\/\)$/m);
  assert.doesNotMatch(result.stdout, /\.gitattributes/);
});

test('git attributes get a new line after a file with no final newline', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, '.gitattributes', '* text=auto');
  await run(root);
  assert.equal(await read(root, '.gitattributes'), '* text=auto\nafterimage/** -text\n');
});

test('init writes vercel.json and netlify.toml with the host build and output', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  assert.equal(await read(root, 'vercel.json'), `{\n  "buildCommand": "${hostBuild}",\n  "outputDirectory": "${hostOutput}"\n}\n`);
  assert.equal(await read(root, 'netlify.toml'), `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`);
});

test('an existing vercel.json keeps its other keys', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ cleanUrls: true, headers: [{ source: '/(.*)', headers: [] }] }, null, 4));
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const text = await read(root, 'vercel.json');
  assert.deepEqual(JSON.parse(text), {
    cleanUrls: true,
    headers: [{ source: '/(.*)', headers: [] }],
    buildCommand: hostBuild,
    outputDirectory: hostOutput
  });
  assert.ok(text.endsWith('}\n'));
  assert.match(text, /^ {2}"cleanUrls"/m, 'writes 2-space JSON');
  assert.match(result.stdout, /^Updated vercel\.json/m);
});

test('a different vercel.json build is switched only after the user says yes', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = JSON.stringify({ buildCommand: 'npm run build', outputDirectory: 'dist', framework: null }, null, 2) + '\n';
  await write(root, 'vercel.json', original);

  const declined = await run(root, [], { answers: ['n'] });
  assert.deepEqual(declined.questions, ["vercel.json already builds with npm run build. Switch it to Afterimage's build? (y/N)"]);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(declined.stdout, /Left vercel\.json as it is/);

  const agreed = await run(root, [], { answers: ['y'] });
  assert.equal(agreed.questions.length, 1);
  assert.deepEqual(await readJson(root, 'vercel.json'), { buildCommand: hostBuild, outputDirectory: hostOutput, framework: null });
  assert.match(agreed.stdout, /^Updated vercel\.json/m);
});

test('a different vercel.json build is left alone without a TTY and says what to set', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = JSON.stringify({ buildCommand: 'npm run build' }) + '\n';
  await write(root, 'vercel.json', original);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(result.stdout, /Left vercel\.json as it is/);
  assert.ok(result.stdout.includes(`"buildCommand": "${hostBuild}"`));
  assert.ok(result.stdout.includes(`"outputDirectory": "${hostOutput}"`));
  assert.doesNotMatch(result.stdout, /already set up/);
});

test('a vercel.json that is not JSON stops init before anything is written', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', '{ nope');
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /vercel\.json is not valid JSON/);
});

test('an existing netlify.toml is never rewritten', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = '[build]\n  command = "npm run build"\n  publish = "dist"\n\n[[redirects]]\n  from = "/a"\n  to = "/b"\n';
  await write(root, 'netlify.toml', original);
  const result = await run(root);
  assert.equal(await read(root, 'netlify.toml'), original);
  assert.match(result.stdout, /netlify\.toml already exists/);
  assert.ok(result.stdout.includes(`command = "${hostBuild}"`));
  assert.ok(result.stdout.includes(`publish = "${hostOutput}"`));
});

test('a netlify.toml that already has both values is left quiet', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'netlify.toml', `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`);
  const result = await run(root);
  assert.doesNotMatch(result.stdout, /netlify/);
});

test('init twice is a no-op', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  assert.equal((await run(root)).code, 0);
  const before = await snapshot(root);
  const second = await run(root);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await snapshot(root), before);
  assert.match(second.stdout, /^Everything is already set up\. Nothing changed\.$/m);
  assert.doesNotMatch(second.stdout, /^(Created|Updated)/m);
});

test('init twice is a no-op in a framework project too', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }, null, 2) + '\n');
  assert.equal((await run(root)).code, 0);
  const before = await snapshot(root);
  const second = await run(root);
  assert.deepEqual(await snapshot(root), before);
  assert.match(second.stdout, /already set up/);
});

test('init after a hand edit to the config keeps the edit', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  const config = await readJson(root, 'afterimage.config.json');
  await write(root, 'afterimage.config.json', JSON.stringify({ ...config, exclude: ['drafts'] }, null, 2) + '\n');
  const before = await snapshot(root);
  assert.equal((await run(root)).code, 0);
  assert.deepEqual(await snapshot(root), before);
});

test('--source and --build override detection', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const result = await run(root, ['--source', 'public/', '--build', 'node make.js']);
  assert.equal(result.code, 0, result.stderr);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'public', build: 'node make.js', type: 'unknown' });
});

test('--source naming the detected folder keeps the detected type and build', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }));
  await run(root, ['--source', './dist']);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'dist', build: 'npm run build', type: 'vite' });
});

test('--source without a build needs the folder to exist', async t => {
  const root = await temp(t);
  const result = await run(root, ['--source', 'nowhere']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /nowhere is not a folder here/);
  assert.equal(await exists(root, 'afterimage.config.json'), false);
});

test('--source outside the project is refused', async t => {
  const root = await temp(t);
  const result = await run(root, ['--source', '..']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside this project/);
});

test('flags on an existing config update it', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  const result = await run(root, ['--build', 'node make.js']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).build, 'node make.js');
  assert.match(result.stdout, /^Updated afterimage\.config\.json/m);
});

test('unknown project without a TTY asks for --source', async t => {
  const root = await temp(t);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /afterimage init --source <folder>/);
  assert.match(result.stderr, /--build "<command>"/);
  assert.deepEqual(Object.keys(await snapshot(root)), []);
});

test('unknown project in a TTY asks one question and uses the answer', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'out'));
  const result = await run(root, [], { answers: ['out'] });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.questions, ['Which folder holds your prototype, or which folder does your build write to?']);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'out', build: null, type: 'plain' });
});

test('an empty answer stops without writing anything', async t => {
  const root = await temp(t);
  const result = await run(root, [], { answers: [''] });
  assert.equal(result.code, 1);
  assert.deepEqual(Object.keys(await snapshot(root)), []);
});

test('next without static export stops and names output: export', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', 'export default {};\n');
  const before = await snapshot(root);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /output: 'export'/);
  assert.deepEqual(await snapshot(root), before);
});

test('next with static export is set up to save out/', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', "export default { output: 'export' };\n");
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).source, 'out');
});

test('an unknown flag is a usage error', async t => {
  const root = await temp(t);
  const result = await run(root, ['--nope']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Usage: afterimage init/);
});
