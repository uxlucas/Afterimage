// Records the launch video: drives the real viewer in headless Chrome and encodes Chrome's screencast to H.264.
//   node record.mjs            → out/afterimage.mp4
//   node record.mjs --stills   → out/stills/*.png, one per shot, for checking layout without encoding
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFor, requestPath, sendFile } from '../../src/cli/static-files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The Northwind example's assembled site: the prototype at the root, the viewer and its history at /afterimage/.
const site = path.resolve(here, '../../examples/northwind/.afterimage/site');
const stills = process.argv.includes('--stills');
const outDir = path.join(here, 'out');
const PORT = 4191;
const FPS = 60;
const VIEW = 960; // CSS px, square
const SCALE = 1.125; // 960 × 1.125 = 1080 px frames

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// One origin for the stage and the built site, so the stage can reach into the viewer's frames.
function startServer() {
  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (pathname === null) { res.writeHead(400).end(); return; }
    const film = pathname.startsWith('/film/');
    const file = fileFor(film ? here : site, film ? pathname.slice('/film'.length) : pathname);
    if (!file) { res.writeHead(403).end(); return; }
    await sendFile(res, file);
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// Chrome only sends a frame when the page changes, so each frame is repeated until the next one arrives,
// which gives ffmpeg a constant frame rate.
async function startRecording(page, file) {
  const cdp = await page.context().newCDPSession(page);
  const ffmpeg = spawn(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  // A pipe that closes under us is reported through `exited`, not as an unhandled stream error.
  ffmpeg.stdin.on('error', () => {});
  const exited = new Promise(resolve => ffmpeg.on('exit', code => resolve(code)));
  // Writes give up as soon as ffmpeg is gone, instead of waiting for a 'drain' that will never come.
  const gone = exited.then(code => { throw new Error(`ffmpeg stopped while recording (exit code ${code}).`); });
  gone.catch(() => {});
  const write = buffer => Promise.race([new Promise(resolve => (ffmpeg.stdin.write(buffer) ? resolve() : ffmpeg.stdin.once('drain', resolve))), gone]);

  let start = null;
  let last = null;
  let written = 0;
  let failure = null;
  let queue = Promise.resolve();
  const fillTo = async seconds => {
    const slot = Math.round((seconds - start) * FPS);
    while (last && written < slot) { await write(last); written++; }
  };
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const frame = Buffer.from(data, 'base64');
    queue = queue.then(async () => {
      if (failure) return;
      start ??= metadata.timestamp;
      await fillTo(metadata.timestamp);
      last = frame;
    }).catch(error => { failure ??= error; });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEW * SCALE, maxHeight: VIEW * SCALE, everyNthFrame: 1 });

  return {
    async stop() {
      const now = Date.now() / 1000;
      await cdp.send('Page.stopScreencast');
      await queue;
      if (!failure && !last) failure = new Error('Chrome sent no frames to record.');
      if (!failure) {
        try {
          await fillTo(now);
          await write(last);
        } catch (error) {
          failure = error;
        }
      }
      ffmpeg.stdin.end();
      const code = await exited;
      if (failure) throw failure;
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}.`);
      return written / FPS;
    },
    // For a run that fails before stop(): without its input closed, ffmpeg would keep this process alive.
    abort() { ffmpeg.kill(); },
  };
}

function director(page, stage) {
  let shotNumber = 0;
  const film = (method, ...args) => page.evaluate(([name, values]) => window.film[name](...values), [method, args]);
  const center = async locator => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Not on screen: ${locator}`);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), box };
  };
  const at = { x: VIEW / 2, y: VIEW * 0.72 };
  // A point inside the viewer window, as fractions of its width and height.
  const inStage = (fx, fy) => ({ x: Math.round(stage.x + stage.width * fx), y: Math.round(stage.y + stage.height * fy) });

  const api = {
    film,
    center,
    inStage,
    keyboard: page.keyboard,
    async shot(name) {
      if (!stills) return;
      shotNumber++;
      await page.screenshot({ path: path.join(outDir, 'stills', `${String(shotNumber).padStart(2, '0')}-${name}.png`) });
    },
    async caption(title, sub) { await film('caption', title, sub ?? null); },
    async showCursor(x = at.x, y = at.y) { Object.assign(at, { x, y }); await film('showCursor', x, y); await page.mouse.move(x, y); },
    async moveTo(target, ms = 650) {
      const { x, y } = target.x === undefined ? await center(target) : target;
      await film('glide', x, y, ms);
      await wait(ms);
      await page.mouse.move(x, y);
      Object.assign(at, { x, y });
    },
    async click(target, { ms, hold = 90 } = {}) {
      await api.moveTo(target, ms);
      await wait(120);
      await film('press', true);
      await page.mouse.down();
      await wait(hold);
      await page.mouse.up();
      await film('press', false);
    },
    // Presses at the current spot and drags through the points, easing along each leg.
    async drag(points, legMs = 700) {
      await film('press', true);
      await page.mouse.down();
      for (const point of points) {
        const from = { ...at };
        const steps = Math.max(2, Math.round(legMs / 16));
        for (let i = 1; i <= steps; i++) {
          const k = easeInOut(i / steps);
          const x = from.x + (point.x - from.x) * k;
          const y = from.y + (point.y - from.y) * k;
          await Promise.all([film('jump', x, y), page.mouse.move(x, y)]);
          await wait(16);
        }
        Object.assign(at, point);
      }
      await page.mouse.up();
      await film('press', false);
    },
  };
  return api;
}

