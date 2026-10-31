// Names a framework build makes up, and that differ between builds of the same page. The change engine ignores them,
// both as match keys and as compared values, so that a rebuilt page is not reported as changed.
// Every pattern is anchored. A name an author would write must stay out: card, btn-primary, mt-4, grid-cols-3,
// v2-banner, md:grid-cols-2, card__title--active, _header_nav.
// "Found" means a name in the saved builds under examples/; "Checked" means a build or source file read for this list.
//
// The trade-off, for every pattern that ends in a hash: a hash is letters and digits, and some hashes are all letters
// (svelte-dfcawr is one), so a word of the same length cannot be told from it by shape. svelte-button, css-loader,
// astro-showcase and _row_cells_3 are treated as generated. That costs little: class lists are not compared outside
// an svg's markup, so the class is only not used as a match key (the element is matched by position), and it is left
// out of that markup. A missed hash would be a false change on every rebuild, which is the bug this file prevents.
// Lengths are as short as real hashes get without taking in common words (svelte-logo, css-grid stay author names).

const generatedNames = [
  // Svelte scoped styles: class="svelte-dfcawr". Found in sveltekit-static. The hash is (n >>> 0).toString(36)
  // (svelte/src/utils.js), 1 to 7 characters. Below 5 too many words would match (svelte-logo).
  /^svelte-[a-z0-9]{5,7}$/,
  // Astro scoped styles with scopedStyleStrategy "class" or "where": class="astro-yk4hkwyg". Checked on astro 7.4.4,
  // where it is eight lowercase characters. The brief's astro-ABC123de is mixed case, as older Astro wrote it.
  /^astro-[A-Za-z0-9]{8}$/,
  // Vite CSS modules: _card_13qjp_1. Checked in vite 8.3.5 (generateScopedNameDefault): `_${name}_${hash}_${line}`,
  // with the hash string-hash(css).toString(36).substr(0, 5), so lowercase base 36. The name is a CSS identifier.
  // vite-react has no CSS module.
  /^_[\w-]+_[a-z0-9]{5}_\d+$/,
  // Next CSS modules with Turbopack (Next's default): _5Ujt5W_page, OIGFdW_title1, d3_SXq_box. Found in next-static,
  // then 60 modules built for this list. The hash is six base64url characters, prefixed with _ when it starts with a
  // digit. In all 60 the last character was one of G, W, a, q, which fits a 32-bit hash, and is what keeps hand-written
  // _header_nav, _button_primary and _Footer_links out. A hash of six lowercase letters is left out too.
  // Next with webpack names classes page_main__2oFM9, which cannot be told from BEM, so it is not matched.
  /^(?!_?[a-z]{6}_)_?[\w-]{5}[GWaq]_[\w-]+$/,
  // Emotion: css-1q2w3e4, and css-1q2w3e4-Button with the babel plugin's label. Not in the examples.
  /^css-[a-z0-9]{6,7}(?:-[\w-]+)?$/,
  // React useId. The client form is made in the browser; the server form is what a server-rendered page ships and
  // hydration keeps: the tree position in base 32, then H and a second id in the same component (_R_5ritbH1_), and
  // nothing at all for the root (_R__). Ids are base 32, so [0-9a-v]. An identifierPrefix would change the shape
  // (_myR_...) and is not covered.
  // React 19.3, checked in react-dom 19.3.0: mountId in react-dom-client.development.js (_r_<n>_ and, when
  // hydrating, _R_<tree>[H<n>]_) and makeId in react-dom-server.node.development.js.
  /^_r_[0-9a-v]+_$/,
  /^_R_[0-9a-v]*(?:H[0-9a-v]+)?_$/,
  // React 19.1: «r1» and «R5ritbH1». Not in the examples (react-dom 19.3 only); the same shape as 19.3 in other
  // brackets, so not checked against a 19.1 build.
  /^«(?:r[0-9a-v]+|R[0-9a-v]*(?:H[0-9a-v]+)?)»$/,
  // React 18: :r0: and :R5ritbH1:. Same caveat.
  /^:(?:r[0-9a-v]+|R[0-9a-v]*(?:H[0-9a-v]+)?):$/,
  // Not matched on purpose: the id _R_ that Next writes on its Turbopack bootstrap script (react-dom-server shellId).
  // It is a constant, the same in every build, and scripts are not compared.
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
