// Side by side zoom. Pure: no React, no DOM.
// Each page keeps its real layout (the full stage width); zooming only changes how large its column shows it.
// Past Fit a column shows a slice of the page, and `pan` is where that slice starts, in page pixels. Both
// columns share one pan, so they always show the same slice.

export const ZOOMS = ['fit', '75', '100'];
const MARGIN_PX = 24;

// The scale a column shows its page at. Fit fits the whole width; a level below Fit would leave empty space,
// so it shows at Fit instead.
export function sideScale(zoom, fit) {
  return zoom === 'fit' ? fit : Math.max(fit, Number(zoom) / 100);
}

export function clampPan(pan, width, visible) {
  return Math.min(Math.max(0, width - visible), Math.max(0, pan));
}

// The pan after zooming from scale `from` to `to`, so the page point `anchor` stays where it was in the column.
export function panForZoom({ pan, anchor, from, to, width, column }) {
  const onScreen = (anchor - pan) * from;
  return clampPan(anchor - onScreen / to, width, column / to);
}

// The pan that brings `rect` (page pixels) into a slice `visible` wide: unchanged when it already shows,
// otherwise centred on it, or from its left edge when it is wider than the slice.
export function panToShow({ pan, rect, width, visible }) {
  if (rect.x >= pan && rect.x + rect.width <= pan + visible) return pan;
  const goal = rect.width + MARGIN_PX * 2 > visible ? rect.x - MARGIN_PX : rect.x + rect.width / 2 - visible / 2;
  return clampPan(goal, width, visible);
}

// One level in (+1) or out (-1), stopping at either end.
export function stepZoom(zoom, direction) {
  const index = Math.max(0, ZOOMS.indexOf(zoom));
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + direction))];
}
