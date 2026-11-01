import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseUrl } from '../src/viewer/state/url.js';

const root = path.resolve(import.meta.dirname, '..');
const read = async name => (await fs.readFile(path.join(root, name), 'utf8')).replace(/\r\n/g, '\n');

// → { fields, body }. Frontmatter here is flat "key: value" lines, which is all either agent needs.
function split(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'starts with frontmatter');
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const [, key, value] = line.match(/^(\w+):\s?(.*)$/);
    return [key, value];
  }));
  return { fields, body: text.slice(match[0].length) };
}

const skillFile = 'agents/skill/SKILL.md';
const ruleFile = 'agents/cursor/afterimage.mdc';

test('the skill has the frontmatter Claude Code reads', async () => {
  const { fields } = split(await read(skillFile));
  assert.deepEqual(Object.keys(fields), ['name', 'description']);
  assert.equal(fields.name, 'afterimage');
  assert.match(fields.description, /save/);
  assert.match(fields.description, /deploy/);
});

// The Cursor rule is the skill in Cursor's format. SKILL.md is the source: edit it, then copy its body here.
test('the Cursor rule carries the skill word for word, loaded by its description', async () => {
  const skill = split(await read(skillFile));
  const rule = split(await read(ruleFile));
  assert.deepEqual(rule.fields, { description: skill.fields.description, globs: '', alwaysApply: 'false' });
  assert.equal(rule.body, skill.body);
});

// Newest first, as versions.json lists them.
const versions = ['v4', 'v3', 'v2', 'v1'].map(id => ({ id }));

test('every viewer link the agent files give opens what they say', async () => {
  const links = [];
  for (const name of [skillFile, 'docs/agents.md']) {
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
  const docs = await read('docs/agents.md');
  const prompt = docs.split('## Setup prompt')[1].match(/```text\n([\s\S]*?)\n```/)[1];
  assert.ok(!prompt.includes('\n'), 'one paragraph');
  for (const command of [
    '`npm init -y`',
    '`npm install --save-dev afterimage-cli`',
    '`npx afterimage init`',
    '`npx afterimage init --source <folder>`',
    '`--build "<command>"`',
    '`npx afterimage save "First version"`',
    '`npx afterimage dev`',
    // The same paths init prints.
    '`node_modules/afterimage-cli/agents/skill`',
    '`node_modules/afterimage-cli/agents/cursor/afterimage.mdc`'
  ]) assert.ok(prompt.includes(command), command);
});

test('the agent files only name commands the CLI has', async () => {
  const commands = new Set(['init', 'save', 'dev', 'build']);
  for (const name of [skillFile, ruleFile, 'docs/agents.md']) {
    for (const [, command] of (await read(name)).matchAll(/npx afterimage (\w+)/g)) {
      assert.ok(commands.has(command), `${name}: npx afterimage ${command}`);
    }
  }
});
