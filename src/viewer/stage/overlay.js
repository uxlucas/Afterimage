// Highlights drawn into a prototype's own document. Plain DOM on purpose: the overlay lives inside
// the iframe, outside React. Positions are page coordinates, so scrolling never needs a redraw.

const RGB = { changed: '229 168 59', added: '111 191 115', removed: '224 112 95' };
const color = kind => `rgb(${RGB[kind] ?? RGB.changed})`;
const ring = kind => `rgb(${RGB[kind] ?? RGB.changed} / .13)`;
const ENTER = 'cubic-bezier(.22,1,.36,1)';
const ENTER_MS = 200;
const EXIT_MS = 160; // about 20% faster than the enter
const FONT_UI = "system-ui,-apple-system,'Segoe UI',sans-serif";
const FONT_MONO = "ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace";
const CARD_WIDTH = 196;
const CARD_GAP = 14;
const CARD_ROOM = 220; // room needed beside a region before the card flips or drops

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export const scrollBehavior = () => (reducedMotion() ? 'instant' : 'smooth');

// `all: initial` first, so nothing in the prototype's own CSS leaks into the overlay.
const reset = 'all:initial;box-sizing:border-box;color:inherit;font:inherit;';

function make(doc, tag, css) {
  const element = doc.createElement(tag);
  element.style.cssText = reset + css;
  return element;
}

function leave(element) {
  delete element.dataset.key;
  delete element.dataset.change;
  delete element.dataset.afterimageCard;
  element.inert = true;
  if (reducedMotion()) { element.remove(); return; }
  const from = Number(element.ownerDocument.defaultView.getComputedStyle(element).opacity);
  const exit = element.animate([{ opacity: Number.isNaN(from) ? 1 : from }, { opacity: 0 }], { duration: EXIT_MS, easing: 'ease-out' });
  exit.onfinish = () => element.remove();
}

export function clearOverlay(doc) {
  const overlay = doc?.querySelector?.('[data-afterimage-overlay]');
  if (!overlay) return;
  delete overlay.dataset.afterimageOverlay;
  overlay.inert = true;
  if (reducedMotion()) { overlay.remove(); return; }
  const exit = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: 'ease-out' });
  exit.onfinish = () => overlay.remove();
}

function ensureOverlay(doc) {
  let overlay = doc.querySelector('[data-afterimage-overlay]');
  if (!overlay) {
    overlay = make(doc, 'div', '');
    overlay.dataset.afterimageOverlay = '';
    overlay.style.cssText = reset + 'display:block;position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646;';
    // Outside <body>, so the review's capture never sees it.
    doc.documentElement.append(overlay);
  }
  return overlay;
}

// A region's box in page coordinates, kept far enough from the edges for its outline to show.
function boxFor(region, clientWidth) {
  const edge = 5;
  const { x, y, width, height } = region.rect;
  const left = Math.max(x, edge);
  const right = Math.min(x + width, clientWidth - edge);
  const top = Math.max(y, edge);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, height - (top - y)) };
}

