import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig } from '../config.js';
import { readHistory } from '../history.js';
import { assembleSite } from '../site.js';
import { fileFor, requestPath, sendFile } from '../static-files.js';
import { saveProject } from './save.js';

export const usage = 'afterimage dev [--port N] [-- <your dev command>]';
export const summary = 'Run your app\'s dev server with Afterimage beside it, so the pill on the prototype can save and show versions.';
// What both "afterimage dev --help" and "afterimage help dev" print.
export const help = `Usage: ${usage}\n\n${summary}\n\n  --port N               the port Afterimage starts from, 4321 by default; a busy one moves to the next free port\n  -- <your dev command>  the command that runs your app's own dev server, such as "vite" or "next dev"\n\nWith no dev command, a plain HTML prototype is served at / beside the history.\n`;
// Read by the docs tests, which check every flag the agent files name.
export const options = { port: { type: 'string' }, help: { type: 'boolean', short: 'h' } };

const defaultPort = 4321;
const portAttempts = 20;
const servedPath = '/afterimage/';
const apiPath = '/afterimage/api/';
const overlayPath = '/afterimage/overlay.js';
// A save's request is a name and a note. Anything much bigger is not one.
const maxBody = 16_000;

const count = versions => `${versions} ${versions === 1 ? 'version' : 'versions'}`;

// The overlay calls the api from the app's own dev server, which is another port on this machine. Only pages served
// from this machine may, so a website open in the same browser can't start a build.
export function isLocalOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
}

// Windows lets a bind on 127.0.0.1 succeed even while another server holds 0.0.0.0, :: or ::1 on the same port (Astro's
// default is 4321 too), so ask whether anything answers on either loopback address before binding. A refused connect or
// a missing address (no IPv6) means nothing is there; a connect that hangs is treated as taken.
const answers = (port, host) => new Promise(resolve => {
  const socket = net.connect({ port, host });
  const done = taken => { socket.destroy(); resolve(taken); };
  socket.setTimeout(300, () => done(true));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});
const isTaken = async port => (await Promise.all(['127.0.0.1', '::1'].map(host => answers(port, host)))).some(Boolean);

