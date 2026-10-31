// Names a framework build makes up, and that differ between builds of the same page. The change engine ignores them,
// both as match keys and as compared values, so that a rebuilt page is not reported as changed.
// Every pattern is anchored and as narrow as the tool's own output allows. A name an author would write must stay out:
// card, btn-primary, mt-4, grid-cols-3, v2-banner, md:grid-cols-2, card__title--active.
// "Found" means a name in the saved builds under examples/; "Checked" means a build made for this list.

const generatedNames = [
  // Svelte scoped styles: class="svelte-dfcawr". Found in sveltekit-static. Six or seven base-36 characters, which a
  // short author name such as svelte-logo does not reach.
  /^svelte-[a-z0-9]{6,7}$/,
  // Astro scoped styles with scopedStyleStrategy "class" or "where": class="astro-yk4hkwyg". Checked on astro (7.4.4).
  // The default strategy is an attribute instead, which isGeneratedAttribute covers. Astro 2 and earlier wrote capitals.
  /^astro-[a-z0-9]{8}$/i,
  // Vite CSS modules: _card_13qjp_1, which is _name_hash_line. Checked with vite 8.3.5; vite-react has no CSS module.
  /^_.+_[a-z0-9]{5}_\d+$/,
  // Next CSS modules (Turbopack): _5Ujt5W_page, which is _hash_name. Found in next-static.
  /^_[A-Za-z0-9]{6}_[\w-]+$/,
  // Emotion: css-1q2w3e4. Not in the examples; the hash is six or seven base-36 characters.
  /^css-[a-z0-9]{6,7}$/,
  // React 18 useId: :r0:, :r1a:. Not in the examples (they use React 19).
  /^:r[0-9a-z]+:$/,
  // React 19.1 useId: «r1». Not in the examples.
  /^«r[0-9a-z]+»$/,
  // React 19.2 useId: _r_2_ in the browser, _R_1_ from the server. Found in next-static as the id _R_ of its bootstrap script.
  /^_[rR]_(?:[0-9a-z]+_)?$/,
];

const generatedAttributes = [
  // Astro scoped styles, default strategy: data-astro-cid-yk4hkwyg on every element of a styled component. Found in astro.
  /^data-astro-cid-[a-z0-9]+$/,
  // Svelte 4 hydration marker, data-svelte-h="svelte-1x2y3z". Not in the examples (Svelte 5 does not write it).
  /^data-svelte-h$/,
  // Vue scoped styles: data-v-7ba5bd90. Not in the examples.
  /^data-v-[0-9a-f]{8}$/,
];

export const isGeneratedName = name => generatedNames.some(pattern => pattern.test(name));
export const isGeneratedAttribute = name => generatedAttributes.some(pattern => pattern.test(name));
