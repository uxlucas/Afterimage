import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { filterEntries } from '../../engine/review.js';
import { comparisonBase } from '../state/model.js';
import { useTransitions } from '../motion.js';
import Frame from './Frame.jsx';
import Divider from './Divider.jsx';
import { CompareLabel, PanBar, SideTools } from './CompareChrome.jsx';
import { clampPan, panForZoom, panToShow, sideScale, stepZoom } from './zoom.js';
import { linkScroll } from './scrollSync.js';
import { bindClearOnClick, clearOverlay, drawOverlay, scrollBehavior } from './overlay.js';
import { visibleRange, wipeToShow } from './wipe.js';
import { frameWindow, quietly, showsVersion as shows } from '../frames.js';
import './stage.css';

const PAD = 10; // side by side: around the columns
const GAP = 10; // and between them
const SYNC_STRIP = 38; // side by side: the strip above the columns that holds the zoom and Scroll synced controls
const PAN_BAR_LIFT = 9; // zoomed in, each column's pan bar sits in that strip, just above the column
const LABEL_INSET = 12;
const INSTANT = { duration: 0 };

// Details worth a line on the card: content and appearance first, position and size only if that is all there is.
function cardDetails(entry) {
  const content = entry.details.filter(detail => !detail.layout);
  return (content.length ? content : entry.details).slice(0, 3);
}

// clientHeight rather than innerHeight, so a horizontal scrollbar doesn't count as page to scroll.
function scrollRatio(win) {
  const root = win.document.scrollingElement ?? win.document.documentElement;
  const max = root.scrollHeight - win.document.documentElement.clientHeight;
  return max > 0 ? win.scrollY / max : 0;
}

