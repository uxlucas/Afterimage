# Matching

To show what changed between two versions, the viewer loads both, lists the elements you can see on each page, and pairs each element in one version with its counterpart in the other. A pair that differs is a change. An element with no counterpart was added, or removed.

## What is compared

For each visible element, the viewer compares:

- its own text
- its `src`, `alt`, `href`, `type`, `placeholder` and `aria-label`
- an icon's drawing, for an `svg`
- its look: text and background color, background image, borders, corner rounding, shadow, typeface, text size and weight, line and letter spacing, alignment, padding, margins, gap, opacity and transform
- its position and size, when either moves by more than 2 pixels

Changes inside a changed section are grouped into one. Moves and resizes are listed after changes to content and look, since they are often the result of another change.

Positions come from the page as laid out in your window, so the same two versions can show a different count on a phone than on a desktop.

## How elements are paired

Each element gets a key, and two elements match when their keys are the same. The first rule that applies gives the key:

1. **`data-afterimage-id`**, when the element has one.
2. **Its `id`**, unless the build generated it.
3. **The page itself**, for `<body>`.
4. **The field it labels,** for a `<label>` with a `for`.
5. **Its `name`,** for an `input`, `textarea` or `select`.
6. **A class no sibling of the same tag shares,** under its parent's key. State classes (`active`, `selected`, `hidden`, `open`, and version names like `v2`) and generated names don't count.
7. **Its position** among siblings of the same tag, under its parent's key.

Most pages need nothing from you: ids, field names and distinct classes carry the match.

## Pinning a match with data-afterimage-id

When an element is matched with the wrong one, or a change shows up as one removal and one addition, give it the same `data-afterimage-id` in both versions:

```html
<section data-afterimage-id="pricing">
  ...
</section>
```

The value is yours to choose. It only has to be the same in every version and unique on the page. It wins over every other rule, so an element keeps its match however much its markup, classes or position change. None of the examples in this repo needs it.

## Generated names

Framework builds make up class names, ids and attributes, and many of them change from one build to the next even when the page doesn't. Matched by those names, two builds of the same page would look like a page of changes. So the viewer ignores the names below, both as keys and as compared values:

| Tool | Looks like |
| --- | --- |
| Svelte scoped styles | `svelte-dfcawr` |
| Svelte 4 hydration marker | `data-svelte-h` |
| Astro scoped styles | `astro-yk4hkwyg`, `data-astro-cid-yk4hkwyg` |
| Vite CSS modules | `_card_13qjp_1` |
| Next.js CSS modules with Turbopack | `_5Ujt5W_page`, `OIGFdW_title1` |
| Emotion | `css-1q2w3e4`, `css-1q2w3e4-Button` |
| React `useId`, React 19.3 | `_r_1_`, `_R_5ritbH1_` |
| React `useId`, React 19.1 | `«r1»`, `«R5ritbH1»` |
| React `useId`, React 18 | `:r0:`, `:R5ritbH1:` |
| Vue scoped styles | `data-v-7ba5bd90` |

An element whose only id or class is generated falls back to the next rule, usually its position. Inside an icon, generated ids are renumbered in order, and the references to them follow, so a rebuilt icon is the same icon.

Not covered:

- **Next.js CSS modules built with webpack,** such as `page_main__2oFM9`. That shape can't be told apart from hand-written BEM names, so these are compared as written, and a rebuild that changes them shows up as a change.
- **React `useId` with an `identifierPrefix`,** which changes the shape of the id.

### The trade-off

A hash is letters and digits, and some hashes are all letters. So a hand-written name of the same shape, such as `svelte-button`, `css-loader`, `astro-showcase` or `_row_cells_3`, is treated as generated too, and its element is matched by position instead. That costs little: class names are only compared inside an icon's markup, so such a class is only left out as a key, and left out of an icon's compared markup. Missing a real hash would cost more: a false change on every rebuild. Where the position isn't stable enough, pin the element with `data-afterimage-id`.

The patterns are as short as real hashes get without taking in common words, so names like `svelte-logo` and `css-grid` stay yours.
