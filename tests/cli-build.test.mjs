import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { hostDocs } from '../src/cli/commands/build.js';
import { writeConfig } from '../src/cli/config.js';
import { readSnapshot, fingerprint } from '../src/cli/history.js';
import { assembleSite, isSameOrInside } from '../src/cli/site.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// Small stand-ins for the package's viewer and runtime, so these tests do not need a viewer build.
async function fixtures(t) {
  const root = await temp(t);
  const viewerDir = path.join(root, 'viewer');
  const runtimeDir = path.join(root, 'runtime');
  await fs.mkdir(path.join(viewerDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(viewerDir, 'index.html'), '<title>viewer</title>');
  await fs.writeFile(path.join(viewerDir, 'assets/viewer.js'), 'viewer();');
  await fs.mkdir(runtimeDir);
  await fs.writeFile(path.join(runtimeDir, 'runtime.js'), 'runtime();');
  return { viewerDir, runtimeDir };
}

async function run(cwd, args, extra = {}) {
  const out = [];
  const err = [];
  const code = await main(args, { cwd, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, buildStdio: 'ignore', ...extra });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

// The build copies page.txt to dist/index.html, so a test changes the build output by rewriting page.txt.
const copyBuild = `node -e "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html',fs.readFileSync('page.txt'))"`;
const configWith = (build, extra = {}) => ({ source: 'dist', build, history: 'afterimage', out: '.afterimage/site', exclude: [], type: 'unknown', ...extra });

async function project(t, config = configWith(copyBuild)) {
  const root = await temp(t);
  await writeConfig(root, config);
  await fs.writeFile(path.join(root, 'page.txt'), '<h1>One</h1>');
  return root;
}

const listing = async directory => (await fs.readdir(directory, { recursive: true })).map(name => name.replaceAll('\\', '/')).sort();
const exists = target => fs.access(target).then(() => true, () => false);

// Every path under a folder with its bytes, so a test can prove a folder is untouched.
const tree = async directory => Object.fromEntries(await Promise.all((await listing(directory)).map(async name => {
  const stat = await fs.stat(path.join(directory, name));
  return [name, stat.isFile() ? (await fs.readFile(path.join(directory, name))).toString('base64') : null];
})));

// Two saved versions, the second with a nested file, CRLF text and bytes that are not valid text.
async function twoVersions(t, config) {
  const root = await project(t, config);
  assert.equal((await run(root, ['save', 'First draft'])).code, 0);
  await fs.writeFile(path.join(root, 'page.txt'), '<h1>Two</h1>\r\n<img src="assets/pixel.png">');
  await fs.mkdir(path.join(root, 'dist/assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist/assets/pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x0d, 0x0a]));
  assert.equal((await run(root, ['save', 'Second draft'])).code, 0);
  return root;
}

test('build merges the app at the root and the history under /afterimage', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.writeFile(path.join(root, 'dist/style.css'), 'body{}');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `Built .afterimage/site with 2 versions. The history is at /afterimage/.\nServe it from the root of a domain, on a static host that does what ${hostDocs} lists.\n`);

  const site = path.join(root, '.afterimage/site');
  assert.deepEqual((await fs.readdir(site)).sort(), ['afterimage', 'assets', 'index.html', 'style.css']);
  assert.deepEqual((await fs.readdir(path.join(site, 'afterimage'))).sort(), ['assets', 'index.html', 'runtime.js', 'versions', 'versions.json']);
  assert.deepEqual((await fs.readdir(path.join(site, 'afterimage/versions'))).sort(), ['v1', 'v2']);
  // The app is the build output, byte for byte.
  assert.equal(await fs.readFile(path.join(site, 'index.html'), 'utf8'), '<h1>Two</h1>\r\n<img src="assets/pixel.png">');
  assert.deepEqual(await fs.readFile(path.join(site, 'assets/pixel.png')), await fs.readFile(path.join(root, 'dist/assets/pixel.png')));
  assert.equal(await fs.readFile(path.join(site, 'afterimage/index.html'), 'utf8'), '<title>viewer</title>');
  assert.equal(await fs.readFile(path.join(site, 'afterimage/assets/viewer.js'), 'utf8'), 'viewer();');
  assert.equal(await fs.readFile(path.join(site, 'afterimage/runtime.js'), 'utf8'), 'runtime();');
  assert.deepEqual(await fs.readdir(path.dirname(site)), ['site'], 'no staging folder is left next to the site');
});

test('history is copied byte for byte', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  const manifestText = await fs.readFile(path.join(root, 'afterimage/versions.json'));
  const served = path.join(root, '.afterimage/site/afterimage');
  assert.deepEqual(await fs.readFile(path.join(served, 'versions.json')), manifestText);
  for (const version of JSON.parse(manifestText).versions) {
    const files = await readSnapshot(path.join(served, 'versions', version.id), { strict: true });
    assert.equal(fingerprint(files), version.sha256, version.id);
  }
});

test('an app that already has /afterimage stops the build', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.mkdir(path.join(root, 'dist/Afterimage'));
  await fs.writeFile(path.join(root, 'dist/Afterimage/index.html'), 'mine');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already has an afterimage file or folder/);
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

test('a file named afterimage stops the build with the collision message; afterimage.html does not', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.writeFile(path.join(root, 'dist/afterimage.html'), 'fine');
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  await fs.writeFile(path.join(root, 'dist/afterimage'), 'mine');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already has an afterimage file or folder.*\/afterimage\//);
});

