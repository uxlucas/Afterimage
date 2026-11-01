import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { commands } from '../src/cli/main.js';

const root = path.resolve(import.meta.dirname, '..');
const read = async name => (await fs.readFile(path.join(root, name), 'utf8')).replace(/\r\n/g, '\n');

// The public docs. docs/agents.md is held to more by tests/agents.test.mjs.
const docFiles = async () => [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  ...(await fs.readdir(path.join(root, 'docs'))).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)
];

test('the docs that ship with the repo are all there', async () => {
  const names = await docFiles();
  for (const name of ['docs/getting-started.md', 'docs/commands.md', 'docs/deploying.md', 'docs/checking-a-deploy.md', 'docs/matching.md', 'docs/limits.md', 'docs/agents.md']) {
    assert.ok(names.includes(name), name);
  }
  for (const name of names) await fs.access(path.join(root, name));
});

// Code in the docs: each line of a code block, and each code span outside them.
const codeBlock = /```[a-z]*\n([\s\S]*?)```/g;
async function codeIn(name) {
  const text = await read(name);
  const lines = [...text.matchAll(codeBlock)].flatMap(match => match[1].split('\n'));
  const spans = [...text.replace(codeBlock, '').matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
  return [...lines, ...spans];
}

const flagsOf = command => Object.keys(commands[command].options).map(option => `--${option}`);

test('the docs only name commands and flags the CLI has', async () => {
  const allFlags = new Set(Object.keys(commands).flatMap(flagsOf));
  for (const name of await docFiles()) {
    for (const code of await codeIn(name)) {
      // "afterimage save ..." as typed, with or without npx. Not afterimage/, afterimage-cli or afterimage:build.
      for (const [, command, rest] of code.matchAll(/(?<![\w/.:-])afterimage (\w+)([^`|]*)/g)) {
        if (command === 'help') {
          const [topic] = rest.trim().split(/\s+/);
          assert.ok(!topic || topic === '<command>' || Object.hasOwn(commands, topic), `${name}: afterimage help ${topic}`);
          continue;
        }
        assert.ok(Object.hasOwn(commands, command), `${name}: afterimage ${command}`);
        for (const [flag] of rest.matchAll(/(?<![\w-])--[a-z][\w-]*/g)) {
          assert.ok(flagsOf(command).includes(flag), `${name}: ${command} has no ${flag} (in "${code}")`);
        }
      }
      // A flag named on its own, as in `--source <folder>`. Flags of other tools (curl, git, tar) sit in their own lines.
      const alone = code.match(/^--[a-z][\w-]*/);
      if (alone) assert.ok(allFlags.has(alone[0]), `${name}: no command has ${alone[0]}`);
    }
  }
});

// The anchors GitHub gives a Markdown file's headings: lowercase, punctuation dropped, spaces as hyphens.
const anchorsOf = text => new Set([...text.replace(codeBlock, '').matchAll(/^#+ (.+)$/gm)]
  .map(([, heading]) => heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-')));

test('every relative link in the docs points at a file in the repo, and at a heading in it', async () => {
  for (const name of await docFiles()) {
    const text = (await read(name)).replace(codeBlock, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const linked = file ? path.relative(root, path.resolve(path.dirname(path.join(root, name)), file)).replace(/\\/g, '/') : name;
      await assert.doesNotReject(fs.access(path.join(root, linked)), `${name} links to ${target}, which does not exist`);
      if (anchor) assert.ok(anchorsOf(await read(linked)).has(anchor), `${name} links to ${target}, which has no such heading`);
    }
  }
});

test('the docs carry nothing of the project Afterimage grew out of', async () => {
  for (const name of await docFiles()) {
    const text = await read(name);
    for (const leftover of [/time-machine/i, /time machine/i, /tm-id/, /playground/i, /\/draft/]) {
      assert.doesNotMatch(text, leftover, name);
    }
  }
});
