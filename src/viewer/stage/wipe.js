// Wipe geometry. Pure: no React, no DOM.
// In the wipe the Before frame shows left of the divider and the After frame right of it. A removed region only
// exists on Before, so it shows only left of the divider; an added one only on After, so only right of it. A
// changed region is on both, so it always shows on one side or the other.

const MIN = 5;
const MAX = 95;
const MARGIN_PX = 16; // "just past the region": far enough that its outline clears the divider line
const clamp = value => Math.min(MAX, Math.max(MIN, value));

// Where the divider should go (percent of the stage showing Before) so a stepped-to or picked region is on its
// own side. Returns `wipe` unchanged when the region's centre is already visible.
//   rect: the region in its frame's page coordinates; width: the stage width (the frame's viewport in the wipe).
export function wipeToShow({ wipe, kind, rect, width, scrollX = 0 }) {
  if (!(width > 0) || !rect) return wipe;
  const x = rect.x - scrollX;
  const centre = ((x + rect.width / 2) / width) * 100;
  const margin = (MARGIN_PX / width) * 100;
  if (kind === 'removed' && centre > wipe) return clamp(((x + rect.width) / width) * 100 + margin);
  if (kind === 'added' && centre < wipe) return clamp((x / width) * 100 - margin);
  return wipe;
}

// The horizontal part of a frame's page the reader can see, in page pixels, so the change card can stay inside
// it. null when the whole frame shows (explore, holding B, side by side at Fit). Side by side zoomed in, it is the
// slice `visible` wide starting at `pan` (see zoom.js).
export function visibleRange({ layout, wipe, width, onBase, peek = false, scrollX = 0, pan = 0, visible = width }) {
  if (layout === 'side') return width > 0 && visible < width ? { min: pan, max: pan + visible } : null;
  if (layout !== 'wipe' || peek || !(width > 0)) return null;
  const at = (wipe / 100) * width + scrollX;
  return onBase ? { min: scrollX, max: at } : { min: at, max: scrollX + width };
}