// `zoom` undoes a scale the frame is shown at (side by side shows it at about half size), so outlines,
// badges and the card keep their on-screen size and the card's text stays readable.
function paintBox(doc, overlay, region, { number, active, dimmed, onPick, isNew, zoom }) {
  const reduced = reducedMotion();
  const page = Boolean(region.page);
  const box = overlay.querySelector(`:scope > [data-change][data-key="${CSS.escape(region.key)}"]`) ?? make(doc, 'div', '');
  box.dataset.change = region.kind;
  box.dataset.key = region.key;
  const geometry = page
    ? 'position:fixed;left:6px;top:6px;right:6px;bottom:6px;outline-offset:0;'
    : (({ left, top, width, height }) => `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;outline-offset:${3 * zoom}px;`)(boxFor(region, doc.documentElement.clientWidth));
  const lineWidth = (active ? 2 : 1.5) * zoom;
  box.style.cssText = reset
    + `display:block;${geometry}border-radius:${4 * zoom}px;pointer-events:none;`
    + `outline:${lineWidth}px ${region.kind === 'removed' ? 'dashed' : 'solid'} ${color(region.kind)};`
    + `box-shadow:${active ? `0 0 0 ${6 * zoom}px ${ring(region.kind)}` : '0 0 0 0 transparent'};`
    + `opacity:${dimmed ? '.5' : '1'};`
    + (reduced ? '' : 'transition:opacity 160ms ease-out,box-shadow 160ms ease-out,outline-width 160ms ease-out;');

  let badge = box.querySelector(':scope > button');
  if (!badge) { badge = make(doc, 'button', ''); box.append(badge); }
  badge.type = 'button';
  badge.textContent = number ?? '';
  badge.setAttribute('aria-label', `Change ${number}`);
  const insideLeft = !page && region.rect.x < 12;
  const insideTop = !page && region.rect.y < 12;
  const badgeLeft = page || insideLeft ? 2 : -10;
  const badgeTop = page || insideTop ? 2 : -10;
  badge.style.cssText = reset
    + `display:block;position:absolute;left:${badgeLeft}px;top:${badgeTop}px;`
    // Scaled about the point where it meets the region's corner, so it keeps straddling that corner.
    + `scale:${zoom};transform-origin:${-badgeLeft}px ${-badgeTop}px;`
    + 'min-width:18px;height:18px;padding:0 3px;border-radius:5px;text-align:center;'
    + `background:${color(region.kind)};color:#1b1b1b;font:600 12px/18px ${FONT_MONO};font-variant-numeric:tabular-nums;`
    + 'cursor:pointer;pointer-events:auto;';
  badge.onclick = event => { event.stopPropagation(); onPick?.(region.key); };

  if (!box.isConnected) {
    overlay.append(box);
    if (!reduced && isNew) box.animate([{ opacity: 0 }, { opacity: dimmed ? 0.5 : 1 }], { duration: ENTER_MS, easing: ENTER });
  }
  return box;
}

