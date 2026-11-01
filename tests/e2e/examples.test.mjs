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

// What each example is held to, and what its report must show. The tests below run these through two hosts: the harness's
// own server, and a plain static host (see the end of this block).
const checks = {
  northwind: {
    options: { expectChange: 'Sign in with passkey' },
    verify: report => assert.deepEqual(report.versions.map(version => version.id), ['v3', 'v2', 'v1'])
  },
  'vite-react': {
    options: { expectChange: 'Ship the prototype', follow: { link: 'About this app', shows: 'A second route' } },
    verify: report => {
      assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
      // The router sees its own path, and the click stayed in the version it started in.
      assert.equal(report.followed.path, '/about');
    }
  },
  'next-static': {
    // Next 16.4.3's export (next/dist/export/index.js) names a segment file from path.relative, then replaces only "/"
    // with ".". On Windows that path has backslashes, so the build writes about/__next.about/__PAGE__.txt, while the
    // router asks for about/__next.about.__PAGE__.txt and falls back to about.txt when it is missing. The committed
    // history was built on Windows, so its versions miss the file on every OS, and so does the live app at / when it is
    // built on Windows. A build elsewhere writes the dot form, which the live app then finds.
    options: { expectChange: 'Launch day is Friday', follow: { link: 'About this site', shows: 'A second page' }, appMisses: [/^\/about\/__next\.about\.__PAGE__\.txt$/] },
    verify: report => {
      assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
      // The App Router took the click (the document is still the entry page) and moved to its own clean path.
      assert.deepEqual([report.followed.path, report.followed.file], ['/about', '/afterimage/versions/v2/index.html']);
    }
  },
  astro: {
    options: { expectChange: 'Field notes from the coast', follow: { link: 'About this site', shows: 'A second page' } },
    verify: report => {
      assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
      // Astro writes about/index.html and links to /about. The click loads a new document, which the worker answers with a
      // redirect to /about/, as a host would.
      assert.deepEqual([report.followed.path, report.followed.file], ['/about/', '/afterimage/versions/v2/about/']);
    }
  },
  'sveltekit-static': {
    options: {
      expectChange: 'Welcome back to the studio',
      // The counter's state changes only once the page has hydrated.
      press: { button: 'Count is 0', shows: 'Count is 1' },
      follow: { link: 'About this site', shows: 'A second route' }
    },
    verify: report => {
      assert.deepEqual(report.versions.map(version => version.id), ['v2', 'v1']);
      assert.ok(report.pressed);
      // The router took the click too, so the document is still the entry page.
      assert.deepEqual([report.followed.path, report.followed.file], ['/about', '/afterimage/versions/v2/index.html']);
    }
  }
};

// The root is the app's own build, byte for byte: nothing Afterimage adds reaches it.
async function assertRootUntouched(dir, built) {
  const site = path.join(dir, '.afterimage/site');
  assert.deepEqual(await fs.readFile(path.join(site, 'index.html')), await fs.readFile(path.join(dir, built, 'index.html')));
}

test('northwind: every version renders and v3 shows its changes', async () => {
  checks.northwind.verify(await checkExample(example('northwind'), checks.northwind.options));
});

test('vite-react: home and /about render inside the viewer, the live app at / is untouched', async () => {
  const dir = example('vite-react');
  checks['vite-react'].verify(await checkExample(dir, checks['vite-react'].options));
  await assertRootUntouched(dir, 'dist');
});

test('next-static: home and /about render inside the viewer, the live app at / is untouched', async () => {
  const dir = example('next-static');
  checks['next-static'].verify(await checkExample(dir, checks['next-static'].options));
  await assertRootUntouched(dir, 'out');
});

test('astro: both pages render inside the viewer, and a hard link stays in the version', async () => {
  const dir = example('astro');
  checks.astro.verify(await checkExample(dir, checks.astro.options));
  await assertRootUntouched(dir, 'dist');
});

test('sveltekit-static: both prerendered routes render inside the viewer, and the page hydrates', async () => {
  const dir = example('sveltekit-static');
  checks['sveltekit-static'].verify(await checkExample(dir, checks['sveltekit-static'].options));
  await assertRootUntouched(dir, 'build');
});

// Stands in for a Vercel or Netlify deployment until a real preview can be tried (spec criterion 3): a fresh copy of the
// built site, in a folder with a space in its name, on an unexpected port, served by a host that maps paths straight to
// files. The first test is the main one. The rest show the worker's clean-URL fallback doing its job on a host that has
// no clean URLs of its own: Next's about.html, SvelteKit's about.html and Astro's about/index.html all have to be found.
function assertPlainHost(report, cleanUrls = 'none') {
  assert.equal(report.host.cleanUrls, cleanUrls);
  assert.match(report.host.root, / /, 'The host folder has no space in its path');
  assert.ok(!path.resolve(report.host.root).startsWith(path.resolve(example('vite-react'), '..')), 'The host folder is inside the examples');
}