// The film itself. Timings are what the viewer needs to settle plus enough time to read each line.
async function run(app, d) {
  const button = name => app.getByRole('button', { name, exact: true });

  // 1. What it is.
  await d.caption('Every version of your prototype.', 'One link to all of them.');
  await wait(600);
  const rest = d.inStage(0.62, 0.7);
  await d.showCursor(rest.x, rest.y);
  await wait(1800);
  await d.shot('intro');

  // 2. What changed.
  await d.caption('See exactly what changed.');
  await d.click(app.getByRole('button', { name: /^Highlight changes/ }));
  await wait(1300);
  await d.shot('highlights');
  await d.click(button('Next change'), { ms: 450 });
  await wait(1100);
  await d.click(button('Next change'), { ms: 250 });
  await wait(1100);
  await d.click(button('Next change'), { ms: 250 });
  await wait(1400);
  await d.shot('change-detail');

  // 3. Going back.
  await d.caption('Go back to any version.');
  const ticks = app.locator('.tick-slot');
  await d.moveTo(ticks.nth(1), 700);
  await wait(700);
  await d.shot('timeline-tip');
  await d.click(ticks.nth(1), { ms: 120 });
  await wait(1900);
  await d.shot('v2');
  await d.click(ticks.nth(0), { ms: 300 });
  await wait(1700);
  await d.shot('v1');

  // 4. Compare with a wipe.
  await d.caption('Compare any two.');
  await d.click(button('Go to latest'), { ms: 600 });
  await wait(900);
  await d.click(button('Compare'), { ms: 350 });
  await wait(900);
  const before = app.getByRole('textbox', { name: 'Before, version number' }).or(app.getByLabel('Before, version number'));
  await d.click(before.first(), { ms: 500 });
  await d.keyboard.press('Control+A');
  await d.keyboard.type('1', { delay: 60 });
  await d.keyboard.press('Enter');
  await wait(1000);
  const divider = await d.center(app.locator('.wipe-divider'));
  await d.moveTo({ x: divider.x, y: d.inStage(0, 0.45).y }, 700);
  await wait(200);
  await d.drag([d.inStage(0.3, 0.47), d.inStage(0.7, 0.45), d.inStage(0.5, 0.46)], 900);
  await wait(500);
  await d.shot('wipe');

  // 5. Side by side.
  await d.caption('Side by side, in sync.');
  await d.click(app.getByRole('radio', { name: 'Side by side' }), { ms: 700 });
  await wait(1400);
  await d.shot('side');
  await d.click(app.getByRole('radio', { name: '100%' }), { ms: 700 });
  await wait(900);
  await d.click(button('Next change'), { ms: 700 });
  await wait(1600);
  await d.shot('side-100');

  // 6. Sharing.
  await d.caption('Share one link.', 'No walkthrough needed.');
  await d.click(app.getByRole('button', { name: /Show versions$/ }).first(), { ms: 700 });
  await wait(900);
  await d.click(app.getByRole('button', { name: 'Copy link to this view' }), { ms: 650 });
  await wait(1800);
  await d.shot('share');

  // 7. End card.
  await d.film('endCard');
  await wait(3000);
  await d.shot('end');
}

if (!fs.existsSync(path.join(site, 'afterimage', 'index.html'))) {
  console.error('Build the Northwind example first: npm run afterimage:build --prefix ../../examples/northwind');
  process.exit(1);
}
fs.mkdirSync(path.join(outDir, stills ? 'stills' : ''), { recursive: true });
const server = await startServer();
// The screencast only sends frames at device size when the scale is forced on the whole browser.
const browser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${SCALE}`] });
let recording = null;
try {
  const context = await browser.newContext({ viewport: { width: VIEW, height: VIEW }, deviceScaleFactor: SCALE });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/film/stage.html`);
  const app = page.frameLocator('#viewer');
  await app.getByRole('button', { name: /^Highlight changes, \d+ changes/ }).waitFor();
  const stage = await page.locator('#viewer').boundingBox();
  await wait(500);

  recording = stills ? null : await startRecording(page, path.join(outDir, 'afterimage.mp4'));
  await wait(400);
  await run(app, director(page, stage));
  if (recording) {
    const finished = recording;
    recording = null;
    const seconds = await finished.stop();
    console.log(`Wrote out/afterimage.mp4 (${seconds.toFixed(1)}s)`);
  } else {
    console.log('Wrote out/stills/');
  }
} finally {
  recording?.abort();
  await browser.close();
  server.close();
}