// Listens on the first free port from `start`. Port 0 asks the system for any free one.
async function listen(server, start) {
  for (let port = start; port < start + (start === 0 ? 1 : portAttempts) && port <= 65535; port++) {
    if (port !== 0 && await isTaken(port)) continue;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        // Loopback only: the history is for this machine.
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address().port;
    } catch (error) {
      // EACCES: Windows refuses ports in the ranges Hyper-V, WSL or Docker reserve, which nothing answers on beforehand.
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error(`No free port from ${start} to ${start + portAttempts - 1}. Pass one with --port.`);
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBody) reject(Object.assign(new Error('The request is too large.'), { status: 413 }));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('The request is not JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Assembles the viewer and the saved history into a temporary folder, serves it, and re-assembles when versions.json
// changes. A failed refresh goes to onError and the last good site keeps serving. It also answers the overlay's api:
// GET /afterimage/api/session (how many versions, the latest, and that saving works here) and
// POST /afterimage/api/save ({ name, note }, builds and saves). With app, the prototype's own folder is served at /,
// as it is on disk, for a plain HTML prototype that has no dev server of its own.
// Returns { url, versions, warnings, close }: warnings are from the first assemble, and close stops the server and
// the watcher and waits for a refresh in flight.
export async function startDev({ projectDir, config, port = defaultPort, viewerDir, runtimeDir, app = false, buildStdio, debounceMs = 150, onUpdate = () => {}, onError = () => {} }) {
  // Outside the project, never config.out: a build running beside dev keeps its own folder, and the app's dev server
  // (Vite watches the whole project) can't hold this one open on Windows, where that blocks replacing it after a save.
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'afterimage-dev-'));
  const removeTemp = () => fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  const devConfig = { ...config, out: path.join(tempDir, 'site') };
  const assemble = () => assembleSite({ projectDir, config: devConfig, viewerDir, runtimeDir, includeApp: false, allowEmpty: true });
  let first;
  try {
    first = await assemble();
  } catch (error) {
    await removeTemp();
    throw error;
  }
  const root = first.outDir;
  const historyDir = path.resolve(projectDir, config.history);
  const appRoot = path.resolve(projectDir, config.source);
  let saving = null;

  async function api(req, res, name) {
    if (name === 'session' && req.method === 'GET') {
      const manifest = await readHistory(historyDir);
      const latest = manifest?.versions[0];
      return sendJson(res, 200, { afterimage: 1, versions: manifest?.versions.length ?? 0, latest: latest ? { id: latest.id, name: latest.name } : null, canSave: true });
    }
    if (name === 'save' && req.method === 'POST') {
      // One at a time: a second press while a build runs would only queue the same save again.
      if (saving) return sendJson(res, 409, { error: 'A save is already running.' });
      saving = (async () => {
        const body = await readJson(req);
        const manifest = await readHistory(historyDir);
        const next = (manifest?.versions.length ?? 0) + 1;
        const given = typeof body.name === 'string' ? body.name.trim() : '';
        const notes = typeof body.note === 'string' && body.note.trim() ? [body.note.trim()] : [];
        const { version, unchanged } = await saveProject({ projectDir, config, name: given || `Version ${next}`, notes, buildStdio });
        return { saved: !unchanged, id: version.id, name: version.name };
      })();
      try {
        const result = await saving;
        // Answer once the served copy has the new version, so History opened right after shows it.
        if (result.saved) await refresh();
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, error.status ?? 500, { error: error.message });
      } finally {
        saving = null;
      }
    }
    if (name === 'session' || name === 'save') {
      res.writeHead(405, { Allow: name === 'save' ? 'POST' : 'GET' }).end();
      return;
    }
    res.writeHead(404).end();
  }

  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (pathname === null) { res.writeHead(400).end(); return; }
    if (pathname.startsWith(apiPath)) {
      const origin = req.headers.origin;
      if (origin !== undefined && !isLocalOrigin(origin)) { res.writeHead(403).end(); return; }
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }).end();
        return;
      }
      await api(req, res, pathname.slice(apiPath.length));
      return;
    }
    const inHistory = pathname === servedPath.slice(0, -1) || pathname.startsWith(servedPath);
    if (app && !inHistory) {
      const file = fileFor(appRoot, pathname);
      if (!file) { res.writeHead(403).end(); return; }
      await sendFile(res, file);
      return;
    }
    if (pathname === '/' || pathname === servedPath.slice(0, -1)) { res.writeHead(302, { Location: servedPath }).end(); return; }
    const file = fileFor(root, pathname);
    if (!file) { res.writeHead(403).end(); return; }
    // The stamp tells a pill loaded by script tag that dev answers on this origin; a built site's copy has none.
    if (pathname === overlayPath) {
      const source = await fs.promises.readFile(file, 'utf8').catch(() => null);
      if (source === null) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`window.__afterimageDev = true;\n${source}`);
      return;
    }
    await sendFile(res, file);
  });
  let boundPort;
  try {
    boundPort = await listen(server, port);
  } catch (error) {
    await removeTemp();
    throw error;
  }

  let closed = false;
  const stopServer = () => new Promise(resolve => {
    server.close(resolve);
    // A browser's keep-alive connection would otherwise hold the server open.
    server.closeAllConnections();
  });
  let timer = null;
  let refreshing = null;
  let again = false;
  // One refresh at a time. A change that lands during one asks for another straight after it.
  const refresh = () => {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      try {
        do {
          again = false;
          try {
            const result = await assemble();
            if (!closed) onUpdate(result);
          } catch (error) {
            if (!closed) onError(error);
          }
        } while (again && !closed);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  // A save publishes versions.json last, so it is the one file whose change means "the history is complete". The
  // history folder may not exist before the first save, so it is made here to be watched.
  let watcher;
  try {
    fs.mkdirSync(historyDir, { recursive: true });
    watcher = fs.watch(historyDir, (event, name) => {
      if (closed || (name && String(name) !== 'versions.json')) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, debounceMs);
    });
  } catch (error) {
    // The server is already listening; do not leave its port held.
    await stopServer();
    await removeTemp();
    throw error;
  }
  watcher.on('error', error => { if (!closed) onError(error); });

  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    watcher.close();
    await stopServer();
    await refreshing;
    await saving?.catch(() => {});
    await removeTemp();
  };

  return { url: `http://localhost:${boundPort}${servedPath}`, appUrl: app ? `http://localhost:${boundPort}/` : null, versions: first.versions, warnings: first.warnings, close };
}