test('the site works from a fresh copy of out/ served by a plain static server', async () => {
  const dir = example('vite-react');
  const report = await checkExample(dir, { ...checks['vite-react'].options, plain: true });
  assertPlainHost(report);
  checks['vite-react'].verify(report);
});

for (const name of ['northwind', 'astro', 'sveltekit-static']) {
  test(`${name}: the same checks pass from a plain static server`, async () => {
    const report = await checkExample(example(name), { ...checks[name].options, plain: true });
    assertPlainHost(report);
    checks[name].verify(report);
  });
}

// Next links to /about and writes about.html. The versions get there through the worker's fallback on any host. The live
// app at / needs the host to answer /about itself (Next sends HEAD /about before it prefetches the page), which a
// plain host does not, and which init's vercel.json rewrite supplies (a static host given no framework of its own).
test('next-static: the live app at / needs clean URLs from its host, and the rewrite init writes gives them', async () => {
  const dir = example('next-static');
  await assert.rejects(checkExample(dir, { ...checks['next-static'].options, plain: true }), /App at \/: these requests failed[\s\S]*404 \S+\/about\b/);
  const report = await checkExample(dir, { ...checks['next-static'].options, plain: { cleanUrls: 'rewrite' } });
  assertPlainHost(report, 'rewrite');
  checks['next-static'].verify(report);
});

// Why init does not write cleanUrls: true. It is site-wide, so /afterimage/versions/vN/index.html is redirected out of the
// version folder (and about.html to about), and the frame runtime and the viewer, which match on those exact paths, never
// settle on the version. The host's redirects are Vercel's own (convertCleanUrls in @vercel/routing-utils: the .html and
// index.html patterns, 308). The test fails only on that: the error must list the host's 308 of a version's index.html, so
// an unrelated timeout does not pass it. If the runtime ever learns to follow such a redirect, this is the test to turn around.
test('a host with cleanUrls: true redirects a version out of its folder, and the viewer cannot show it', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture('multipage'), dir, { recursive: true });
  afterimage(dir, 'init');
  afterimage(dir, 'save', 'One');
  const page = path.join(dir, 'index.html');
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace('<h1>Page one</h1>', '<h1>Page one, revised</h1>'));
  afterimage(dir, 'save', 'Two');
  const build = () => afterimage(dir, 'build');
  await checkExample(dir, { expectChange: 'Page one, revised', build, plain: { cleanUrls: 'rewrite' } });
  await assert.rejects(checkExample(dir, { expectChange: 'Page one, revised', build, plain: { cleanUrls: 'redirect' } }), /Timeout 15000ms[\s\S]*The host redirected:[\s\S]*308 \/afterimage\/versions\/v\d+\/index\.html -> \/afterimage\/versions\/v\d+(\n|$)/);
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

