import { spawn } from 'node:child_process';

// The command is the user's own (from afterimage.config.json), so it runs through the platform shell like an npm script.
// Tests pass 'ignore' or 'pipe' so a build's output does not land in the test report.
// Each caller says what a failed build leaves undone: "Nothing was saved." for save, "Nothing was built." for build.
//
// The build runs without the VERCEL variable, and with everything else as it was (VERCEL_URL and the rest stay).
// Vercel sets VERCEL while it builds, and some tools take it as a cue to write for Vercel's own deployment instead of
// plain files: SvelteKit's adapter-static then writes .vercel/output and never its usual folder
// (https://github.com/sveltejs/kit/blob/main/packages/adapter-static/platforms.js). Afterimage saves and deploys the
// plain static build, so the build must behave the same on a host as on a laptop.
export function runBuild(command, cwd, { stdio = 'inherit', closing = 'Nothing was saved.' } = {}) {
  const { VERCEL, ...env } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd, stdio, env });
    child.on('error', error => reject(new Error(`The build could not start: ${error.message}. ${closing}`)));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (code === null) reject(new Error(`The build was stopped by ${signal}. ${closing}`));
      else reject(new Error(`The build failed (exit code ${code}). ${closing}`));
    });
  });
}
