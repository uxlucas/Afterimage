// The end-to-end check every example is held to: build it with its own scripts, serve the output, and drive the
// real viewer in Chrome. Task by task, new framework examples reuse checkExample, with an option only where an app
// needs one.
//
// It waits on signals the page gives (a frame's load, the change list rendering), never on fixed sleeps, with one
// exception: showing that the live review did not store a count needs a wait past its longest delay.
// The viewer has no test hooks, so it reads the viewer through what a visitor or a screen reader sees:
//   - the pill button named "Highlight changes, N changes", which appears once the live review is ready
//   - the "Show versions" button, which opens the panel (role dialog)
//   - in the panel, the button "N changes from vA to vB" (aria-expanded), which opens the list named "Changes"
//   - the list's role=listitem rows, each holding one change, and the data-kind on its button (added, changed, removed)
//   - the iframe[data-role="target"] that holds the shown version
//   - window.__afterimageVersion in that frame, which the frame runtime sets for versions saved with it (their URL
//     is rewritten to the app's own paths, so the URL alone no longer says which version a frame holds), with
//     __afterimagePath (where the app settled before anyone touched the frame) and __afterimageFile (the file loaded)
//
// expectChange is text the newest version adds or changes; it must appear in an Added or Changed row of the list.
// A Removed row does not count: text that left the page is not what the newest version shows.
// expectCount is the exact number of changes between the two newest versions, on the pill and in the panel. With 0 the
// panel must say "No visible changes" and list nothing; above 0 the list has exactly that many rows. expectChange may
// be left out when expectCount is given.
// A version's frame passes when its body has visible text (trimmed innerText) and at least one element, and the
// static server saw no request outside /afterimage/ while the viewer was open. A version's requests reach the server
// under /afterimage/versions/ once the worker maps them; anything else reached the live app at the root, which can
// look right while showing the wrong version. Only the steps that open the app at / itself may ask for root paths.
// follow ({ link, shows }) clicks the link named `link` inside the newest version's frame and waits for `shows`:
// the frame must still hold the same version afterwards, and the stored change count must not change. The report's
// followed.file is the file the frame's document came from: the entry page's still when the app's router took the
// click, another page's after a hard link.
// Switching versions and pressing Back must never leave the frame on the live app.
// If the viewer renames those labels, this is the one file to update.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readConfig } from '../../src/cli/config.js';
import { fileFor, requestPath, sendFile } from '../../src/cli/static-files.js';
import { entryPath } from '../../src/viewer/frames.js';
import { isServedPath } from '../../src/runtime/map.js';

const loadTimeout = 15_000;
const text = value => String(value).replace(/\s+/g, ' ').trim();

const isFile = file => fs.stat(file).then(stat => stat.isFile(), () => false);

// Serves a built site on a free port of its own. Returns { origin, take, close }: take() returns the paths requested
// since the last call. The favicon is the browser's own request, not the example's.
// The live app at the root is served the way Netlify, and Vercel with cleanUrls, serve static output, since apps rely
// on it (Next links to /about and writes about.html): /about from about.html, and /about redirected to /about/ when
// there is an about/index.html. Under /afterimage/ only exact files are, as afterimage dev and plain file servers do,
// so a version that renders proves the worker finds clean URLs on its own.
async function serve(root) {
  let seen = [];
  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (pathname !== null && pathname !== '/favicon.ico') seen.push(pathname);
    if (pathname === null) { res.writeHead(400).end(); return; }
    const file = fileFor(root, pathname);
    if (!file) { res.writeHead(403).end(); return; }
    if (!isServedPath(pathname) && !pathname.endsWith('/') && !await isFile(file)) {
      const page = fileFor(root, `${pathname}.html`);
      if (page && await isFile(page)) { await sendFile(res, page); return; }
      const index = fileFor(root, `${pathname}/index.html`);
      const asked = new URL(req.url, 'http://localhost');
      if (index && await isFile(index)) { res.writeHead(301, { Location: `${asked.pathname}/${asked.search}` }).end(); return; }
    }
    await sendFile(res, file);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    take() {
      const taken = seen;
      seen = [];
      return taken;
    },
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })
  };
}

