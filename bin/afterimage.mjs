#!/usr/bin/env node
import { main } from '../src/cli/main.js';

process.exitCode = await main(process.argv.slice(2), { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