// Resolves on Ctrl-C (or a terminate), or when a caller's signal aborts, which is how tests stop it.
function untilStopped(signal) {
  return new Promise(resolve => {
    if (signal) {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
      return;
    }
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// The app's own dev command, run through the shell like an npm script. Arguments with spaces keep their quotes.
const commandLine = parts => parts.map(part => (/[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ');

function runApp(command, cwd, stdio) {
  const child = spawn(command, { shell: true, cwd, stdio });
  const exited = new Promise(resolve => {
    child.on('error', error => resolve({ error }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited };
}

export async function run(args, { cwd, stdout, stderr, viewerDir, runtimeDir, signal, buildStdio, appStdio = 'inherit' }) {
  // Everything after -- is the app's own dev command, passed on as it is.
  const split = args.indexOf('--');
  const own = split === -1 ? args : args.slice(0, split);
  const appCommand = split === -1 ? [] : args.slice(split + 1);
  let parsed;
  try {
    parsed = parseArgs({ args: own, options });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error;
    stderr.write(`${error.message}\nUsage: ${usage}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(help);
    return 0;
  }
  let port = defaultPort;
  if (parsed.values.port !== undefined) {
    port = Number(parsed.values.port);
    if (!/^\d+$/.test(parsed.values.port) || port < 1 || port > 65535) {
      stderr.write(`--port needs a number from 1 to 65535.\nUsage: ${usage}\n`);
      return 2;
    }
  }
  if (split !== -1 && !appCommand.length) {
    stderr.write(`Put your dev command after --.\nUsage: ${usage}\n`);
    return 2;
  }

  const config = await readConfig(cwd);
  // A plain HTML prototype has no dev server of its own, so Afterimage serves it, and the pill on it is same-origin.
  const app = !appCommand.length && !config.build;
  const dev = await startDev({
    projectDir: path.resolve(cwd),
    config,
    port,
    viewerDir,
    runtimeDir,
    app,
    buildStdio,
    onUpdate: ({ versions, warnings }) => {
      for (const warning of warnings) stderr.write(`${warning}\n`);
      stdout.write(`Updated: ${count(versions)}.\n`);
    },
    onError: error => stderr.write(`Could not update the history: ${error.message}\nStill serving the last good copy.\n`)
  });
  for (const warning of dev.warnings) stderr.write(`${warning}\n`);
  stdout.write(`Afterimage is running at ${dev.url}\n`);

  if (appCommand.length) {
    const { child, exited } = runApp(commandLine(appCommand), cwd, appStdio);
    const stopped = untilStopped(signal).then(() => null);
    const outcome = await Promise.race([exited, stopped]);
    if (outcome === null) {
      child.kill();
      await exited;
      await dev.close();
      return 0;
    }
    await dev.close();
    if (outcome.error) {
      stderr.write(`Your dev command could not start: ${outcome.error.message}\n`);
      return 1;
    }
    return outcome.code ?? 1;
  }

  if (app) stdout.write(`Your prototype is at ${dev.appUrl}\n`);
  else stdout.write('Your app keeps running on its own dev server; this only serves the history.\n');
  await untilStopped(signal);
  await dev.close();
  return 0;
}