test('a changed saved version stops the build before anything is written', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t, configWith(`${copyBuild} && node -e "require('fs').writeFileSync('ran.txt','x')"`));
  await fs.rm(path.join(root, 'ran.txt'));
  await fs.writeFile(path.join(root, 'afterimage/versions/v1/index.html'), '<h1>Edited</h1>');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /v1 has changed since it was saved/);
  assert.equal(await exists(path.join(root, '.afterimage')), false);
  assert.equal(await exists(path.join(root, 'ran.txt')), false, 'the build did not run');
});

test('an unlisted snapshot stops the build before anything is written', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.mkdir(path.join(root, 'afterimage/versions/v99'));
  await fs.writeFile(path.join(root, 'afterimage/versions/v99/index.html'), 'stray');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unlisted snapshot/);
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

test('only the listed versions are copied, not the lock, stage folders or stray files', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const history = path.join(root, 'afterimage');
  await fs.writeFile(path.join(history, '.afterimage-save.lock'), '{"pid":1}');
  await fs.mkdir(path.join(history, '.afterimage-stage-abc/snapshot'), { recursive: true });
  await fs.writeFile(path.join(history, '.afterimage-stage-abc/snapshot/index.html'), 'half saved');
  await fs.writeFile(path.join(history, 'notes.txt'), 'stray');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  const served = await listing(path.join(root, '.afterimage/site/afterimage'));
  assert.deepEqual(served.filter(name => /lock|stage|notes|v99/.test(name)), []);
  assert.deepEqual(served.filter(name => /^versions\/[^/]+$/.test(name)), ['versions/v1', 'versions/v2']);
});

test('build with no versions explains how to save one', async t => {
  const dirs = await fixtures(t);
  const root = await project(t);
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'Save a first version with: afterimage save "Name"\n');
  assert.deepEqual((await fs.readdir(root)).sort(), ['afterimage.config.json', 'page.txt']);
});

test('a build that fails leaves the earlier site byte for byte', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  const site = path.join(root, '.afterimage/site');
  const snapshot = () => tree(site);
  const before = await snapshot();

  // The app build fails: nothing is staged yet.
  await writeConfig(root, configWith('node -e "process.exit(3)"'));
  const failedBuild = await run(root, ['build'], dirs);
  assert.equal(failedBuild.code, 1);
  assert.match(failedBuild.stderr, /The build failed \(exit code 3\)\. Nothing was built\./);
  assert.deepEqual(await snapshot(), before);

  // A step fails after the new site is already half written: a file where the runtime folder should be.
  await writeConfig(root, configWith(copyBuild));
  const brokenRuntime = path.join(dirs.runtimeDir, 'not-a-folder');
  await fs.writeFile(brokenRuntime, 'x');
  const failedCopy = await run(root, ['build'], { ...dirs, runtimeDir: brokenRuntime });
  assert.equal(failedCopy.code, 1);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await fs.readdir(path.dirname(site)), ['site'], 'the half-built folder is removed');
});

test('a second build replaces the first completely', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.writeFile(path.join(root, 'dist/old-only.txt'), 'old');
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  await fs.rm(path.join(root, 'dist/old-only.txt'));
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  assert.equal(await exists(path.join(root, '.afterimage/site/old-only.txt')), false);
  assert.deepEqual(await fs.readdir(path.join(root, '.afterimage')), ['site']);
});

