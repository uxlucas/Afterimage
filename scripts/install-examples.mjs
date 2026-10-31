// Installs each example's own dependencies, skipping an example that already has a node_modules folder.
// Every example depends on the package through "file:../..", which links this checkout, so the examples use the real
// bin and the real viewer-dist. `npm run test:e2e` rebuilds the viewer first, so e2e never runs against a stale one.
// Every dependency in an example's package.json must be an exact version (no ^ or ~), since example lockfiles are ignored.
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

const examplesDir = path.join(root, 'examples');
const examples = fs.readdirSync(examplesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(examplesDir, entry.name, 'package.json')))
  .map(entry => entry.name);

for (const name of examples) {
  if (fs.existsSync(path.join(examplesDir, name, 'node_modules'))) {
    console.log(`examples/${name} is already installed`);
    continue;
  }
  console.log(`Installing examples/${name}`);
  npm(['install', '--prefix', `examples/${name}`]);
}
