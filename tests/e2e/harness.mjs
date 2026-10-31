// The end-to-end check every example is held to: build it with its own scripts, serve the output, and drive the
// real viewer in Chrome. Task by task, new framework examples reuse checkExample unchanged.
//
// It waits on signals the page gives (a frame's load, the change list rendering), never on fixed sleeps.
// The viewer has no test hooks, so it reads the viewer through what a visitor or a screen reader sees:
//   - the pill button named "Highlight changes, N changes", which appears once the live review is ready
//   - the "Show versions" button, which opens the panel (role dialog)
//   - in the panel, the button "N changes from vA to vB" (aria-expanded), which opens the list named "Changes"
//   - the list's role=listitem rows, each holding one change, and the data-kind on its button (added, changed, removed)
//   - the iframe[data-role="target"] that holds the shown version
//
// expectChange is text the newest version adds or changes; it must appear in an Added or Changed row of the list.
// A Removed row does not count: text that left the page is not what the newest version shows.
// A version's frame passes when its body has visible text (trimmed innerText) and at least one element.
// If the viewer renames those labels, this is the one file to update.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readConfig } from '../../src/cli/config.js';
import { fileFor, requestPath, sendFile } from '../../src/cli/static-files.js';

const loadTimeout = 15_000;
const text = value => String(value).replace(/\s+/g, ' ').trim();

// Serves a built site on a free port of its own. Returns { origin, close }.
async function serve(root) {
  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (pathname === null) { res.writeHead(400).end(); return; }
    const file = fileFor(root, pathname);
    if (!file) { res.writeHead(403).end(); return; }
    await sendFile(res, file);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })
  };
}

// Runs the example's own afterimage:build script, so the check covers what a user would run.
function build(exampleDir) {
  // shell: true so that npm (npm.cmd on Windows) resolves.
  const result = spawnSync('npm run afterimage:build', { cwd: exampleDir, shell: true, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`"npm run afterimage:build" failed in ${exampleDir} (exit ${result.status}). Did you run "npm run install:examples"?\n${result.stdout}${result.stderr}`);
  }
}

// Collects every same-origin request that failed, per step. The favicon is not part of the example.
function watchRequests(page, origin) {
  let failures = [];
  const ours = url => url.startsWith(`${origin}/`) && new URL(url).pathname !== '/favicon.ico';
  page.on('response', response => {
    if (ours(response.url()) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    if (ours(request.url())) failures.push(`${request.failure()?.errorText ?? 'failed'} ${request.url()}`);
  });
  return {
    // Returns what failed since the last call and starts over.
    take() {
      const taken = failures;
      failures = [];
      return taken;
    }
  };
}

// Waits until the target frame shows `version`'s page, then reads its document. Reading it at all proves the frame
// is same-origin with the viewer, which the review and the highlights depend on.
async function readFrame(page, version) {
  const frame = page.locator('iframe[data-role="target"]');
  await frame.waitFor({ state: 'attached', timeout: loadTimeout });
  await page.waitForFunction(({ file }) => {
    const element = document.querySelector('iframe[data-role="target"]');
    try {
      const doc = element?.contentDocument;
      return Boolean(doc && doc.readyState === 'complete' && doc.body && new URL(element.contentWindow.location.href).pathname.endsWith(`/${file}`));
    } catch {
      return false;
    }
  }, { file: version.file }, { timeout: loadTimeout });
  return page.evaluate(() => {
    const doc = document.querySelector('iframe[data-role="target"]').contentDocument;
    const visibleText = doc.body.innerText.trim();
    return { text: visibleText, hasContent: visibleText.length > 0 && doc.body.children.length > 0, href: doc.location.href };
  });
}

// checkExample(exampleDir, { expectChange }) → Report. Throws (with the failing URL or step) when anything is off.
// expectChange is text the newest version shows and the one before it does not, and it must appear in the change list.
export async function checkExample(exampleDir, { expectChange }) {
  assert.ok(expectChange, 'checkExample needs expectChange: text the newest version adds.');
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
    const requests = watchRequests(page, server.origin);
    const noFailures = step => assert.deepEqual(requests.take(), [], `${step}: these requests failed`);
    const report = { example: path.basename(path.resolve(exampleDir)), app: null, versions: [], changes: null };

    // The app at the root loads as its own build does.
    const response = await page.goto(`${server.origin}/`, { waitUntil: 'load', timeout: loadTimeout });
    assert.equal(response.status(), 200, `The app at / answered ${response.status()}`);
    const appBody = await page.evaluate(() => document.body.innerText.trim().length);
    assert.ok(appBody > 0 || await page.locator('body *').count() > 0, 'The app at / rendered an empty page');
    assert.equal(new URL(page.url()).pathname, '/', 'The app at / redirected away from the root');
    noFailures('App at /');
    report.app = { title: await page.title(), textLength: appBody };

    // Every saved version renders on its own in the viewer's frame.
    for (const version of versions) {
      await page.goto(`${server.origin}/afterimage/?version=${version.id}`, { waitUntil: 'load', timeout: loadTimeout });
      const frame = await readFrame(page, version);
      assert.ok(frame.hasContent, `${version.id} (${frame.href}) has an empty body`);
      noFailures(`Version ${version.id}`);
      report.versions.push({ id: version.id, name: version.name, textLength: frame.text.length });
    }

    // The two newest versions compared: highlights on, the change list names the change.
    const [newest, previous] = versions;
    await page.goto(`${server.origin}/afterimage/?version=${newest.id}&mode=compare&base=${previous.id}`, { waitUntil: 'load', timeout: loadTimeout });
    await readFrame(page, newest);
    // The pill shows this button, with the count, once the live review has finished.
    const highlight = page.getByRole('button', { name: /^Highlight changes, \d+ changes?$/ });
    await highlight.waitFor({ timeout: loadTimeout });
    await highlight.click();
    await page.getByRole('button', { name: /^Show versions$|\. Show versions$/ }).first().click();
    const dialog = page.getByRole('dialog');
    const summary = dialog.getByRole('button', { name: new RegExp(`^\\d+ changes? from ${previous.id} to ${newest.id}$`) });
    await summary.waitFor({ timeout: loadTimeout });
    const count = Number(/^(\d+)/.exec(text(await summary.innerText()))[1]);
    assert.ok(count > 0, `Expected changes between ${previous.id} and ${newest.id}, the viewer found ${count}`);
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    const list = dialog.getByRole('list', { name: 'Changes' });
    await list.waitFor({ timeout: loadTimeout });
    const rows = (await list.getByRole('listitem').locator('button[data-kind]').evaluateAll(buttons => buttons.map(button => ({ kind: button.dataset.kind, text: button.innerText })))).map(row => ({ kind: row.kind, text: text(row.text) }));
    assert.ok(rows.length > 0, 'The change list has no rows');
    const listing = rows.map(row => `[${row.kind}] ${row.text}`).join('\n');
    assert.ok(rows.some(row => row.kind !== 'removed' && row.text.includes(expectChange)), `Expected an added or changed row to mention "${expectChange}". The list has:\n${listing}`);
    noFailures(`Changes ${previous.id} to ${newest.id}`);
    report.changes = { from: previous.id, to: newest.id, count, rows: rows.map(row => row.text) };

    return report;
  } finally {
    await browser?.close();
    await server.close();
  }
}