// Anchored at both ends, and with nothing that could close the declaration, so a value can't smuggle CSS in.
const looksLikeColor = value => /^(?:(?:rgba?|hsla?|oklch|oklab|color)\([^;{}()]*\)|#[0-9a-f]{3,8})$/i.test(String(value).trim());

function valueCell(doc, text, { swatch, muted, strike }) {
  const cell = make(doc, 'div', `display:flex;align-items:baseline;gap:6px;min-width:0;color:${muted ? '#8e8e8e' : '#ededed'};${strike ? 'text-decoration:line-through;' : ''}font:12px/1.35 ${FONT_UI};`);
  if (swatch) {
    const chip = make(doc, 'span', 'display:block;flex:none;width:10px;height:10px;border-radius:3px;box-shadow:inset 0 0 0 1px #ffffff2e;align-self:center;');
    chip.style.background = String(text).trim(); // a property set, not cssText: an odd value is just ignored
    cell.append(chip);
  }
  const label = make(doc, 'span', `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-width:0;overflow-wrap:anywhere;${swatch ? `font-family:${FONT_MONO};font-size:12px;` : ''}`);
  label.textContent = text;
  cell.append(label);
  return cell;
}

function fillCard(doc, card, spec) {
  card.replaceChildren();
  const { kindLabel, position } = spec;
  const head = make(doc, 'div', `display:block;color:#8e8e8e;font:12px/1.35 ${FONT_UI};margin-bottom:6px;`);
  head.append(doc.createTextNode(`${kindLabel} · `));
  const mono = text => { const span = make(doc, 'span', `font:12px/1.35 ${FONT_MONO};font-variant-numeric:tabular-nums;`); span.textContent = text; return span; };
  head.append(mono(position.n), doc.createTextNode(' of '), mono(position.total));
  card.append(head);

  const details = (Array.isArray(spec.detail) ? spec.detail : [spec.detail]).filter(Boolean).slice(0, 3);
  const several = details.length > 1;
  for (const detail of details) {
    const group = make(doc, 'div', 'display:block;margin-top:6px;');
    if (several || detail.label) {
      const title = make(doc, 'div', `display:block;color:#ededed;font:600 12px/1.35 ${FONT_UI};margin-bottom:2px;`);
      title.textContent = detail.label;
      group.append(title);
    }
    const grid = make(doc, 'div', 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 8px;');
    const swatch = value => Boolean(detail.color) && looksLikeColor(value);
    const row = (name, value, options) => {
      const key = make(doc, 'span', `display:block;color:#8e8e8e;font:12px/1.35 ${FONT_UI};`);
      key.textContent = name;
      grid.append(key, valueCell(doc, value, { swatch: swatch(value), ...options }));
    };
    if (detail.before) row('was', detail.before, { muted: true, strike: Boolean(detail.after) });
    if (detail.after) row('now', detail.after, {});
    group.append(grid);
    card.append(group);
  }
}

function placeCard(doc, card, region, zoom, bounds) {
  if (region.page) {
    // Top right, unless only the left part of this frame shows (Before, in the wipe): then top left.
    const leftSide = bounds && bounds.max < doc.documentElement.clientWidth;
    card.style.cssText += leftSide
      ? `;position:fixed;left:${16 * zoom}px;top:${16 * zoom}px;right:auto;`
      : `;position:fixed;right:${16 * zoom}px;top:${16 * zoom}px;left:auto;transform-origin:100% 0;`;
    return;
  }
  const root = doc.documentElement;
  const { left, top } = cardPlacement({
    rect: region.rect,
    cardWidth: CARD_WIDTH * zoom,
    cardHeight: card.offsetHeight * zoom,
    gap: CARD_GAP * zoom,
    room: CARD_ROOM * zoom,
    edge: 8 * zoom,
    below: 10 * zoom,
    clientWidth: root.clientWidth,
    docHeight: Math.max(root.scrollHeight, doc.defaultView.innerHeight),
    viewHeight: doc.defaultView.innerHeight,
    zoom,
    bounds,
  });
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

// Where the card goes, in page coordinates: beside the region if there is room, else below or above it.
// `bounds` ({ min, max } page x) is the part of the page the reader sees: in the wipe, the frame's own side of
// the divider, so the card never straddles it or sits under the other layer. Pure, for node:test.
export function cardPlacement({ rect, cardWidth, cardHeight, gap, room, edge, below, clientWidth, docHeight, viewHeight, zoom = 1, bounds = null }) {
  const { x, y, width, height } = rect;
  const lo = Math.max(0, bounds?.min ?? 0);
  const hi = Math.min(clientWidth, bounds?.max ?? clientWidth);
  const clampTop = value => Math.max(edge, Math.min(value, docHeight - cardHeight - edge));
  const clampLeft = value => Math.max(lo + edge, Math.min(value, hi - cardWidth - edge));
  // Center on the part of the region the reader actually sees.
  const centerY = y + Math.min(height, viewHeight - 48) / 2;

  if (hi - (x + width) >= room) return { left: x + width + gap, top: clampTop(centerY - cardHeight / 2) };
  if (x - lo >= room) return { left: x - gap - cardWidth, top: clampTop(centerY - cardHeight / 2) };
  if (y + height + below + cardHeight <= docHeight - edge) return { left: clampLeft(x), top: y + height + below };
  if (y - below - cardHeight >= edge) return { left: clampLeft(x), top: y - below - cardHeight };
  return { left: clampLeft(x + 12 * zoom), top: clampTop(y + 12 * zoom) };
}

function paintCard(doc, overlay, spec, region, zoom) {
  const live = [...overlay.querySelectorAll(':scope > [data-afterimage-card]')].filter(card => !card.inert);
  const current = spec && live.find(card => card.dataset.afterimageCard === spec.key);
  for (const stale of live) if (stale !== current) leave(stale);
  if (!spec || !region) return;

  const isNew = !current;
  const card = current ?? make(doc, 'div', '');
  card.dataset.afterimageCard = spec.key;
  card.style.cssText = reset
    + `display:block;position:absolute;left:0;top:0;width:${CARD_WIDTH}px;padding:9px 11px;border-radius:10px;`
    + 'background:#1b1b1b;color:#ededed;pointer-events:none;'
    + 'box-shadow:0 0 0 1px #ffffff14,0 1px 2px #0003,0 8px 24px #0006;'
    + `scale:${zoom};transform-origin:0 0;`;
  fillCard(doc, card, spec);
  if (!card.isConnected) overlay.append(card);
  placeCard(doc, card, region, zoom, spec.bounds ?? null);
  if (isNew && !reducedMotion()) {
    card.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: ENTER_MS, easing: ENTER });
  }
}

// Whether a click in the prototype should drop the selected change. Rects and the point are in the frame's
// client coordinates. The region (null for a page-wide change) and the card keep it, with `slop` around the
// region for its outline; so do drags (selecting text) and clicks past the viewport (its scrollbars).
export function clickClearsSelection({ x, y, moved, viewport, region, card, slop }) {
  if (moved > 4 || x >= viewport.width || y >= viewport.height) return false;
  const inside = (rect, pad) => rect && x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
  return !inside(region, slop) && !inside(card, 0);
}

// Calls `onClear` when a click in `doc` lands outside the selection drawn for `activeKey`. Capture phase, so a
// prototype that stops its clicks still deselects; the click itself goes through untouched. Returns unbind().
export function bindClearOnClick(doc, activeKey, onClear, zoom = 1) {
  const win = doc?.defaultView;
  if (!win) return () => {};
  let down = null;
  const onDown = event => { down = { x: event.clientX, y: event.clientY }; };
  const onClick = event => {
    const from = down;
    down = null;
    // Enter or Space on a control in the prototype also fires a click, with no pointer (detail 0) and no real
    // position. That is using the prototype, not clicking away from the change.
    if (event.detail === 0) return;
    const overlay = doc.querySelector('[data-afterimage-overlay]');
    if (!overlay || overlay.contains(event.target)) return; // a badge picks its own change
    const box = overlay.querySelector(`:scope > [data-change][data-key="${CSS.escape(activeKey)}"]`);
    const card = overlay.querySelector(`:scope > [data-afterimage-card="${CSS.escape(activeKey)}"]`);
    // A page-wide change outlines the whole viewport, so only its card counts as inside.
    const pageWide = box?.style.position === 'fixed';
    const moved = from ? Math.hypot(event.clientX - from.x, event.clientY - from.y) : 0;
    if (clickClearsSelection({
      x: event.clientX, y: event.clientY, moved,
      viewport: { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight },
      region: box && !pageWide ? box.getBoundingClientRect() : null,
      card: card?.getBoundingClientRect() ?? null,
      slop: 8 * zoom,
    })) onClear();
  };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('click', onClick, true);
  return () => {
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('click', onClick, true);
  };
}

// regions: [{ key, kind: 'changed' | 'added' | 'removed', rect: { x, y, width, height }, page? }]
// numbers: Map<key, number>. card: { key, kindLabel, position: { n, total }, detail: [{ label, before, after, color? }] } | null
// zoom: 1 / the scale the frame is shown at (1 unless the frame is scaled down, as side by side does).
export function drawOverlay(doc, regions, { activeKey = null, numbers = new Map(), onPick, card = null, zoom = 1 } = {}) {
  if (!doc?.documentElement || !regions.length) { clearOverlay(doc); return; }
  const overlay = ensureOverlay(doc);
  const present = new Set();
  const known = new Set([...overlay.querySelectorAll(':scope > [data-change]')].map(box => box.dataset.key));
  for (const region of regions) {
    present.add(region.key);
    paintBox(doc, overlay, region, {
      number: numbers.get(region.key),
      active: activeKey === region.key,
      dimmed: activeKey !== null && activeKey !== region.key,
      onPick,
      isNew: !known.has(region.key),
      zoom,
    });
  }
  for (const box of [...overlay.querySelectorAll(':scope > [data-change]')]) {
    if (!present.has(box.dataset.key)) leave(box);
  }
  paintCard(doc, overlay, card, card && regions.find(region => region.key === card.key), zoom);
}
