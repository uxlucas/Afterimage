import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkExample } from './harness.mjs';

const example = name => fileURLToPath(new URL(`../../examples/${name}/`, import.meta.url));

test('northwind: every version renders and v3 shows its changes', async () => {
  const report = await checkExample(example('northwind'), { expectChange: 'Sign in with passkey' });
  assert.deepEqual(report.versions.map(version => version.id), ['v3', 'v2', 'v1']);
});