// A temporary copy of an example that has its own history and can be saved to, so the original's history is never
// touched. Its node_modules is a junction to the original's (it works on Windows without administrator rights), so the
// copy builds with the same install. Build output and the viewer's site are left behind; the copy makes its own.
async function copyExample(t, name) {
  const source = example(name);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `afterimage-e2e-${name}-`));
  t.after(async () => {
    // The link first, so removing the copy cannot reach into the original install.
    await fs.rm(path.join(dir, 'node_modules'), { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });
  const skipped = new Set(['node_modules', '.afterimage', 'dist', 'build']);
  await fs.cp(source, dir, { recursive: true, filter: file => !skipped.has(path.relative(source, file).split(path.sep)[0]) });
  await fs.symlink(path.join(source, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}

// Edits a file of the copy. The edit must change it, so a typo in the search text fails here and not as a false pass.
async function editFile(file, change) {
  const before = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const after = change(before);
  assert.notEqual(after, before, `The edit changed nothing in ${file}`);
  await fs.writeFile(file, after);
}

// Moving a component changes no style and nothing on the page, and still renames what the build generates. Astro and
// Svelte 5 scope a component's styles with a hash of its file path, not of its CSS (checked: editing the style block
// leaves data-astro-cid-yk4hkwyg and svelte-dfcawr as they were), so a rename is how their hashes move.
// Astro's default puts its hash in an attribute, which no match key or comparison reads. Its `class` strategy puts it in
// a class (astro-yk4hkwyg) on every element that has none of its own, so the Astro copy first saves a version built that
// way, and the move is compared with that one.
const scoped = [
  {
    name: 'astro',
    prepare: async dir => {
      await editFile(path.join(dir, 'astro.config.mjs'), () => "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({ scopedStyleStrategy: 'class' });\n");
      afterimage(dir, 'save', 'Scoped by class');
      return 4;
    },
    move: { from: 'src/components/Card.astro', to: 'src/components/Box.astro', users: ['src/pages/index.astro', 'src/pages/about.astro'], rename: ['Card', 'Box'] },
    retext: ['src/pages/index.astro', source => source.replace('Field notes from the coast', 'Field notes from the harbour')],
    newText: 'Field notes from the harbour',
  },
  {
    name: 'sveltekit-static',
    prepare: async () => 3,
    move: { from: 'src/lib/Counter.svelte', to: 'src/lib/Tally.svelte', users: ['src/routes/+page.svelte'], rename: ['Counter', 'Tally'] },
    retext: ['src/routes/+page.svelte', source => source.replace('Welcome back to the studio', 'Welcome back to the harbour')],
    newText: 'Welcome back to the harbour',
  },
];

async function moveComponent(dir, { from, to, users, rename: [oldName, newName] }) {
  await fs.rename(path.join(dir, from), path.join(dir, to));
  for (const user of users) await editFile(path.join(dir, user), source => source.replaceAll(oldName, newName));
}

for (const { name, prepare, move, retext, newText } of scoped) {
  test(`${name}: an edit that only reshuffles generated names shows zero changes`, async t => {
    const dir = await copyExample(t, name);
    const next = await prepare(dir);
    await moveComponent(dir, move);
    // The new hash is in the built page, so a version is saved even though the page renders as before.
    assert.match(afterimage(dir, 'save', 'Moved'), new RegExp(`^Saved v${next} `, 'm'));
    const report = await checkExample(dir, { expectCount: 0, build: () => afterimage(dir, 'build') });
    assert.equal(report.versions[0].id, `v${next}`);
  });

  test(`${name}: a real text edit shows only that edit`, async t => {
    const dir = await copyExample(t, name);
    const next = await prepare(dir);
    // The same move, so the new names are there to be mistaken for changes next to the real one.
    await moveComponent(dir, move);
    await editFile(path.join(dir, retext[0]), retext[1]);
    assert.match(afterimage(dir, 'save', 'Retexted'), new RegExp(`^Saved v${next} `, 'm'));
    await checkExample(dir, { expectCount: 1, expectChange: newText, build: () => afterimage(dir, 'build') });
  });
}

// Generated names in a plain page, where no framework is needed to produce them: the ids, classes and attributes two
// builds of the same page would differ in. The viewer must find nothing changed, and still find a real edit.
const generatedPage = ({ id, scope, cid, gradient, stop }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Generated names</title>
    <style>svg { width: 48px; height: 48px; }</style>
  </head>
  <body>
    <h1>Generated names</h1>
    <p id="${id}">A paragraph with a generated id.</p>
    <p><a href="#${id}">Jump to the paragraph</a></p>
    <div class="${scope}"><button class="${scope}">Save</button></div>
    <svg viewBox="0 0 24 24" data-astro-cid-${cid}>
      <defs><linearGradient id="${gradient}"><stop offset="0" stop-color="${stop}"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
      <rect class="${scope}" width="24" height="24" fill="url(#${gradient})" data-astro-cid-${cid}/>
    </svg>
  </body>
</html>
`;

async function generatedPageSite(t, versions) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(fixture('multipage'), dir, { recursive: true });
  afterimage(dir, 'init');
  for (const [index, version] of versions.entries()) {
    await fs.writeFile(path.join(dir, 'index.html'), generatedPage(version));
    afterimage(dir, 'save', `Version ${index + 1}`);
  }
  return dir;
}

const first = { id: '_r_1_', scope: 'svelte-abc123', cid: 'aaaaaaaa', gradient: '_r_2_', stop: '#ff0000' };
const rebuilt = { id: ':r7:', scope: 'svelte-zzz999', cid: 'bbbbbbbb', gradient: ':r8:', stop: '#ff0000' };

test('generated ids, classes and attributes that differ between builds are not changes', async t => {
  const dir = await generatedPageSite(t, [first, rebuilt]);
  await checkExample(dir, { expectCount: 0, build: () => afterimage(dir, 'build') });
});

test('an icon edited among generated names still shows as one change', async t => {
  const dir = await generatedPageSite(t, [first, { ...rebuilt, stop: '#00ff00' }]);
  await checkExample(dir, { expectCount: 1, build: () => afterimage(dir, 'build') });
});
