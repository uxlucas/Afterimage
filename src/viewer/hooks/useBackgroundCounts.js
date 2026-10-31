import { useEffect, useMemo, useRef, useState } from 'react';
import { captureDocument } from '../../engine/capture.js';
import { buildReview } from '../../engine/diff-records.js';
import { summarize } from '../../engine/review.js';
import { readCount } from '../../engine/review-cache.js';
import { createQueue } from '../../engine/background-queue.js';
import { showsVersion } from '../frames.js';

const LOAD_TIMEOUT_MS = 10000;
const SETTLE_MS = 80; // same pause the live review takes after a load, for scripts that touch the page on start

// Pair = { key, target, base, width, height }: key is reviewKey of the two versions at that viewport size.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Captures are synchronous and can take a while on a big page, so start one when the visitor isn't busy.
const idle = () => new Promise(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 600 });
  else setTimeout(resolve, 0);
});

// A same-origin iframe off screen. It stays laid out (not display:none) so capture reads real boxes.
function makeSlot() {
  const frame = document.createElement('iframe');
  frame.title = 'Background change count';
  frame.tabIndex = -1;
  frame.inert = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.afterimageBackground = '';
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;border:0;pointer-events:none;';
  document.body.append(frame);
  return { frame, id: null };
}

function load(slot, version) {
  if (slot.id === version.id && showsVersion(slot.frame, version)) return Promise.resolve();
  slot.id = null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`${version.id} did not load in time.`)); }, LOAD_TIMEOUT_MS);
    // Only the load of this version's page counts: a late load from the slot's previous page is not it.
    const onLoad = () => {
      if (!showsVersion(slot.frame, version)) return;
      stop();
      slot.id = version.id;
      resolve();
    };
    const stop = () => { clearTimeout(timer); slot.frame.removeEventListener('load', onLoad); };
    slot.frame.addEventListener('load', onLoad);
    slot.frame.src = new URL(version.file, location.href).href;
  });
}

// Two frames do every comparison. Neighbouring rows share a version (v59 is the base of v60 and the
// target of v59), so the frame that already holds one side is reused and only the other side loads.
async function compare(slots, pair) {
  const { target, base, width, height } = pair;
  let targetSlot = slots.find(slot => slot.id === target.id) ?? null;
  let baseSlot = slots.find(slot => slot !== targetSlot && slot.id === base.id) ?? null;
  targetSlot ??= slots.find(slot => slot !== baseSlot);
  baseSlot ??= slots.find(slot => slot !== targetSlot);
  for (const slot of slots) {
    slot.frame.style.width = `${width}px`;
    slot.frame.style.height = `${height}px`;
  }
  await Promise.all([load(targetSlot, target), load(baseSlot, base)]);
  const targetDoc = targetSlot.frame.contentDocument;
  const baseDoc = baseSlot.frame.contentDocument;
  await Promise.all([targetDoc.fonts.ready, baseDoc.fonts.ready]);
  await wait(SETTLE_MS);
  await idle();
  if (targetSlot.id !== target.id || baseSlot.id !== base.id) throw new Error('A background frame navigated mid-comparison.');

  const targetRecords = captureDocument(targetDoc);
  // Same scrollbar-gutter match as the live review, so a scrollbar isn't counted as a layout change.
  const baseRoot = baseDoc.documentElement;
  const previousOverflow = baseRoot.style.overflowY;
  let baseRecords;
  try {
    baseRoot.style.overflowY = targetSlot.frame.clientWidth > targetDoc.documentElement.clientWidth ? 'scroll' : 'hidden';
    baseRecords = captureDocument(baseDoc);
  } finally {
    baseRoot.style.overflowY = previousOverflow;
  }
  return summarize(buildReview(targetRecords, baseRecords).entries);
}

// Change counts for the version rows in view, worked out in the background one pair at a time and cached
// by the pair's hashes and the viewport size. Returns Map<versionId, Summary> of every count known so far.
export function useBackgroundCounts(pairsInView) {
  const [known, setKnown] = useState(() => new Map()); // versionId -> { key, summary }
  const queueRef = useRef(null);
  const sizeRef = useRef(null);

  useEffect(() => {
    let slots = null; // made on first use, so a list that is fully cached never loads a frame
    let alive = true;
    const queue = createQueue({
      run: pair => {
        slots ??= [makeSlot(), makeSlot()];
        return compare(slots, pair);
      },
      onResult: (pair, summary) => {
        // A count for a size the window has left would sit under the wrong numbers (it is still cached).
        if (!alive || `${pair.width}x${pair.height}` !== sizeRef.current) return;
        setKnown(current => new Map(current).set(pair.target.id, { key: pair.key, summary }));
      },
    });
    queueRef.current = queue;
    return () => {
      alive = false;
      queue.cancel();
      slots?.forEach(slot => slot.frame.remove());
      queueRef.current = null;
    };
  }, []);

  const signature = pairsInView.map(pair => pair.key).join(',');
  useEffect(() => {
    // Nothing in view: drop the wish list, so rows that scrolled away don't keep frames busy.
    if (!pairsInView.length) { queueRef.current?.want([]); return; }
    // Counts depend on the viewport, so a new size starts over (cached counts for that size come back at once).
    const size = `${pairsInView[0].width}x${pairsInView[0].height}`;
    const resized = sizeRef.current !== null && sizeRef.current !== size;
    sizeRef.current = size;

    const cached = [];
    for (const pair of pairsInView) {
      const summary = readCount(pair.key);
      if (summary) cached.push([pair.target.id, { key: pair.key, summary }]);
    }
    if (resized || cached.length) {
      setKnown(current => {
        const next = resized ? new Map() : new Map(current);
        let changed = resized;
        for (const [id, entry] of cached) {
          if (next.get(id)?.key === entry.key) continue;
          next.set(id, entry);
          changed = true;
        }
        return changed ? next : current;
      });
    }
    queueRef.current?.want(pairsInView);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => new Map([...known].map(([id, { summary }]) => [id, summary])), [known]);
}
