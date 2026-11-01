import test from 'node:test';
import assert from 'node:assert/strict';
import { isGeneratedName, isGeneratedAttribute } from '../src/engine/generated-names.js';

test('names a framework build generates are recognised', () => {
  for (const name of [
    'svelte-1x2y3z', 'svelte-dfcawr', 'svelte-abcde', // Svelte, as in the sveltekit-static build; five characters is the shortest
    'astro-ABC123de', 'astro-yk4hkwyg', // Astro
    '_card_1a2b3_1', '_card__title--active_13qjp_2', '_btnPrimary_13qjp_3', // Vite CSS modules
    '_5Ujt5W_page', '_5Ujt5W_ctas', '_7FyYoW_header-nav', 'OIGFdW_title1', '-TvuAW_title2', 'd3_SXq_title8', 'V_2eta_title23', '_83Z4_q_title39', // Next CSS modules (Turbopack), as built
    'css-1q2w3e4', 'css-19kzrtu', 'css-1q2w3e4-Button', // Emotion
    ':r0:', ':r1a:', ':R5ritb:', ':R:', ':R5ritbH1:', // React 18
    '«r1»', '«R5ritb»', '«R5ritbH1»', // React 19.1
    '_r_2_', '_r_1a_', '_R__', '_R_5ritb_', '_R_5ritbH1_', '_R_1H2_', // React 19.3, client and server forms
  ]) assert.equal(isGeneratedName(name), true, name);
});

test('names an author wrote are not', () => {
  for (const name of [
    'card', 'btn-primary', 'mt-4', 'h-10', 'grid-cols-3', 'v2-banner', // plain hand-written names
    'md:grid-cols-2', 'hover:bg-blue-500', 'w-1/2', 'text-[13px]', '-mt-2', // Tailwind
    'card__title--active', 'card--featured', 'block__elem_mod_val', // BEM
    '_header_nav', '_button_primary', '_layout_grid', '_active_link', '_mobile_menu', '_Button_primary', '_Footer_links', // leading underscore, snake case
    'svelte-logo', 'astro-logo', 'css-reset', 'css-grid', // close in shape, too short to be a hash
    '_private', '_card', '_card_1', 'root', 'main', 'react-root', 'Button_primary', '',
    '_R_', '_r_', 'R5ritb', ':r:', '«»', // not an id React writes (_R_ alone is Next's bootstrap script, a constant)
  ]) assert.equal(isGeneratedName(name), false, name);
});

// A hash and a word can have the same shape, so some words are taken for hashes. This pins that cost, described at the top
// of generated-names.js, so nobody reads it as a bug: such a class is only not used as a match key.
test('words shaped like a hash are treated as generated, by design', () => {
  for (const name of ['svelte-button', 'css-loader', 'astro-showcase', '_hero_title_12', '_row_cells_3']) assert.equal(isGeneratedName(name), true, name);
});

test('attributes only a framework build adds are recognised', () => {
  for (const name of ['data-astro-cid-yk4hkwyg', 'data-svelte-h', 'data-v-7ba5bd90']) assert.equal(isGeneratedAttribute(name), true, name);
});

test('attributes an author wrote are not', () => {
  for (const name of ['class', 'id', 'href', 'data-afterimage-id', 'data-testid', 'data-astro-reload', 'data-v', 'data-view', 'aria-label']) assert.equal(isGeneratedAttribute(name), false, name);
});
