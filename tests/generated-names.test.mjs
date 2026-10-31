import test from 'node:test';
import assert from 'node:assert/strict';
import { isGeneratedName, isGeneratedAttribute } from '../src/engine/generated-names.js';

test('names a framework build generates are recognised', () => {
  for (const name of [
    'svelte-1x2y3z', 'svelte-dfcawr', // Svelte, as in the sveltekit-static build
    'astro-ABC123de', 'astro-yk4hkwyg', // Astro
    '_card_1a2b3_1', '_card__title--active_13qjp_2', '_btnPrimary_13qjp_3', // Vite CSS modules
    '_5Ujt5W_page', '_5Ujt5W_ctas', // Next CSS modules
    'css-1q2w3e4', 'css-19kzrtu', // Emotion
    ':r0:', ':r1a:', '«r1»', '_r_2_', '_R_', '_R_1_', // React useId
  ]) assert.equal(isGeneratedName(name), true, name);
});

test('names an author wrote are not', () => {
  for (const name of [
    'card', 'btn-primary', 'mt-4', 'h-10', 'grid-cols-3', 'v2-banner', // the brief's list
    'md:grid-cols-2', 'hover:bg-blue-500', 'w-1/2', 'text-[13px]', '-mt-2', // Tailwind
    'card__title--active', 'card--featured', 'block__elem_mod_val', // BEM
    'svelte-logo', 'astro-logo', 'css-reset', 'css-grid', // close in shape, too short to be a hash
    '_private', '_card', 'root', 'main', 'react-root', '',
  ]) assert.equal(isGeneratedName(name), false, name);
});

test('attributes only a framework build adds are recognised', () => {
  for (const name of ['data-astro-cid-yk4hkwyg', 'data-svelte-h', 'data-v-7ba5bd90']) assert.equal(isGeneratedAttribute(name), true, name);
});

test('attributes an author wrote are not', () => {
  for (const name of ['class', 'id', 'href', 'data-afterimage-id', 'data-testid', 'data-astro-reload', 'data-v', 'data-view', 'aria-label']) assert.equal(isGeneratedAttribute(name), false, name);
});