test('with the prototype at the project root the project files stay out of the site', async t => {
  const dirs = await fixtures(t);
  const root = await project(t, configWith(null, { source: '.' }));
  await fs.rm(path.join(root, 'page.txt'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Root app</h1>');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/pkg/index.js'), 'x');
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, '.git/HEAD'), 'ref');
  assert.equal((await run(root, ['save', 'Only version'])).code, 0);
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Built \.afterimage\/site with 1 version\. /);
  assert.deepEqual((await fs.readdir(path.join(root, '.afterimage/site'))).sort(), ['afterimage', 'index.html']);
});

// What the app's own build ships reaches the live root as it is, even what a save leaves out of a version.
const served = name => name === 'afterimage' || name.startsWith('afterimage/');

test('a built app reaches the root byte for byte: host files, .well-known, source maps and any file type', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const shipped = {
    '_redirects': '/*  /index.html  200\n', '.well-known/security.txt': 'Contact: mailto:a@b.c\r\n',
    'assets/app.js.map': '{"version":3}', 'model.glb': Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0xff])
  };
  for (const [name, bytes] of Object.entries(shipped)) {
    await fs.mkdir(path.dirname(path.join(root, 'dist', name)), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', name), bytes);
  }
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  const site = await tree(path.join(root, '.afterimage/site'));
  const app = await tree(path.join(root, 'dist'));
  assert.deepEqual(Object.fromEntries(Object.entries(site).filter(([name]) => !served(name))), app);
  for (const name of Object.keys(shipped)) assert.ok(name in site, name);
});

test('a plain folder at the project root keeps its hidden files off the site, except .well-known', async t => {
  const dirs = await fixtures(t);
  const root = await project(t, configWith(null, { source: '.' }));
  await fs.rm(path.join(root, 'page.txt'));
  const files = { 'index.html': '<h1>Root app</h1>', '.env': 'SECRET=1', '.gitignore': 'x', '.vscode/settings.json': '{}', '.well-known/x': 'proof', 'app.js.map': '{}' };
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  }
  assert.equal((await run(root, ['save', 'Only version'])).code, 0);
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  const site = path.join(root, '.afterimage/site');
  assert.deepEqual((await listing(site)).filter(name => !served(name)), ['.well-known', '.well-known/x', 'app.js.map', 'index.html']);
  assert.equal(await fs.readFile(path.join(site, '.well-known/x'), 'utf8'), 'proof');
});

test('a hand-made folder with no build keeps its hidden files and a history inside it off the site', async t => {
  const dirs = await fixtures(t);
  const root = await project(t, configWith(null, { source: 'site', history: 'site/history' }));
  const files = { 'site/index.html': '<h1>Hand made</h1>', 'site/.env': 'SECRET=1', 'site/.well-known/x': 'proof' };
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  }
  assert.equal((await run(root, ['save', 'Only version'])).code, 0);
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  const site = path.join(root, '.afterimage/site');
  assert.deepEqual((await listing(site)).filter(name => !served(name)), ['.well-known', '.well-known/x', 'index.html']);
  assert.deepEqual(await listing(path.join(root, 'site/history/versions/v1')), ['index.html']);
});

test('assembleSite without the app writes only the afterimage folder and ignores the app', async t => {
  const dirs = await fixtures(t);
  // The build would fail and the app has its own afterimage folder: neither matters without the app.
  const root = await twoVersions(t);
  const config = configWith('node -e "process.exit(3)"');
  await fs.mkdir(path.join(root, 'dist/afterimage'));
  await fs.writeFile(path.join(root, 'dist/afterimage/index.html'), 'mine');
  const { outDir, versions } = await assembleSite({ projectDir: root, config, ...dirs, includeApp: false, buildStdio: 'ignore' });
  assert.equal(versions, 2);
  assert.equal(outDir, path.join(root, '.afterimage/site'));
  assert.deepEqual(await fs.readdir(outDir), ['afterimage']);
  assert.deepEqual((await fs.readdir(path.join(outDir, 'afterimage'))).sort(), ['assets', 'index.html', 'runtime.js', 'versions', 'versions.json']);
});

test('assembleSite with the app returns the output folder and version count', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const { outDir, versions } = await assembleSite({ projectDir: root, config: configWith(copyBuild), ...dirs, buildStdio: 'ignore' });
  assert.equal(versions, 2);
  assert.deepEqual((await fs.readdir(outDir)).sort(), ['afterimage', 'assets', 'index.html']);
});

