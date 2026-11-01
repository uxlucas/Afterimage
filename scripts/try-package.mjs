// Proves the packed package works the way a user gets it: pack it, install the tarball in fresh projects (a Vite + React
// app and a plain HTML folder), set them up with `afterimage init`, save twice, build, and run the same browser check
// the examples get. Run it with `npm run try:package`. It is not part of `npm test`: it installs from the npm registry
// and drives Chrome, and takes a few minutes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkExample } from '../tests/e2e/harness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const viteExample = path.join(root, 'examples/vite-react');

// Paths the tarball must carry, and folders it must not. Names are as `npm pack --json` lists them (forward slashes).
const required = ['bin/afterimage.mjs', 'viewer-dist/index.html', 'src/runtime/sw.js', 'agents/skill/SKILL.md', 'README.md', 'LICENSE'];
const forbidden = ['tests/', 'examples/', 'launch/', 'src/viewer/'];

const fail = message => { throw new Error(message); };
const step = message => console.log(`\n== ${message}`);

// One command string with shell: true, so npm and npx (.cmd on Windows) resolve; node warns about args with a shell.
function run(command, cwd, { capture = false } = {}) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) fail(`"${command}" failed in ${cwd} (${result.status ?? result.error?.message})${capture ? `\n${result.stdout}${result.stderr}` : ''}`);
  return result.stdout;
}

// prepack builds the viewer and prints to stdout ahead of the JSON, so the list starts at the last line that is just "[".
function pack(destination) {
  const out = run(`npm pack --json --pack-destination "${destination}"`, root, { capture: true });
  const start = out.lastIndexOf('\n[\n') + 1;
  if (start === 0) fail(`npm pack printed no file list:\n${out}`);
  const [{ filename, files }] = JSON.parse(out.slice(start));
  const names = files.map(file => file.path);
  const missing = required.filter(name => !names.includes(name));
  if (missing.length) fail(`The tarball lacks ${missing.join(', ')}.`);
  const extra = names.filter(name => forbidden.some(folder => name.startsWith(folder)));
  if (extra.length) fail(`The tarball carries files it should not: ${extra.slice(0, 5).join(', ')}.`);
  console.log(`${filename}: ${names.length} files`);
  return path.join(destination, filename);
}

// A Vite + React app as a fresh scaffold leaves it: the example's own app files, without its Afterimage history, config
// or git rules, and without afterimage-cli in its package.json. Plus two files Vite copies from public/ that prototypes
// often ship: Netlify's extensionless SPA fallback and a 3D model.
const viteExtras = { _redirects: '/*  /index.html  200\n', 'model.glb': Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]) };

async function freshVite(dir) {
  const manifest = JSON.parse(await fs.readFile(path.join(viteExample, 'package.json'), 'utf8'));
  delete manifest.devDependencies['afterimage-cli'];
  manifest.scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) => !name.startsWith('afterimage:')));
  manifest.name = 'fresh-vite-react';
  manifest.description = 'A fresh Vite + React app.';
  await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const name of ['index.html', 'vite.config.js', 'src', 'public']) {
    await fs.cp(path.join(viteExample, name), path.join(dir, name), { recursive: true });
  }
  await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\ndist\n');
  for (const [name, bytes] of Object.entries(viteExtras)) await fs.writeFile(path.join(dir, 'public', name), bytes);
}

// The extras reach the live root and both saved versions, byte for byte.
async function checkViteExtras(dir) {
  for (const folder of ['.afterimage/site', '.afterimage/site/afterimage/versions/v1', '.afterimage/site/afterimage/versions/v2']) {
    for (const [name, bytes] of Object.entries(viteExtras)) {
      const found = await fs.readFile(path.join(dir, folder, name)).catch(() => null);
      if (!found?.equals(Buffer.from(bytes))) fail(`${folder}/${name} is ${found ? 'not the file the app ships' : 'missing'}.`);
    }
  }
}

async function editText(file, from, to) {
  const before = await fs.readFile(file, 'utf8');
  if (!before.includes(from)) fail(`${file} does not contain "${from}" to edit.`);
  await fs.writeFile(file, before.replace(from, to));
}

// A folder with an index.html and nothing else: the setup prompt runs npm init -y first, as the docs do.
async function freshPlain(dir) {
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Plain page</title>\n</head>\n<body>\n<h1>Hello from a plain page</h1>\n<p>No build, no package.json.</p>\n</body>\n</html>\n');
  run('npm init -y', dir, { capture: true });
}

const projects = [
  {
    name: 'Vite + React app',
    create: freshVite,
    install: true,
    edit: dir => editText(path.join(dir, 'src/App.jsx'), 'Ship the prototype', 'Ship the packed prototype'),
    check: { expectChange: 'Ship the packed prototype', follow: { link: 'About this app', shows: 'A second route' } },
    verify: checkViteExtras
  },
  {
    name: 'plain HTML folder',
    create: freshPlain,
    install: false,
    edit: dir => editText(path.join(dir, 'index.html'), 'Hello from a plain page', 'Hello again from a plain page'),
    check: { expectChange: 'Hello again from a plain page' }
  }
];

async function tryProject(project, tarball) {
  step(project.name);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-try-'));
  try {
    await project.create(dir);
    if (project.install) {
      console.log('npm install (the app)');
      run('npm install', dir, { capture: true });
    }
    console.log('npm install the tarball');
    run(`npm install --save-dev "${tarball}"`, dir, { capture: true });
    console.log('afterimage init');
    run('npx afterimage init --no-input', dir, { capture: true });
    console.log('afterimage save (v1)');
    run('npx afterimage save "First version"', dir, { capture: true });
    await project.edit(dir);
    console.log('afterimage save (v2)');
    run('npx afterimage save "Second version"', dir, { capture: true });
    console.log('afterimage build, then the browser check');
    run('npx afterimage build', dir, { capture: true });
    await project.verify?.(dir);
    const report = await checkExample(dir, { ...project.check, build: () => {} });
    console.log(`ok: ${report.versions.map(version => version.id).join(', ')}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const started = Date.now();
const packDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-pack-'));
try {
  step('npm pack');
  const tarball = pack(packDir);
  for (const project of projects) await tryProject(project, tarball);
  console.log(`\nThe packed package works in both fresh projects (${Math.round((Date.now() - started) / 1000)}s).`);
} catch (error) {
  console.error(`\ntry-package failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await fs.rm(packDir, { recursive: true, force: true });
}
