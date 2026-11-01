// Reading and writing the project's own files, for init and the host config it plans.
import fs from 'node:fs/promises';

// Windows editors often save JSON with a byte order mark. JSON.parse rejects it, so it is split off and put back.
const bomMark = '﻿';

export async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// → { bom, body } with body null when the file does not exist.
export async function readJsonText(file) {
  const raw = await readText(file);
  if (raw === null) return { bom: '', body: null };
  const bom = raw.startsWith(bomMark) ? bomMark : '';
  return { bom, body: raw.slice(bom.length) };
}

export function parseJson(text, name) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}\nFix it, then run "afterimage init" again.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object.\nFix it, then run "afterimage init" again.`);
  }
  return value;
}

// A step's write, run only once every step has been planned.
export const writer = (file, text) => () => fs.writeFile(file, text);
