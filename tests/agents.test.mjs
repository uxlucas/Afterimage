import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { commands } from '../src/cli/main.js';
import { parseUrl } from '../src/viewer/state/url.js';

const root = path.resolve(import.meta.dirname, '..');
const read = async name => (await fs.readFile(path.join(root, name), 'utf8')).replace(/\r\n/g, '\n');

// → { fields, body }. Frontmatter here is flat "key: value" lines, which is all either agent needs.
function split(text, name) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${name} starts with frontmatter between --- lines`);
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const field = line.match(/^(\w+):\s?(.*)$/);
    assert.ok(field, `${name} frontmatter line is not "key: value": ${line}`);
    return field.slice(1);
  }));
  return { fields, body: text.slice(match[0].length) };
}

const skillFile = 'agents/skill/SKILL.md';
const ruleFile = 'agents/cursor/afterimage.mdc';
const docsFile = 'docs/agents.md';
const agentFiles = [skillFile, ruleFile, docsFile];

test('the skill has the frontmatter Claude Code reads', async () => {
  const { fields } = split(await read(skillFile), skillFile);
  assert.deepEqual(Object.keys(fields), ['name', 'description']);
  assert.equal(fields.name, 'afterimage');
  assert.match(fields.description, /save/);
  assert.match(fields.description, /deploy/);
  assert.match(fields.description, /Not for git commits/);
});

// The Cursor rule is the skill in Cursor's format. SKILL.md is the source: edit it, then copy its body here.
test('the Cursor rule carries the skill word for word, loaded by its description', async () => {
  const skill = split(await read(skillFile), skillFile);
  const rule = split(await read(ruleFile), ruleFile);
  // Cursor's documented form for a rule the agent pulls in by its description: no globs, not always applied.
  assert.deepEqual(rule.fields, { description: skill.fields.description, alwaysApply: 'false' });
  assert.equal(rule.body, skill.body);
});

test('the docs list every rule of the skill, as the skill words it', async () => {
  const { body } = split(await read(skillFile), skillFile);
  const rules = body.split('## Rules\n')[1];
  const headlines = [...rules.matchAll(/^- \*\*(.+?)\*\*/gm)].map(match => match[1]);
  assert.equal(headlines.length, 6);
  const docs = (await read(docsFile)).split("The skill's rules:\n")[1];
  assert.ok(docs, "docs/agents.md has the skill's rules");
  for (const headline of headlines) assert.ok(docs.includes(`- ${headline}`), headline);
  assert.equal([...docs.matchAll(/^- /gm)].length, headlines.length, 'and no rule the skill does not have');
});

// Newest first, as versions.json lists them.
const versions = ['v4', 'v3', 'v2', 'v1'].map(id => ({ id }));

test('every viewer link the agent files give opens what they say', async () => {
  const links = [];
  for (const name of [skillFile, docsFile]) {
    // Links to a real id; ?version=<latest> is the agent's to fill in.
    for (const [query] of (await read(name)).matchAll(/\?version=v\d+[^\s`)]*/g)) links.push(query);
  }
  assert.ok(links.length >= 3);
  for (const query of links) {
    const params = new URLSearchParams(query);
    const parsed = parseUrl(query, versions);
    assert.equal(parsed.versionId, params.get('version'), query);
    assert.equal(parsed.mode, params.get('mode') ?? 'explore', query);
    if (params.has('base')) assert.equal(parsed.baseId, params.get('base'), query);
  }
});

test('the setup prompt is one paragraph with every command written out', async () => {
  const docs = await read(docsFile);
  const prompt = docs.split('## Setup prompt')[1].match(/```text\n([\s\S]*?)\n```/)[1];
  assert.ok(!prompt.includes('\n'), 'one paragraph');
  for (const command of [
    '`npm init -y`',
    '`npm install --save-dev afterimage-cli`',
    '`npx afterimage init --agent claude --no-input`',
    '`npx afterimage init --agent cursor --no-input`',
    '`npx afterimage init --no-input`',
    '`--source <folder>`',
    '`--build "<command>"`',
    '`npx afterimage save "First version"`',
    '`npx afterimage dev`',
    '`node_modules/afterimage-cli/agents/skill/SKILL.md`',
    // What init and dev print in each case the prompt tells apart.
    '`Say where the prototype is`',
    '`no static build`',
    '`Afterimage is running at`'
  ]) assert.ok(prompt.includes(command), command);
});

// Usage text in the agent files: each line of a bash block, and each code span outside them. A text block is prose
// (the setup prompt, an example prompt), so its own code spans count.
const bashBlock = /```bash\n([\s\S]*?)```/g;
async function codeIn(name) {
  const text = await read(name);
  const lines = [...text.matchAll(bashBlock)].flatMap(match => match[1].split('\n'));
  const spans = [...text.replace(bashBlock, '').matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
  return [...lines, ...spans];
}

const flagsOf = command => Object.keys(commands[command].options).map(option => `--${option}`);
// Lines that run another tool, whose flags are its own.
const otherTool = /^(git|npm) /;

test('the agent files only name commands and flags the CLI has', async () => {
  const allFlags = new Set(Object.keys(commands).flatMap(flagsOf));
  for (const name of agentFiles) {
    for (const code of await codeIn(name)) {
      for (const [, command, rest] of code.matchAll(/npx afterimage (\w+)([^`]*)/g)) {
        assert.ok(Object.hasOwn(commands, command), `${name}: npx afterimage ${command}`);
        for (const [flag] of rest.matchAll(/--[a-z][\w-]*/g)) {
          assert.ok(flagsOf(command).includes(flag), `${name}: ${command} has no ${flag} (in "${code}")`);
        }
      }
      // A flag named on its own still has to belong to a command.
      if (otherTool.test(code)) continue;
      for (const [flag] of code.matchAll(/(?<![\w-])--[a-z][\w-]*/g)) {
        assert.ok(allFlags.has(flag), `${name}: no command has ${flag} (in "${code}")`);
      }
    }
  }
});

// The prompt and the skill tell init's and dev's outcomes apart by what they print, so those words must stay in the CLI.
test('each CLI message the setup prompt quotes is still printed by the CLI', async () => {
  const cliDir = path.join(root, 'src/cli');
  const files = (await fs.readdir(cliDir, { recursive: true })).filter(name => name.endsWith('.js'));
  const source = (await Promise.all(files.map(name => fs.readFile(path.join(cliDir, name), 'utf8')))).join('\n');
  const prompt = (await read(docsFile)).split('## Setup prompt')[1].match(/```text\n([\s\S]*?)\n```/)[1];
  const skill = await read(skillFile);
  for (const message of ['Say where the prototype is', 'no static build', 'Afterimage is running at']) {
    assert.ok(prompt.includes(`\`${message}\``), `the prompt quotes ${message}`);
    assert.ok(skill.includes(message), `the skill names ${message}`);
    assert.ok(source.includes(message), `src/cli still prints ${message}`);
  }
});