// overlay.js is the pill a plain page loads with a script tag; bundled apps import the same file from the package.
test('the packaged runtime is served as frame.js, overlay.js and sw.js only, byte for byte', async t => {
  const { viewerDir } = await fixtures(t);
  const root = await twoVersions(t);
  // No runtimeDir: the package's own src/runtime, which still holds map.js for node.
  const result = await run(root, ['build'], { viewerDir });
  assert.equal(result.code, 0, result.stderr);
  const served = path.join(root, '.afterimage/site/afterimage');
  const runtime = new URL('../src/runtime/', import.meta.url);
  const inRuntime = await fs.readdir(runtime);
  assert.ok(inRuntime.includes('map.js'));
  const shipped = [];
  for (const name of inRuntime) if (await exists(path.join(served, name))) shipped.push(name);
  assert.deepEqual(shipped.sort(), ['frame.js', 'overlay.js', 'sw.js']);
  for (const name of shipped) assert.deepEqual(await fs.readFile(path.join(served, name)), await fs.readFile(new URL(name, runtime)));
  // Nothing else in the folder came from the runtime: the rest is the viewer and the history.
  assert.deepEqual((await fs.readdir(served)).sort(), ['assets', 'frame.js', 'index.html', 'overlay.js', 'sw.js', 'versions', 'versions.json']);
});

test('a missing runtime folder stops the build and writes nothing', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const missing = path.join(dirs.runtimeDir, 'missing');
  const result = await run(root, ['build'], { ...dirs, runtimeDir: missing });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `The frame runtime is missing (${missing}). Reinstall afterimage-cli.\n`);
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

test('a viewer that is not built says how to build it and writes nothing', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const result = await run(root, ['build'], { ...dirs, viewerDir: path.join(dirs.viewerDir, 'missing') });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'The viewer is not built. Run "npm run build:viewer" first.\n');
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

// Case-insensitive file systems (Windows, macOS) treat these spellings as the same folder.
const ignoresCase = process.platform === 'win32' || process.platform === 'darwin';

test('an out folder that would replace or sit inside the project, history or source is refused', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const cases = [
    ['.', /would replace/],
    ['afterimage', /would replace/],
    ['afterimage/', /would replace/],
    ['dist', /would replace/],
    ['afterimage/versions', /inside the history folder/],
    ['afterimage/site', /inside the history folder/],
    ['dist/site', /inside the source folder/],
    ...(ignoresCase ? [['AFTERIMAGE', /would replace/], ['AFTERIMAGE/versions', /inside the history folder/], ['DIST', /would replace/], ['Dist/Site', /inside the source folder/]] : []),
  ];
  const before = { history: await tree(path.join(root, 'afterimage')), source: await tree(path.join(root, 'dist')) };
  for (const [out, message] of cases) {
    await writeConfig(root, configWith(copyBuild, { out }));
    const result = await run(root, ['build'], dirs);
    assert.equal(result.code, 1, out);
    assert.match(result.stderr, message, out);
    assert.deepEqual(await tree(path.join(root, 'afterimage')), before.history, `history untouched for ${out}`);
    assert.deepEqual(await tree(path.join(root, 'dist')), before.source, `source untouched for ${out}`);
  }
  assert.equal(await exists(path.join(root, '.afterimage')), false);
});

test('a folder whose name starts with two dots is inside, not outside', () => {
  const base = path.resolve('project');
  assert.equal(isSameOrInside(path.join(base, '..cache', 'x'), path.join(base, '..cache')), true);
  assert.equal(isSameOrInside(path.join(base, '..cache'), base), true);
  assert.equal(isSameOrInside(base, base), true);
  assert.equal(isSameOrInside(base, path.join(base, 'dist')), false);
  assert.equal(isSameOrInside(path.resolve('other'), base), false);
});

test('an out folder of its own next to the source is allowed', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t, configWith(copyBuild, { out: 'public-site' }));
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  assert.equal(await exists(path.join(root, 'public-site/afterimage/versions.json')), true);
});

test('an out path that is a file is refused, not replaced', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await fs.mkdir(path.join(root, '.afterimage'));
  await fs.writeFile(path.join(root, '.afterimage/site'), 'precious');
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /is not a folder/);
  assert.equal(await fs.readFile(path.join(root, '.afterimage/site'), 'utf8'), 'precious');
});

