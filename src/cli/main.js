import * as init from './commands/init.js';
import * as save from './commands/save.js';
import * as build from './commands/build.js';
import * as dev from './commands/dev.js';
import { isUserError } from './errors.js';

// One entry per command. Each module exports run(args, ctx) → exit code, a one-line usage, a summary, its help (what
// both "afterimage help <command>" and "<command> --help" print) and its options.
export const commands = { init, save, dev, build };

function overview() {
  const lines = Object.values(commands).map(command => `  ${command.usage}\n      ${command.summary}`);
  return `Usage: afterimage <command>\n\nCommands:\n${lines.join('\n')}\n\nRun "afterimage help <command>" for one command.\n`;
}

// Usage mistakes exit 2, failures exit 1, success 0.
export async function main(argv, ctx) {
  const { stdout, stderr } = ctx;
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    stdout.write(overview());
    return 0;
  }
  if (first === 'help') {
    if (rest.length === 0) {
      stdout.write(overview());
      return 0;
    }
    const command = Object.hasOwn(commands, rest[0]) ? commands[rest[0]] : null;
    if (!command) {
      stderr.write(`Unknown command "${rest[0]}".\n\n${overview()}`);
      return 2;
    }
    stdout.write(command.help);
    return 0;
  }
  if (!Object.hasOwn(commands, first)) {
    stderr.write(`Unknown command "${first}".\n\n${overview()}`);
    return 2;
  }
  try {
    return await commands[first].run(rest, ctx);
  } catch (error) {
    stderr.write(isUserError(error) ? `${error.message}\n` : `${error?.stack ?? error}\n`);
    return 1;
  }
}
