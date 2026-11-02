import { useEffect, useState } from 'react';
import { captureDocument } from '../../engine/capture.js';
import { buildReview } from '../../engine/diff-records.js';
import { acceptResult, createDebounce, createReviewTimer, reviewKey, reviewSignature, summarize } from '../../engine/review.js';
import { writeCount } from '../../engine/review-cache.js';
import { frameWindow, quietly, showsVersion } from '../frames.js';

const DEBOUNCE_MS = 80;
const MAX_WAIT_MS = 500; // a page that never stops mutating (a JS animation) is still checked twice a second
const EMPTY_SUMMARY = { total: 0, changed: 0, added: 0, removed: 0 };
const IDLE = { status: 'idle', entries: [], comparison: null, summary: EMPTY_SUMMARY, signature: '' };

// Mutations inside the highlight overlay come from us, not from the prototype.
function fromOverlay(records) {
  return records.every(({ target }) => (target.nodeType === 1 ? target : target.parentElement)?.closest('[data-afterimage-overlay]'));
}

// Live review of `target` against `base`. The frames are React refs to the two iframes.
export function useReview({ targetFrame, baseFrame, target, base, enabled }) {
  const [state, setState] = useState(IDLE);
  // Read during render so a frame that mounts or is replaced re-runs the effect on the next render.
  const targetEl = targetFrame.current, baseEl = baseFrame.current;
  const targetSha = target?.sha256, baseSha = base?.sha256, targetFile = target?.file, baseFile = base?.file;

  useEffect(() => {
    if (!enabled || !target || !base) {
      setState(IDLE);
      return undefined;
    }
    setState({ ...IDLE, status: 'checking' });
    // A frame that isn't mounted yet is not a failure. The state update above re-renders the host,
    // which re-reads the refs; once both frames exist the effect runs again and starts the timer.
    if (!targetEl || !baseEl) return undefined;

    let alive = true;
    let revision = 0;
    let latest = null;
    let teardown = [];
    const timer = createReviewTimer({ onTimeout: () => { if (alive) setState(current => (current.status === 'ready' ? current : { ...IDLE, status: 'failed' })); } });
    const debounce = createDebounce(() => run(), { waitMs: DEBOUNCE_MS, maxWaitMs: MAX_WAIT_MS });
    const schedule = () => debounce.schedule();

    const frames = () => [targetFrame.current, baseFrame.current];
    // Both on their version, and on one route: while the base is still following the target to another route of a
    // hash-routed app, the two pages differ everywhere, and that is not a change. Its hashchange schedules the next run.
    const sameRoute = () => frameWindow(targetFrame.current)?.location.hash === frameWindow(baseFrame.current)?.location.hash;
    const loaded = () => showsVersion(targetFrame.current, target) && showsVersion(baseFrame.current, base) && sameRoute();
    // null once the target frame isn't ours to read any more, so a result for it is never accepted.
    const currentKey = () => {
      const win = frameWindow(targetFrame.current);
      return win ? reviewKey({ target, base, width: win.innerWidth, height: win.innerHeight, route: win.location.hash }) : null;
    };

    // The honest state when a frame shows something other than its version (it navigated away, maybe to
    // another origin): nothing can be compared until it comes back.
    function fail() {
      timer.cancel();
      debounce.cancel();
      latest = null;
      setState({ ...IDLE, status: 'failed' });
    }

    async function run() {
      const [targetEl, baseEl] = frames();
      if (!alive || !loaded()) return;
      const token = ++revision;
      try {
        const keyAtStart = currentKey();
        await Promise.all([targetEl.contentDocument.fonts.ready, baseEl.contentDocument.fonts.ready]);
        // Another run started, the inputs changed, or a frame navigated while fonts loaded.
        if (!alive || token !== revision || !loaded()) return;
        const targetRecords = captureDocument(targetEl.contentDocument);
        // Capture the base with the target's scrollbar gutter, so a scrollbar's width isn't reported as a layout
        // edit. The override only lives for the capture; the base stays scrollable for peek and compare.
        const baseRoot = baseEl.contentDocument.documentElement;
        const previousOverflow = baseRoot.style.overflowY;
        let baseRecords;
        try {
          baseRoot.style.overflowY = targetEl.clientWidth > targetEl.contentDocument.documentElement.clientWidth ? 'scroll' : 'hidden';
          baseRecords = captureDocument(baseEl.contentDocument);
        } finally {
          baseRoot.style.overflowY = previousOverflow;
        }
        const result = buildReview(targetRecords, baseRecords);
        const keyNow = currentKey();
        if (keyNow === null || !acceptResult(keyNow, keyAtStart)) { schedule(); return; }
        const summary = summarize(result.entries);
        const signature = reviewSignature(result);
        timer.done();
        writeCount(keyAtStart, summary);
        if (signature === latest) return;
        latest = signature;
        setState({ status: 'ready', entries: result.entries, comparison: result.comparison, summary, signature });
      } catch (error) {
        if (!alive) return;
        timer.cancel();
        latest = null; // so a later successful run with the same result still reaches 'ready'
        console.error('Change comparison failed.', error);
        setState({ ...IDLE, status: 'failed' });
      }
    }

    // Documents are replaced when an iframe navigates, so observers are re-attached on every load. A window
    // that turned cross-origin is skipped, and its old listeners are let go of quietly.
    function attach() {
      teardown.forEach(stop => stop());
      teardown = [];
      for (const frame of frames()) {
        const win = frameWindow(frame);
        const body = win?.document.body;
        if (!win || !body) continue;
        const observer = new MutationObserver(records => { if (!fromOverlay(records)) schedule(); });
        observer.observe(body, { attributes: true, childList: true, subtree: true, characterData: true });
        win.addEventListener('resize', schedule);
        teardown.push(() => { observer.disconnect(); quietly(() => win.removeEventListener('resize', schedule)); });
      }
    }

    const onLoad = event => {
      attach();
      const frame = event?.currentTarget;
      const version = frame === targetFrame.current ? target : base;
      if (frame && !showsVersion(frame, version)) { fail(); return; }
      schedule();
    };
    const elements = frames().filter(Boolean);
    for (const frame of elements) frame.addEventListener('load', onLoad);

    timer.start();
    attach();
    schedule();

    return () => {
      alive = false;
      debounce.cancel();
      timer.cancel();
      teardown.forEach(stop => stop());
      for (const frame of elements) frame.removeEventListener('load', onLoad);
    };
  }, [targetFrame, baseFrame, targetEl, baseEl, targetSha, baseSha, targetFile, baseFile, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status, entries, comparison, summary } = state;
  return { status, entries, comparison, summary };
}