test('stale staging folders from a crashed build are cleared, other names are left alone', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  const parent = path.join(root, '.afterimage');
  await fs.mkdir(path.join(parent, 'site.tmp-deadbeef'), { recursive: true });
  await fs.writeFile(path.join(parent, 'site.tmp-deadbeef/leftover.txt'), 'x');
  await fs.mkdir(path.join(parent, 'site.tmp-cafe0123.old'));
  await fs.mkdir(path.join(parent, 'site.tmp-keepme'));
  await fs.mkdir(path.join(parent, 'sitextmp-deadbeef'));
  await fs.mkdir(path.join(parent, 'other.tmp-deadbeef'));
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  assert.deepEqual((await fs.readdir(parent)).sort(), ['other.tmp-deadbeef', 'site', 'site.tmp-keepme', 'sitextmp-deadbeef']);
});

// The swap steps aside the old site (rename 1), moves the new one in (rename 2) and restores on failure (rename 3).
describe('the swap', () => {
  const failing = (failAt, code) => {
    let calls = 0;
    const log = [];
    return {
      log,
      fsOps: {
        rename: async (from, to) => {
          calls += 1;
          log.push(calls);
          if (failAt.includes(calls)) throw Object.assign(new Error(`${code}: injected`), { code });
          return fs.rename(from, to);
        },
      },
    };
  };
  async function builtProject(t) {
    const dirs = await fixtures(t);
    const root = await twoVersions(t);
    assert.equal((await run(root, ['build'], dirs)).code, 0);
    await fs.writeFile(path.join(root, 'page.txt'), '<h1>Three</h1>');
    return { dirs, root, site: path.join(root, '.afterimage/site') };
  }
  const assemble = (root, dirs, extra) => assembleSite({ projectDir: root, config: configWith(copyBuild), ...dirs, buildStdio: 'ignore', ...extra });

  test('a locked old site gives a clear message and stays as it was', async t => {
    const { dirs, root, site } = await builtProject(t);
    const before = await tree(site);
    const { fsOps } = failing([1, 2], 'EPERM');
    await assert.rejects(assemble(root, dirs, { fsOps }), /Could not replace \.afterimage\/site: a file in it is in use\. Close anything serving it \(like afterimage dev or a static server\) and run build again\. The previous site is unchanged\./);
    assert.deepEqual(await tree(site), before);
    assert.deepEqual(await fs.readdir(path.dirname(site)), ['site']);
  });

  test('a lock that clears on its own is retried once', async t => {
    const { dirs, root, site } = await builtProject(t);
    const { fsOps, log } = failing([1], 'EBUSY');
    const result = await assemble(root, dirs, { fsOps });
    assert.equal(result.versions, 2);
    assert.deepEqual(log, [1, 2, 3]);
    assert.equal(await fs.readFile(path.join(site, 'index.html'), 'utf8'), '<h1>Three</h1>');
  });

  test('when the new site cannot move in, the old one is restored', async t => {
    const { dirs, root, site } = await builtProject(t);
    const before = await tree(site);
    const { fsOps } = failing([2], 'EXDEV');
    await assert.rejects(assemble(root, dirs, { fsOps }), /EXDEV: injected/);
    assert.deepEqual(await tree(site), before);
    assert.deepEqual(await fs.readdir(path.dirname(site)), ['site'], 'no staging or .old folder is left');
  });

  test('when restoring fails too, the original error is kept and the old site location is named', async t => {
    const { dirs, root, site } = await builtProject(t);
    const { fsOps } = failing([2, 3], 'EXDEV');
    await assert.rejects(assemble(root, dirs, { fsOps }), error => {
      assert.match(error.message, /^EXDEV: injected/);
      assert.match(error.message, /The previous site could not be put back; it was left at .*site\.tmp-[0-9a-f]{8}\.old\./);
      return true;
    });
    const left = (await fs.readdir(path.dirname(site))).filter(name => name.endsWith('.old'));
    assert.equal(left.length, 1);
    assert.equal(await exists(path.join(path.dirname(site), left[0], 'index.html')), true);
  });

  test('a locked new site whose restore also fails does not claim the old site is unchanged', async t => {
    const { dirs, root, site } = await builtProject(t);
    const { fsOps } = failing([2, 3, 4], 'EPERM');
    await assert.rejects(assemble(root, dirs, { fsOps }), error => {
      assert.match(error.message, /^Could not replace \.afterimage\/site: a file in it is in use\./);
      assert.doesNotMatch(error.message, /unchanged/);
      assert.match(error.message, /could not be put back; it was left at .*\.old\./);
      return true;
    });
    assert.equal((await fs.readdir(path.dirname(site))).filter(name => name.endsWith('.old')).length, 1);
  });

  test('failing to remove the old site warns and still builds', async t => {
    const { dirs, root, site } = await builtProject(t);
    const result = await assemble(root, dirs, { fsOps: { rm: async () => { throw Object.assign(new Error('EBUSY: injected'), { code: 'EBUSY' }); } } });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /^Built, but could not remove the previous site at .*\.old: EBUSY: injected/);
    assert.equal(await fs.readFile(path.join(site, 'index.html'), 'utf8'), '<h1>Three</h1>');
    // The next build clears it.
    assert.equal((await run(root, ['build'], dirs)).code, 0);
    assert.deepEqual(await fs.readdir(path.dirname(site)), ['site']);
  });
});

