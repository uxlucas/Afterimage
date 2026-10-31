// Gets the examples ready to run: builds the viewer if it is missing, then installs each example's own dependencies.
// Every example depends on the package through "file:../..", which links this checkout, so the examples use the real
// bin and the real viewer-dist. A viewer that already exists is not rebuilt; run `npm run build:viewer` after changing it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// shell: true so that npm (npm.cmd on Windows) resolves. One command string, since node warns about args with a shell.
function npm(args) {
  const result = spawnSync(`npm ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`"npm ${args.join(' ')}" failed (${result.status ?? result.error?.message}).`);
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(path.join(root, 'viewer-dist', 'index.html'))) npm(['run', 'build:viewer']);

const examplesDir = path.join(root, 'examples');
const examples = fs.readdirSync(examplesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(examplesDir, entry.name, 'package.json')))
  .map(entry => entry.name);

for (const name of examples) {
  console.log(`Installing examples/${name}`);
  npm(['install', '--prefix', `examples/${name}`]);
}
