import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readConfig } from '../config.js';
import { assembleSite } from '../site.js';
import { fileFor, requestPath, sendFile } from '../static-files.js';

export const usage = 'afterimage dev [--port N]';
export const summary = 'Serve the saved history at /afterimage/ while your app runs on its own dev server.';
// What both "afterimage dev --help" and "afterimage help dev" print.
export const help = `Usage: ${usage}\n\n${summary}\n\n  --port N  the port to start from, 4321 by default; a busy one moves to the next free port\n`;
// Read by the docs tests, which check every flag the agent files name.
export const options = { port: { type: 'string' }, help: { type: 'boolean', short: 'h' } };

const defaultPort = 4321;
const portAttempts = 20;
// Its own folder, never config.out, so dev and a running build can never share a staging folder.
const devOut = '.afterimage/dev';
const servedPath = '/afterimage/';

const count = versions => `${versions} ${versions === 1 ? 'version' : 'versions'}`;

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
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No free port from ${start} to ${start + portAttempts - 1}. Pass one with --port.`);
}

// Assembles the viewer and the saved history (not the app) into .afterimage/dev, serves it, and re-assembles when
// versions.json changes. A failed refresh goes to onError and the last good site keeps serving.
// Returns { url, versions, warnings, close }: warnings are from the first assemble, and close stops the server and
// the watcher and waits for a refresh in flight.
export async function startDev({ projectDir, config, port = defaultPort, viewerDir, runtimeDir, debounceMs = 150, onUpdate = () => {}, onError = () => {} }) {
  const devConfig = { ...config, out: devOut };
  const assemble = () => assembleSite({ projectDir, config: devConfig, viewerDir, runtimeDir, includeApp: false });
  const first = await assemble();
  const root = first.outDir;

  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (pathname === null) { res.writeHead(400).end(); return; }
    if (pathname === '/' || pathname === servedPath.slice(0, -1)) { res.writeHead(302, { Location: servedPath }).end(); return; }
    const file = fileFor(root, pathname);
    if (!file) { res.writeHead(403).end(); return; }
    await sendFile(res, file);
  });
  const boundPort = await listen(server, port);

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

  // A save publishes versions.json last, so it is the one file whose change means "the history is complete".
  let watcher;
  try {
    watcher = fs.watch(path.resolve(projectDir, config.history), (event, name) => {
      if (closed || (name && String(name) !== 'versions.json')) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, debounceMs);
    });
  } catch (error) {
    // The server is already listening; do not leave its port held.
    await stopServer();
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
  };

  return { url: `http://localhost:${boundPort}${servedPath}`, versions: first.versions, warnings: first.warnings, close };
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

export async function run(args, { cwd, stdout, stderr, viewerDir, runtimeDir, signal }) {
  let parsed;
  try {
    parsed = parseArgs({ args, options });
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

  const config = await readConfig(cwd);
  const dev = await startDev({
    projectDir: path.resolve(cwd),
    config,
    port,
    viewerDir,
    runtimeDir,
    onUpdate: ({ versions, warnings }) => {
      for (const warning of warnings) stderr.write(`${warning}\n`);
      stdout.write(`Updated: ${count(versions)}.\n`);
    },
    onError: error => stderr.write(`Could not update the history: ${error.message}\nStill serving the last good copy.\n`)
  });
  for (const warning of dev.warnings) stderr.write(`${warning}\n`);
  stdout.write(`Afterimage is running at ${dev.url}\n`);
  stdout.write('Your app keeps running on its own dev server; this only serves the history.\n');
  await untilStopped(signal);
  await dev.close();
  return 0;
}
