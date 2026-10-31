import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExample } from './harness.mjs';

const example = name => fileURLToPath(new URL(`../../examples/${name}/`, import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
const bin = fileURLToPath(new URL('../../bin/afterimage.mjs', import.meta.url));

// The real command, as a user would run it in that folder. stdin is closed, so init never waits on a question.
function afterimage(cwd, ...args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, `afterimage ${args.join(' ')} failed in ${cwd}:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

test('northwind: every version renders and v3 shows its changes', async () => {
  const report = await checkExample(example('northwind'), { expectChange: 'Sign in with passkey' });
  assert.deepEqual(report.versions.map(version => version.id), ['v3', 'v2', 'v1']);
});

test('vite-react: home and /about render inside the viewer, the live app at / is untouched', async () => {
  const dir = example('vite-react');
  const report = await checkExample(dir, { expectChange: 'Ship the prototype', follow: { link: 'About this app', shows: 'A second route' } });
  assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
  // The router sees its own path, and the click stayed in the version it started in.
  assert.equal(report.followed.path, '/about');
  // The root is the app's own build, byte for byte: nothing Afterimage adds reaches it.
  const site = path.join(dir, '.afterimage/site');
  assert.deepEqual(await fs.readFile(path.join(site, 'index.html')), await fs.readFile(path.join(dir, 'dist/index.html')));
});

test('next-static: home and /about render inside the viewer, the live app at / is untouched', async () => {
  const dir = example('next-static');
  // Next 16.4.3's export (next/dist/export/index.js) names a segment file from path.relative, then replaces only "/"
  // with ".". On Windows that path has backslashes, so the build writes about/__next.about/__PAGE__.txt, while the
  // router asks for about/__next.about.__PAGE__.txt and falls back to about.txt when it is missing. The committed
  // history was built on Windows, so its versions miss the file on every OS, and so does the live app at / when it is
  // built on Windows. A build elsewhere writes the dot form, which the live app then finds.
  const appMisses = [/^\/about\/__next\.about\.__PAGE__\.txt$/];
  const report = await checkExample(dir, { expectChange: 'Launch day is Friday', follow: { link: 'About this site', shows: 'A second page' }, appMisses });
  assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
  // The App Router took the click (the document is still the entry page) and moved to its own clean path.
  assert.deepEqual([report.followed.path, report.followed.file], ['/about', '/afterimage/versions/v2/index.html']);
  const site = path.join(dir, '.afterimage/site');
  assert.deepEqual(await fs.readFile(path.join(site, 'index.html')), await fs.readFile(path.join(dir, 'out/index.html')));
});

test('astro: both pages render inside the viewer, and a hard link stays in the version', async () => {
  const dir = example('astro');
  const report = await checkExample(dir, { expectChange: 'Field notes from the coast', follow: { link: 'About this site', shows: 'A second page' } });
  assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
  // Astro writes about/index.html and links to /about. The click loads a new document, which the worker answers with a
  // redirect to /about/, as a host would.
  assert.deepEqual([report.followed.path, report.followed.file], ['/about/', '/afterimage/versions/v2/about/']);
  const site = path.join(dir, '.afterimage/site');
  assert.deepEqual(await fs.readFile(path.join(site, 'index.html')), await fs.readFile(path.join(dir, 'dist/index.html')));
});

test('sveltekit-static: both prerendered routes render inside the viewer, and the page hydrates', async () => {
  const dir = example('sveltekit-static');
  const report = await checkExample(dir, {
    expectChange: 'Welcome back to the studio',
    // The counter's state changes only once the page has hydrated.
    press: { button: 'Count is 0', shows: 'Count is 1' },
    follow: { link: 'About this site', shows: 'A second route' },
  });
  assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
  assert.ok(report.pressed);
  // The router took the click too, so the document is still the entry page.
  assert.deepEqual([report.followed.path, report.followed.file], ['/about', '/afterimage/versions/v2/index.html']);
  const site = path.join(dir, '.afterimage/site');
  assert.deepEqual(await fs.readFile(path.join(site, 'index.html')), await fs.readFile(path.join(dir, 'build/index.html')));
});

// The harness itself: a version that lost one of its files must fail the check, or the passes above mean nothing.
test('the check fails when a version is missing a file it loads', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture('multipage'), dir, { recursive: true });
  afterimage(dir, 'init');
  afterimage(dir, 'save', 'One');
  const page = path.join(dir, 'index.html');
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace('<h1>Page one</h1>', '<h1>Page one, revised</h1>'));
  afterimage(dir, 'save', 'Two');

  // Removed from the built site only, so the saved history still verifies.
  const build = () => {
    afterimage(dir, 'build');
    rmSync(path.join(dir, '.afterimage/site/afterimage/versions/v2/style.css'));
  };
  await assert.rejects(checkExample(dir, { expectChange: 'Page one, revised', build }), /Version v2: these requests failed[\s\S]*404 \S+\/style\.css/);
});

test('a multi-page plain site keeps hard links inside the version', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture('multipage'), dir, { recursive: true });
  afterimage(dir, 'init');
  afterimage(dir, 'save', 'One');
  const page = path.join(dir, 'index.html');
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace('<h1>Page one</h1>', '<h1>Page one, revised</h1>'));
  afterimage(dir, 'save', 'Two');

  const report = await checkExample(dir, {
    expectChange: 'Page one, revised',
    build: () => afterimage(dir, 'build'),
    follow: { link: 'Go to page two', shows: 'Reached by a hard link' },
  });
  assert.equal(report.followed.path, '/two.html');
});

test('an app that moves itself to another path on load still gets its review', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture('multipage'), dir, { recursive: true });
  afterimage(dir, 'init');
  afterimage(dir, 'save', 'One');
  // The second version redirects itself once loaded, as a locale or sign-in redirect would. frame.js's own load
  // listener runs first, so only the Navigation API's currententrychange sees the move.
  const page = path.join(dir, 'index.html');
  const redirect = '<script>addEventListener(\'load\', () => history.replaceState(null, \'\', \'/home\'));</script>\n  </body>';
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace('<h1>Page one</h1>', '<h1>Page one, revised</h1>').replace('</body>', redirect));
  afterimage(dir, 'save', 'Two');

  // checkExample's compare step waits for the pill's count, which the review gives only to the page it compares.
  const report = await checkExample(dir, { expectChange: 'Page one, revised', build: () => afterimage(dir, 'build'), appPath: '/home' });
  assert.deepEqual(report.versions.map(version => [version.id, version.path]), [['v2', '/home'], ['v1', '/']]);
});