test('build outside a project points to init, and rejects stray arguments', async t => {
  const root = await temp(t);
  const outside = await run(root, ['build']);
  assert.equal(outside.code, 1);
  assert.equal(outside.stderr, 'No afterimage.config.json here. Run "afterimage init" first.\n');
  const extra = await run(root, ['build', 'now']);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /Usage: afterimage build/);
  const help = await run(root, ['build', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: afterimage build/);
});

test('an out that only normalizes to the output folder builds twice without nesting', async t => {
  const dirs = await fixtures(t);
  const root = await project(t, configWith(null, { source: '.', out: 'x/../site' }));
  await fs.rm(path.join(root, 'page.txt'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Root app</h1>');
  assert.equal((await run(root, ['save', 'Only version'])).code, 0);
  for (let build = 0; build < 2; build += 1) assert.equal((await run(root, ['build'], dirs)).code, 0);
  assert.deepEqual((await fs.readdir(path.join(root, 'site'))).sort(), ['afterimage', 'index.html']);
  assert.equal((await run(root, ['save', 'Again'])).stdout.startsWith('Nothing changed'), true, 'a save still ignores the built site');
});

test('a source above the project and an absolute out are refused by the config', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t);
  await writeConfig(root, configWith(copyBuild)).then(() => fs.writeFile(path.join(root, 'afterimage.config.json'), JSON.stringify({ source: '..', build: null })));
  const above = await run(root, ['build'], dirs);
  assert.equal(above.code, 1);
  assert.match(above.stderr, /needs "source" to be a folder inside the project/);
  await fs.writeFile(path.join(root, 'afterimage.config.json'), JSON.stringify({ source: 'dist', out: path.join(root, 'abs-site') }));
  const absolute = await run(root, ['build'], dirs);
  assert.equal(absolute.code, 1);
  assert.match(absolute.stderr, /needs "out" to be a folder inside the project/);
  assert.equal(await exists(path.join(root, 'abs-site')), false);
});

test('a build command that deletes the earlier site still builds', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t, configWith(`${copyBuild} && node -e "require('fs').rmSync('.afterimage',{recursive:true,force:true})"`));
  assert.equal((await run(root, ['build'], dirs)).code, 0);
  await fs.rm(path.join(root, '.afterimage/site/afterimage/runtime.js'), { force: true });
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await fs.readdir(path.join(root, '.afterimage'))).sort(), ['site']);
  assert.equal(await exists(path.join(root, '.afterimage/site/afterimage/versions.json')), true);
});

test('a build command that creates the out folder does not break the swap', async t => {
  const dirs = await fixtures(t);
  const root = await twoVersions(t, configWith(`${copyBuild} && node -e "const fs=require('fs');if(process.env.MAKE_OUT){fs.mkdirSync('.afterimage/site',{recursive:true});fs.writeFileSync('.afterimage/site/made-by-build.txt','x')}"`));
  assert.equal(await exists(path.join(root, '.afterimage')), false);
  process.env.MAKE_OUT = '1';
  t.after(() => { delete process.env.MAKE_OUT; });
  const result = await run(root, ['build'], dirs);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await exists(path.join(root, '.afterimage/site/made-by-build.txt')), false, 'the created folder was replaced');
  assert.equal(await exists(path.join(root, '.afterimage/site/afterimage/versions.json')), true);
  assert.deepEqual(await fs.readdir(path.join(root, '.afterimage')), ['site']);
});
