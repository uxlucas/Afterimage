import { spawn } from 'node:child_process';

// The command is the user's own (from afterimage.config.json), so it runs through the platform shell like an npm script.
// Tests pass 'ignore' or 'pipe' so a build's output does not land in the test report.
// Each caller says what a failed build leaves undone: "Nothing was saved." for save, "Nothing was built." for build.
export function runBuild(command, cwd, { stdio = 'inherit', closing = 'Nothing was saved.' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, stdio });
    child.on('error', error => reject(new Error(`The build could not start: ${error.message}. ${closing}`)));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (code === null) reject(new Error(`The build was stopped by ${signal}. ${closing}`));
      else reject(new Error(`The build failed (exit code ${code}). ${closing}`));
    });
  });
}
