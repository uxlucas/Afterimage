import { spawn } from 'node:child_process';

// The command is the user's own (from afterimage.config.json), so it runs through the platform shell like an npm script.
// Tests pass 'ignore' or 'pipe' so a build's output does not land in the test report.
export function runBuild(command, cwd, { stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, stdio });
    child.on('error', error => reject(new Error(`The build could not start: ${error.message}. Nothing was saved.`)));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (code === null) reject(new Error(`The build was stopped by ${signal}. Nothing was saved.`));
      else reject(new Error(`The build failed (exit code ${code}). Nothing was saved.`));
    });
  });
}