// Put `win` at the same relative scroll position as `from`.
function alignScroll(win, from) {
  const root = win.document.scrollingElement ?? win.document.documentElement;
  const max = Math.max(0, root.scrollHeight - win.document.documentElement.clientHeight);
  win.scrollTo({ top: scrollRatio(from) * max, behavior: 'instant' });
}

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(current => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Where each frame sits. A frame's viewport is always the full stage width, so the prototype lays out at its
// real width. Side by side puts each frame in a column (`col`, which clips it) and scales it to the zoom level:
// at Fit the whole width shows; zoomed in, the column shows the slice that starts `pan` page pixels in. Either way
// the frame gets a taller viewport, so the column fills. `top` is how far down the columns start, leaving room
// for the chrome above them.
function geometry(layout, { width, height }, top, zoom, pan) {
  const col = { x: 0, y: 0, width: width || '100%', height: height || '100%', borderRadius: 0 };
  const box = { x: 0, scale: 1, height: height || '100%' };
  if (layout !== 'side' || !(width > 0)) {
    return { base: { col, box }, target: { col, box }, column: 0, fit: 1, scale: 1, visible: width };
  }
  const column = (width - PAD * 2 - GAP) / 2;
  const fit = column / width;
  const scale = sideScale(zoom, fit);
  const visible = column / scale;
  const shownPan = clampPan(pan, width, visible);
  const colHeight = height - top - PAD;
  const side = x => ({
    col: { x, y: top, width: column, height: colHeight, borderRadius: 8 },
    box: { x: -shownPan * scale, scale, height: colHeight / scale },
  });
  return { base: side(PAD), target: side(PAD + column + GAP), column, fit, scale, visible, pan: shownPan };
}

export default function Stage({ state, dispatch, versions, review, targetRef, baseRef, phone }) {
  const reduced = useReducedMotion();
  const t = useTransitions();
  const stageRef = useRef(null);
  const size = useSize(stageRef);
  const target = versions.find(version => version.id === state.versionId) ?? versions[0];
  const base = comparisonBase(versions, state);
  const { comparison, status } = review;

  const filtered = useMemo(() => filterEntries(review.entries, state.changeFilter), [review.entries, state.changeFilter]);
  // With the pill put away the page shows as built: no outlines, until the pill comes back.
  const ready = state.highlights && !state.retracted && status === 'ready' && comparison !== null;
  const active = ready && state.changeIndex !== null ? filtered[state.changeIndex] ?? null : null;
  const removedActive = active?.kind === 'removed';
  const compare = state.mode === 'compare' && Boolean(base);
  // Explore shows the base only in place of the target (peek, a removed change). Compare always shows it.
  const showBase = Boolean(base) && (compare || state.peek || removedActive);
  const peekInPlace = !compare && showBase;
  // A phone only has room for the wipe.
  const layout = compare ? (phone ? 'wipe' : state.layout) : 'single';
  // Side by side keeps a strip above the columns for its controls, so they never cover the prototype.
  // Both columns share one pan (page pixels): they always show the same slice of their pages.
  const [pan, setPan] = useState(0);
  const boxes = geometry(layout, size, SYNC_STRIP, state.zoom, pan);
  const zoomed = layout === 'side' && boxes.visible < size.width;
  // Highlights inside a scaled-down frame are drawn this much larger, so they read at their usual size.
  const zoom = 1 / boxes.scale;

  // Frames glide between layouts and zoom levels, and when they pan to show a change. Anything else that moves
  // them (a window resize, panning by hand) applies at once.
  const shownLayout = useRef(layout);
  const shownZoom = useRef(state.zoom);
  const switching = shownLayout.current !== layout;
  const glidePan = useRef(false);
  const gliding = switching || (layout === 'side' && shownZoom.current !== state.zoom) || glidePan.current;
  useEffect(() => { shownLayout.current = layout; shownZoom.current = state.zoom; glidePan.current = false; });
  const boxTransition = gliding ? t.layout : INSTANT;

  // What the wheel and the pan bars need, current at the moment they fire.
  const live = useRef(null);
  live.current = { zoom: state.zoom, fit: boxes.fit, scale: boxes.scale, pan: boxes.pan ?? 0, width: size.width, column: boxes.column, visible: boxes.visible, zoomed };
  const zoomTo = useCallback((next, anchor) => {
    const now = live.current;
    if (next === now.zoom || !(now.width > 0)) return;
    const to = sideScale(next, now.fit);
    // The buttons hold the middle of the slice still, except from Fit, where a page is read from its left edge.
    const held = anchor ?? (now.zoom === 'fit' ? 0 : now.pan + now.visible / 2);
    setPan(panForZoom({ pan: now.pan, anchor: held, from: now.scale, to, width: now.width, column: now.column }));
    dispatch({ type: 'setZoom', zoom: next });
  }, [dispatch]);
  const panBy = useCallback(delta => {
    const now = live.current;
    if (!now.zoomed) return;
    setPan(current => clampPan(clampPan(current, now.width, now.visible) + delta, now.width, now.visible));
  }, []);

  // The wipe: how much of the stage, in percent, shows Before. Holding B (peek) shows all of it; side by side
  // and explore don't clip at all.
  const [wipe, setWipe] = useState(50);
  const [dragging, setDragging] = useState(false);
  const split = useMotionValue(layout === 'wipe' ? wipe : 100);
  const clipPath = useTransform(split, value => `inset(0 ${100 - value}% 0 0)`);
  const splitGoal = layout === 'wipe' && !state.peek ? wipe : 100;
  const splitAnimation = useRef(null);
  const glideSplit = useRef(false); // set when the divider moves itself to show a change (Ruling 25)
  useLayoutEffect(() => {
    splitAnimation.current?.stop();
    const glide = (switching || glideSplit.current) && t.layout.duration > 0;
    glideSplit.current = false;
    if (glide) splitAnimation.current = animate(split, splitGoal, t.layout);
    else split.jump(splitGoal);
  }, [splitGoal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the card goes follows the divider once it is let go; while it is dragged the card holds still, so the
  // overlay isn't redrawn on every pointer move.
  const settledWipe = useRef(wipe);
  if (!dragging) settledWipe.current = wipe;
  const cardWipe = settledWipe.current;

  // The change card goes on the side that shows the change. A removed change is only on the base. In the wipe,
  // a changed region left of the divider is seen on the base, so its card goes there too.
  const activeRecord = active && comparison ? comparison.current.find(record => record.key === active.key) : null;
  // Regions are in page pixels and the divider is in stage pixels, so a page scrolled sideways shifts one
  // against the other. The wipe scrolls both frames together, so the target's scroll stands for both.
  const scrollX = layout === 'wipe' ? frameWindow(targetRef.current)?.scrollX ?? 0 : 0;
  const shownBefore = state.peek ? Infinity : (cardWipe / 100) * size.width + scrollX;
  const cardOnBase = removedActive || (layout === 'wipe' && active?.kind === 'changed' && Boolean(activeRecord)
    && activeRecord.rect.x + activeRecord.rect.width / 2 < shownBefore);
  // Zoomed in side by side, the card stays within the slice its column shows. It follows the pan once panning
  // pauses, so the overlay isn't redrawn on every wheel tick.
  const [cardPan, setCardPan] = useState(0);
  const shownPan = boxes.pan ?? 0;
  useEffect(() => {
    const timer = setTimeout(() => setCardPan(shownPan), 120);
    return () => clearTimeout(timer);
  }, [shownPan]);
  // and stays within that side, so it never straddles the divider (review-checks.md:62).
  const range = visibleRange({ layout, wipe: cardWipe, width: size.width, onBase: cardOnBase, peek: state.peek, scrollX, pan: cardPan, visible: boxes.visible });
  const boundsMin = range?.min ?? null;
  const boundsMax = range?.max ?? null;

  // A step or a pick that lands on a region hidden by the wipe moves the divider just past it, so the region
  // shows on its own side: removed on Before (left), added on After (right). Dragging never triggers it.
  const wipeNow = useRef(wipe);
  wipeNow.current = wipe;
  const movedFor = useRef(null);
  useEffect(() => {
    if (layout !== 'wipe' || !active || !comparison || dragging) return;
    const token = [target.id, base?.id, state.changeFilter, active.key, state.pick].join('|');
    if (movedFor.current === token) return;
    movedFor.current = token;
    const record = removedActive
      ? comparison.previous.find(item => item.key === active.key && item.kind === 'removed')
      : comparison.current.find(item => item.key === active.key);
    if (!record || record.page) return;
    const scrollX = frameWindow((removedActive ? baseRef : targetRef).current)?.scrollX ?? 0;
    const goal = wipeToShow({ wipe: wipeNow.current, kind: active.kind, rect: record.rect, width: size.width, scrollX });
    if (goal === wipeNow.current) return;
    glideSplit.current = true;
    setWipe(goal);
  }, [layout, active, comparison, dragging, target, base, removedActive, state.changeFilter, state.pick, size.width, baseRef, targetRef]);

  // Side by side zoomed in, a step or a pick that lands on a region outside the slice pans both columns to it.
  const pannedFor = useRef(null);
  useEffect(() => {
    if (!zoomed || !active || !comparison) return;
    const token = [target.id, base?.id, state.changeFilter, active.key, state.pick, state.zoom].join('|');
    if (pannedFor.current === token) return;
    pannedFor.current = token;
    const record = removedActive
      ? comparison.previous.find(item => item.key === active.key && item.kind === 'removed')
      : comparison.current.find(item => item.key === active.key);
    if (!record || record.page) return;
    const now = live.current;
    const goal = panToShow({ pan: now.pan, rect: record.rect, width: now.width, visible: now.visible });
    if (goal === now.pan) return;
    glidePan.current = true;
    setPan(goal);
  }, [zoomed, active, comparison, target, base, removedActive, state.changeFilter, state.pick, state.zoom]);

  // Side by side, the wheel over either prototype pans sideways (a trackpad's sideways swipe, or Shift + wheel)
  // and ctrl/⌘ + wheel (a trackpad pinch too) steps the zoom, holding the point under the pointer still.
  // Plain vertical scrolling is left to the page.
  const hasBaseFrame = Boolean(base);
  useEffect(() => {
    if (layout !== 'side') return undefined;
    const frames = [targetRef.current, baseRef.current].filter(Boolean);
    let pinch = 0;
    let pinchQuietUntil = 0;
    const onWheel = event => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? live.current.width : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault(); // otherwise the browser zooms the whole viewer
        const now = performance.now();
        if (now < pinchQuietUntil) return;
        pinch += event.deltaY * unit;
        if (Math.abs(pinch) < 40) return;
        const next = stepZoom(live.current.zoom, pinch < 0 ? 1 : -1);
        pinch = 0;
        pinchQuietUntil = now + 300; // one level per gesture, not one per tick
        zoomTo(next, event.clientX);
        return;
      }
      const sideways = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!live.current.zoomed || !sideways || (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))) return;
      event.preventDefault();
      panBy((sideways * unit) / live.current.scale);
    };
    const unbinds = new Map();
    const bind = frame => {
      unbinds.get(frame)?.();
      const win = frameWindow(frame);
      if (!win) { unbinds.set(frame, () => {}); return; }
      win.addEventListener('wheel', onWheel, { passive: false });
      unbinds.set(frame, () => win.removeEventListener('wheel', onWheel));
    };
    const onLoad = event => bind(event.currentTarget);
    for (const frame of frames) { bind(frame); frame.addEventListener('load', onLoad); }
    return () => {
      for (const frame of frames) frame.removeEventListener('load', onLoad);
      for (const unbind of unbinds.values()) quietly(unbind);
    };
  }, [layout, hasBaseFrame, zoomTo, panBy, targetRef, baseRef]);

  // Compare scrolls the two sides together: always in the wipe, by choice side by side.
  const linked = compare && (layout === 'wipe' || state.syncScroll);
  const hasBase = Boolean(base);
  useEffect(() => {
    if (!linked) return undefined;
    return linkScroll(targetRef.current, baseRef.current);
  }, [linked, hasBase, targetRef, baseRef]);

  // Highlights. Redrawn whenever the review, the selection or a frame's document changes.
  useEffect(() => {
    const frames = [[targetRef.current, target], [baseRef.current, base]];
    const keys = new Set(filtered.map(entry => entry.key));
    const numbers = new Map(filtered.map((entry, index) => [entry.key, index + 1]));
    const onPick = key => {
      const index = filtered.findIndex(entry => entry.key === key);
      if (index !== -1) dispatch({ type: 'selectChange', index });
    };
    const cardFor = holdsActive => {
      if (!active || !holdsActive) return null;
      return {
        key: active.key,
        kindLabel: active.kindLabel,
        position: { n: state.changeIndex + 1, total: filtered.length },
        detail: cardDetails(active),
        bounds: boundsMin === null ? null : { min: boundsMin, max: boundsMax },
      };
    };
    const regions = list => (list ?? []).filter(region => keys.has(region.key)).map(({ key, kind, rect, page }) => ({ key, kind, rect, page }));

    const draw = () => {
      for (const [index, [frame, version]] of frames.entries()) {
        const isBase = index === 1;
        const doc = frame?.contentDocument;
        if (!doc) continue;
        if (!ready || !shows(frame, version)) { clearOverlay(doc); continue; }
        drawOverlay(doc, regions(isBase ? comparison.previous : comparison.current), {
          activeKey: active?.key ?? null,
          numbers,
          onPick,
          card: cardFor(isBase === cardOnBase),
          zoom,
        });
      }
    };
    draw();
    const elements = frames.map(([frame]) => frame).filter(Boolean);
    for (const frame of elements) frame.addEventListener('load', draw);
    return () => { for (const frame of elements) frame.removeEventListener('load', draw); };
  }, [ready, comparison, filtered, active, state.changeIndex, target, base, cardOnBase, boundsMin, boundsMax, zoom, dispatch, targetRef, baseRef]);

  // A click in either prototype away from the selected change and its card deselects it.
  const activeKey = active?.key ?? null;
  useEffect(() => {
    if (!activeKey) return undefined;
    const frames = [targetRef.current, baseRef.current].filter(Boolean);
    const clear = () => dispatch({ type: 'clearChange' });
    const unbinds = new Map();
    const bind = frame => {
      unbinds.get(frame)?.();
      const win = frameWindow(frame);
      unbinds.set(frame, win ? bindClearOnClick(win.document, activeKey, clear, zoom) : () => {});
    };
    const onLoad = event => bind(event.currentTarget);
    for (const frame of frames) { bind(frame); frame.addEventListener('load', onLoad); }
    return () => {
      for (const frame of frames) frame.removeEventListener('load', onLoad);
      for (const unbind of unbinds.values()) quietly(unbind);
    };
  }, [activeKey, zoom, dispatch, targetRef, baseRef]);
  // Side by side, so does a click on the stage around the columns.
  const clearOnStage = event => {
    if (activeKey && event.target === event.currentTarget) dispatch({ type: 'clearChange' });
  };

  // Leaving the page removes what we drew.
  useEffect(() => () => {
    clearOverlay(targetRef.current?.contentDocument);
    clearOverlay(baseRef.current?.contentDocument);
  }, [targetRef, baseRef]);

  // The base frame appears in place: same scroll position as the target, put back when it hides again.
  // Either frame may have gone cross-origin (C2): then there is nothing to align, and nothing to put back.
  useLayoutEffect(() => {
    if (!peekInPlace) return undefined;
    const baseWin = frameWindow(baseRef.current), targetWin = frameWindow(targetRef.current);
    if (!baseWin || !targetWin) return undefined;
    const saved = baseWin.scrollY;
    alignScroll(baseWin, targetWin);
    return () => quietly(() => baseWin.scrollTo({ top: saved, behavior: 'instant' }));
  }, [peekInPlace, baseRef, targetRef]);

  // Stepping to a change scrolls the frame that holds it so the region sits in the middle. An explicit pick
  // (a row or a badge) scrolls again even when it picks the change already selected (I4); J/K steps don't count
  // as picks, so they behave as before.
  const scrolledFor = useRef(null);
  useEffect(() => {
    if (!active || !comparison) { scrolledFor.current = null; return; }
    const token = [target.id, base?.id, state.changeFilter, active.key, state.pick].join('|');
    if (scrolledFor.current === token) return;
    const frame = (removedActive ? baseRef : targetRef).current;
    if (!shows(frame, removedActive ? base : target)) return;
    const record = removedActive
      ? comparison.previous.find(item => item.key === active.key && item.kind === 'removed')
      : comparison.current.find(item => item.key === active.key);
    if (!record) return;
    scrolledFor.current = token;
    const win = frameWindow(frame);
    const offset = Math.max(24, (win.innerHeight - record.rect.height) / 2);
    win.scrollTo({ top: record.page ? 0 : Math.max(0, record.rect.y - offset), behavior: scrollBehavior() });
  }, [active, comparison, target, base, removedActive, state.changeFilter, state.pick, baseRef, targetRef]);

  const enter = { duration: reduced ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] };
  const exit = { duration: reduced ? 0 : 0.16, ease: 'easeOut' };
  // Labels: the stage's bottom corners in the wipe, each column's bottom-left side by side.
  const side = layout === 'side';
  const labelBottom = `calc(${side ? PAD + LABEL_INSET : LABEL_INSET}px + var(--label-lift))`;
  const beforeStyle = { left: (side ? PAD : 0) + LABEL_INSET, bottom: labelBottom };
  // With the panel open the pill docks in the bottom-right corner, right over the wipe's After label. The pill
  // and the panel both say which versions these are, so the label steps aside until the panel closes.
  const afterCovered = layout === 'wipe' && state.panelOpen && !phone;
  const afterStyle = side
    ? { left: PAD + boxes.column + GAP + LABEL_INSET, bottom: labelBottom }
    : { right: LABEL_INSET, bottom: labelBottom };

  const frameBox = (role, children) => (
    <motion.div key={role} className="frame-col" data-role={role} initial={false} animate={boxes[role].col} transition={boxTransition}>
      <motion.div
        className="frame-box"
        style={{ width: size.width || '100%', clipPath: role === 'base' ? clipPath : undefined }}
        initial={false}
        animate={boxes[role].box}
        transition={boxTransition}
      >
        {children}
      </motion.div>
    </motion.div>
  );
  const setPanTo = value => setPan(clampPan(value, size.width, boxes.visible));

  return (
    <div ref={stageRef} className="stage" data-layout={layout} data-dragging={dragging || undefined} onClick={clearOnStage}>
      {frameBox('target', <Frame frameRef={targetRef} version={target} role="target" compare={compare} visible />)}
      {base && frameBox('base', <Frame frameRef={baseRef} version={base} role="base" compare={compare} visible={showBase} />)}
      <AnimatePresence>
        {layout === 'wipe' && (
          <Divider key="divider" split={split} value={wipe} onChange={setWipe} onDragging={setDragging} stageRef={stageRef} stageWidth={size.width} beforeLabel={base.id} />
        )}
        {compare && <CompareLabel key="before" version={base} kind="Before" style={beforeStyle} />}
        {compare && !afterCovered && <CompareLabel key="after" version={target} kind="After" style={afterStyle} />}
        {side && (
          <SideTools
            key="side-tools"
            syncOn={state.syncScroll}
            onToggleSync={() => dispatch({ type: 'toggleSync' })}
            zoom={state.zoom}
            onZoom={next => zoomTo(next)}
          />
        )}
        {zoomed && ['base', 'target'].map(role => (
          <PanBar
            key={`pan-${role}`}
            left={boxes[role].col.x}
            top={SYNC_STRIP - PAN_BAR_LIFT}
            width={boxes.column}
            pan={boxes.pan}
            visible={boxes.visible}
            page={size.width}
            onPan={setPanTo}
            focusable={role === 'target'}
          />
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {!compare && removedActive && base && (
          <motion.div
            key="removed-note"
            className="stage-note"
            initial={{ opacity: 0, y: reduced ? 0 : -4 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
          >
            <span>Showing&nbsp;<span className="num">{base.id}</span>&nbsp;·&nbsp;removed in&nbsp;<span className="num">{target.id}</span></span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