// Runs the example's own afterimage:build script, so the check covers what a user would run.
// Next's and Astro's telemetry are turned off through the environment, which works in every shell (VAR=1 cmd does not
// on Windows).
const buildEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ASTRO_TELEMETRY_DISABLED: '1' };
function npmBuild(exampleDir) {
  // shell: true so that npm (npm.cmd on Windows) resolves.
  const result = spawnSync('npm run afterimage:build', { cwd: exampleDir, shell: true, encoding: 'utf8', env: buildEnv });
  if (result.status !== 0) {
    throw new Error(`"npm run afterimage:build" failed in ${exampleDir} (exit ${result.status}). Did you run "npm run install:examples"?\n${result.stdout}${result.stderr}`);
  }
}

// Collects every same-origin request that failed, per step. The favicon is not part of the example, and neither are
// the appMisses: paths the app's own build asks for and does not have, which the live app misses too. They are
// matched on the app's own path, so /afterimage/versions/vN/x counts as /x.
// A request fails with a status of 400 or more, or with a network error. net::ERR_ABORTED (the request was called off)
// counts too, except in the three cases where calling it off is not a failure:
//   - it had already been answered: Chrome reports every answered HEAD that way, and Next stops reading bodies it is
//     done with (on the live app at / as much as in a version). Its status was checked when the answer came.
//   - it is a prefetch (a next-router-prefetch header, or prefetch in Sec-Purpose or Purpose), which a router drops
//     once it no longer needs it.
//   - its frame went away or navigated after it started: a frame the viewer moves on cancels what it had in flight.
//     That is checked in take(), not when the request fails, because the viewer's location.replace aborts the old
//     page's requests before the frame's navigation commits.
function watchRequests(page, origin, appMisses) {
  let failures = [];
  let aborted = [];
  const answered = new WeakSet();
  // How many times each frame has navigated, and that count for each request when it started.
  const moves = new WeakMap();
  const startedAt = new WeakMap();
  // A request a service worker made has no frame, and Playwright throws when asked for one.
  const frameOf = request => {
    try {
      return request.frame();
    } catch {
      return null;
    }
  };
  const isPrefetch = request => {
    const headers = request.headers();
    return 'next-router-prefetch' in headers || /prefetch/i.test(`${headers['sec-purpose'] ?? ''} ${headers.purpose ?? ''}`);
  };
  const ours = url => {
    if (!url.startsWith(`${origin}/`)) return false;
    const { pathname } = new URL(url);
    const own = pathname.replace(/^\/afterimage\/versions\/v[1-9]\d*(?=\/)/, '');
    return pathname !== '/favicon.ico' && !appMisses.some(pattern => pattern.test(own));
  };
  page.on('framenavigated', frame => moves.set(frame, (moves.get(frame) ?? 0) + 1));
  page.on('request', request => {
    const frame = frameOf(request);
    if (frame) startedAt.set(request, moves.get(frame) ?? 0);
  });
  page.on('response', response => {
    answered.add(response.request());
    if (ours(response.url()) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    if (!ours(request.url())) return;
    const error = request.failure()?.errorText ?? 'failed';
    if (error !== 'net::ERR_ABORTED') failures.push(`${error} ${request.url()}`);
    else if (!answered.has(request) && !isPrefetch(request)) aborted.push(request);
  });
  const stayed = request => {
    const frame = frameOf(request);
    return Boolean(frame) && !frame.isDetached() && (moves.get(frame) ?? 0) === startedAt.get(request);
  };
  return {
    // Returns what failed since the last call and starts over.
    take() {
      const taken = [...failures, ...aborted.filter(stayed).map(request => `net::ERR_ABORTED ${request.url()}`)];
      failures = [];
      aborted = [];
      return taken;
    }
  };
}

// Waits until the target frame shows `version`'s page, then reads its document. Reading it at all proves the frame
// is same-origin with the viewer, which the review and the highlights depend on.
// With shows (after a click inside the frame) it waits for that text instead, whatever the frame holds, so the caller
// can say which version it found.
async function readFrame(page, version, shows = '') {
  const frame = page.locator('iframe[data-role="target"]');
  await frame.waitFor({ state: 'attached', timeout: loadTimeout });
  await page.waitForFunction(({ id, file, entry, shows }) => {
    const element = document.querySelector('iframe[data-role="target"]');
    try {
      const doc = element?.contentDocument;
      const win = element.contentWindow;
      if (!doc || doc.readyState !== 'complete' || !doc.body) return false;
      if (shows) return doc.body.innerText.includes(shows);
      // Same rule as the viewer's showsVersion: with the runtime's mark, the path the app settled on (or the entry
      // page's path, from a frame.js that does not record it) in the version's own file; the URL otherwise.
      if (win.__afterimageVersion !== undefined) {
        if (win.__afterimageVersion !== id) return false;
        const here = win.location.pathname + win.location.search;
        if (win.__afterimagePath === undefined) return here === entry;
        return here === win.__afterimagePath && win.__afterimageFile === new URL(file, location.href).pathname;
      }
      return new URL(win.location.href).pathname.endsWith(`/${file}`);
    } catch {
      return false;
    }
  }, { id: version.id, file: version.file, entry: entryPath(version.file), shows }, { timeout: loadTimeout });
  return page.evaluate(() => {
    const element = document.querySelector('iframe[data-role="target"]');
    const doc = element.contentDocument;
    const visibleText = doc.body.innerText.trim();
    return { text: visibleText, hasContent: visibleText.length > 0 && doc.body.children.length > 0, href: doc.location.href, path: doc.location.pathname, version: element.contentWindow.__afterimageVersion ?? null, file: element.contentWindow.__afterimageFile ?? null };
  });
}

// checkExample(exampleDir, { expectChange, expectCount, press, follow, build, appPath, appMisses }) → Report. Throws (with the failing URL or step) when anything is off.
// expectChange is text the newest version shows and the one before it does not, and it must appear in the change list.
// expectCount is the exact change count between the two newest versions (see the header).
// build replaces the npm script, for a folder that has no node_modules of its own (a temporary copy of a fixture).
// appPath is where the app at / ends up once loaded, for an app that moves itself (a locale or sign-in redirect).
// appMisses (RegExps on the app's own path) are files the app asks for and its own build lacks; see watchRequests.
// press ({ button, shows }) clicks the button named `button` inside the newest version's frame and waits for its name
// to become `shows`: only a page whose scripts ran (one that hydrated) can change it.
export async function checkExample(exampleDir, { expectChange, expectCount, press, follow, build = npmBuild, appPath = '/', appMisses = [] }) {
  assert.ok(expectChange || expectCount !== undefined, 'checkExample needs expectChange (text the newest version adds) or expectCount.');
  build(exampleDir);
  const config = await readConfig(exampleDir);
  const site = path.resolve(exampleDir, config.out);
  const { versions } = JSON.parse(await fs.readFile(path.join(site, 'afterimage/versions.json'), 'utf8'));
  assert.ok(versions.length >= 2, `${exampleDir} needs at least two saved versions to check changes.`);

  const server = await serve(site);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const requests = watchRequests(page, server.origin, appMisses);
    // atRoot: the step opened the app at / itself, so root paths are expected there.
    const noFailures = (step, { atRoot = false } = {}) => {
      const reached = server.take().filter(pathname => !atRoot && !pathname.startsWith('/afterimage/'));
      assert.deepEqual([...requests.take(), ...reached.map(pathname => `reached the live app at the root: ${pathname}`)], [], `${step}: these requests failed`);
    };
    // An app goes on asking for files after load (Next prefetches the pages it links to). Waiting for the network to go
    // quiet keeps those requests in the step that opened the app at /, where root paths are expected.
    const settle = () => page.waitForLoadState('networkidle', { timeout: loadTimeout });
    const viewer = query => page.goto(`${server.origin}/afterimage/?${query}`, { waitUntil: 'load', timeout: loadTimeout });
    const highlight = page.getByRole('button', { name: /^Highlight changes, \d+ changes?$/ });
    const storedCounts = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter(key => key.startsWith('afterimage-count:'))
      .map(key => [key, JSON.parse(localStorage.getItem(key)).summary])));
    const report = { example: path.basename(path.resolve(exampleDir)), app: null, versions: [], pressed: null, followed: null, changes: null };

    // The app at the root loads as its own build does.
    const response = await page.goto(`${server.origin}/`, { waitUntil: 'load', timeout: loadTimeout });
    assert.equal(response.status(), 200, `The app at / answered ${response.status()}`);
    const appBody = await page.evaluate(() => document.body.innerText.trim().length);
    assert.ok(appBody > 0 || await page.locator('body *').count() > 0, 'The app at / rendered an empty page');
    assert.equal(new URL(page.url()).pathname, appPath, `The app at / ended up at ${new URL(page.url()).pathname}, not ${appPath}`);
    await settle();
    noFailures('App at /', { atRoot: true });
    report.app = { title: await page.title(), textLength: appBody };

    // Every saved version renders on its own in the viewer's frame.
    for (const version of versions) {
      await viewer(`version=${version.id}`);
      const frame = await readFrame(page, version);
      assert.ok(frame.hasContent, `${version.id} (${frame.href}) has an empty body`);
      noFailures(`Version ${version.id}`);
      report.versions.push({ id: version.id, name: version.name, textLength: frame.text.length, path: frame.path });
    }

    const [newest, previous] = versions;

    if (press) {
      await viewer(`version=${newest.id}`);
      await readFrame(page, newest);
      const inFrame = page.frameLocator('iframe[data-role="target"]');
      await inFrame.getByRole('button', { name: press.button, exact: true }).click();
      await inFrame.getByRole('button', { name: press.shows, exact: true }).waitFor({ timeout: loadTimeout });
      noFailures(`Pressing "${press.button}" in ${newest.id}`);
      report.pressed = press;
    }

    // A link inside the frame keeps the frame in the version it started in. The page it leads to is not the one
    // being compared, so the live review must not store a count for it.
    if (follow) {
      await viewer(`version=${newest.id}`);
      await readFrame(page, newest);
      await highlight.waitFor({ timeout: loadTimeout });
      await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('afterimage-count:')), null, { timeout: loadTimeout });
      const counts = await storedCounts();
      await page.frameLocator('iframe[data-role="target"]').getByRole('link', { name: follow.link }).click();
      const frame = await readFrame(page, newest, follow.shows);
      assert.equal(frame.version, newest.id, `After clicking "${follow.link}" the frame holds ${frame.href}, not ${newest.id}`);
      // The review runs at most 500ms after the page last changed; twice that is past any run it would make.
      await page.waitForTimeout(1000);
      const after = await storedCounts();
      for (const [key, summary] of Object.entries(counts)) assert.deepEqual(after[key], summary, `Following "${follow.link}" changed the stored count ${key}`);
      noFailures(`Following "${follow.link}" in ${newest.id}`);
      report.followed = { link: follow.link, path: frame.path, file: frame.file };
    }

    // Switching versions moves the frame without a history entry of its own, so Back leaves the viewer page instead of
    // taking the frame to an earlier page, whose URL the runtime rewrote to the app's path (the live app).
    await viewer(`version=${previous.id}`);
    await readFrame(page, previous);
    await viewer(`version=${newest.id}`);
    await readFrame(page, newest);
    await page.keyboard.press('[');
    await readFrame(page, previous);
    await page.evaluate(() => { document.querySelector('iframe[data-role="target"]').contentWindow.__beforeBack = true; });
    // Only the frame navigating would leave the viewer page in place, and goBack waiting for it in vain.
    await page.goBack({ waitUntil: 'load', timeout: loadTimeout }).catch(() => {});
    await page.waitForFunction(() => {
      try {
        const win = document.querySelector('iframe[data-role="target"]')?.contentWindow;
        return Boolean(win && !win.__beforeBack && win.document.readyState === 'complete');
      } catch {
        return false;
      }
    }, null, { timeout: loadTimeout });
    const back = await page.evaluate(() => {
      const win = document.querySelector('iframe[data-role="target"]').contentWindow;
      return { mark: win.__afterimageVersion ?? null, path: win.location.pathname, href: win.location.href };
    });
    assert.ok(back.mark !== null || back.path.startsWith('/afterimage/'), `After switching versions and pressing Back the frame shows ${back.href}, the live app`);
    noFailures('Back after switching versions');

    // The worker the viewer registered never takes over the app at the root.
    await page.goto(`${server.origin}/`, { waitUntil: 'load', timeout: loadTimeout });
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), false, 'The app at / is controlled by a service worker after the viewer ran');
    await settle();
    noFailures('App at / after the viewer', { atRoot: true });

    // The two newest versions compared: highlights on, the change list names the change.
    await viewer(`version=${newest.id}&mode=compare&base=${previous.id}`);
    await readFrame(page, newest);
    // The pill shows this button, with the count, once the live review has finished.
    await highlight.waitFor({ timeout: loadTimeout });
    // The pill's own count, read first so that a wrong count fails with the number and not with a timeout further on.
    const pillCount = Number(/(\d+) changes?$/.exec(await highlight.getAttribute('aria-label'))[1]);
    if (expectCount !== undefined) assert.equal(pillCount, expectCount, `Expected ${expectCount} changes between ${previous.id} and ${newest.id}, the pill shows ${pillCount}`);
    await highlight.click();
    await page.getByRole('button', { name: /^Show versions$|\. Show versions$/ }).first().click();
    const dialog = page.getByRole('dialog');
    if (expectCount === 0) {
      // Nothing changed: the panel says so where the summary button would be, and has no list to open.
      await dialog.getByText(`No visible changes from ${previous.id} to ${newest.id}`).waitFor({ timeout: loadTimeout });
      assert.equal(await dialog.getByRole('list', { name: 'Changes' }).count(), 0, 'The panel lists changes where it should list none');
      noFailures(`Changes ${previous.id} to ${newest.id}`);
      report.changes = { from: previous.id, to: newest.id, count: 0, rows: [] };
      return report;
    }
    const summary = dialog.getByRole('button', { name: new RegExp(`^\\d+ changes? from ${previous.id} to ${newest.id}$`) });
    await summary.waitFor({ timeout: loadTimeout });
    const count = Number(/^(\d+)/.exec(text(await summary.innerText()))[1]);
    assert.ok(count > 0, `Expected changes between ${previous.id} and ${newest.id}, the viewer found ${count}`);
    if (expectCount !== undefined) assert.equal(count, expectCount, `Expected ${expectCount} changes between ${previous.id} and ${newest.id}, the viewer found ${count}`);
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    const list = dialog.getByRole('list', { name: 'Changes' });
    await list.waitFor({ timeout: loadTimeout });
    const rows = (await list.getByRole('listitem').locator('button[data-kind]').evaluateAll(buttons => buttons.map(button => ({ kind: button.dataset.kind, text: button.innerText })))).map(row => ({ kind: row.kind, text: text(row.text) }));
    assert.ok(rows.length > 0, 'The change list has no rows');
    const listing = rows.map(row => `[${row.kind}] ${row.text}`).join('\n');
    if (expectCount !== undefined) assert.equal(rows.length, expectCount, `Expected ${expectCount} rows. The list has:\n${listing}`);
    if (expectChange) assert.ok(rows.some(row => row.kind !== 'removed' && row.text.includes(expectChange)), `Expected an added or changed row to mention "${expectChange}". The list has:\n${listing}`);
    noFailures(`Changes ${previous.id} to ${newest.id}`);
    report.changes = { from: previous.id, to: newest.id, count, rows: rows.map(row => row.text) };

    return report;
  } finally {
    await browser?.close();
    await server.close();
  }
}
