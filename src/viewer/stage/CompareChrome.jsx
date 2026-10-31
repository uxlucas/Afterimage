import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useTransitions } from '../motion.js';

// `v56 Before` / `v60 After`, in a bottom corner of the stage or of its column, never over the prototype's header.
// It moves with the layout switch instead of jumping to its new corner.
export function CompareLabel({ version, kind, style }) {
  const t = useTransitions();
  return (
    <motion.div
      className="compare-label"
      style={style}
      layout="position"
      transition={t.layout}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: t.enter }}
      exit={{ opacity: 0, transition: t.exit }}
    >
      <span className="num">{version.id}</span>
      <span className="compare-label-kind">{kind}</span>
    </motion.div>
  );
}

const ZOOM_OPTIONS = [['fit', 'Fit'], ['75', '75%'], ['100', '100%']];

// Side by side only, in the strip above the columns: how large the columns show their pages, and whether
// scrolling one side moves the other.
export function SideTools({ syncOn, onToggleSync, zoom, onZoom }) {
  const t = useTransitions();
  const refs = useRef({});
  const onKeyDown = event => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = ZOOM_OPTIONS.findIndex(([value]) => value === zoom);
    const [next] = ZOOM_OPTIONS[Math.min(ZOOM_OPTIONS.length - 1, Math.max(0, index + step))];
    onZoom(next);
    refs.current[next]?.focus({ preventScroll: true });
  };
  return (
    <motion.div
      className="side-tools"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: t.enter }}
      exit={{ opacity: 0, transition: t.exit }}
    >
      <div className="zoom-toggle" role="radiogroup" aria-label="Zoom" onKeyDown={onKeyDown}>
        {ZOOM_OPTIONS.map(([value, label]) => {
          const on = value === zoom;
          return (
            <button
              key={value}
              ref={element => { refs.current[value] = element; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className="zoom-opt"
              data-on={on || undefined}
              onClick={() => onZoom(value)}
            >
              {on && <motion.span layoutId="side-zoom-indicator" className="zoom-indicator" transition={t.layout} />}
              <span className="zoom-opt-label">{label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" role="switch" aria-checked={syncOn} className="sync-chip" data-on={syncOn || undefined} onClick={onToggleSync}>
        <span className="sync-dot" aria-hidden="true" />
        Scroll synced
      </button>
    </motion.div>
  );
}

// Zoomed in side by side: which slice of the page a column shows, in the strip just above it. Drag the thumb,
// or press the track to jump there. Both columns show the same slice, so only the After bar takes focus.
//   left, top, width: where the bar sits (stage pixels); pan, visible, page: the slice and the page (page pixels).
export function PanBar({ left, top, width, pan, visible, page, onPan, focusable }) {
  const t = useTransitions();
  const barRef = useRef(null);
  const grab = useRef(null);
  const [dragging, setDragging] = useState(false);
  const thumbWidth = (visible / page) * width;
  const thumbLeft = (pan / page) * width;
  const toPan = clientX => {
    const rect = barRef.current.getBoundingClientRect();
    return ((clientX - rect.left - grab.current) / width) * page;
  };
  const onPointerDown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const x = event.clientX - barRef.current.getBoundingClientRect().left;
    const onThumb = x >= thumbLeft && x <= thumbLeft + thumbWidth;
    grab.current = onThumb ? x - thumbLeft : thumbWidth / 2; // the track centres the thumb on the pointer
    if (!onThumb) onPan(toPan(event.clientX));
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = event => { if (dragging) onPan(toPan(event.clientX)); };
  const onPointerUp = () => setDragging(false);
  const onKeyDown = event => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step) { event.preventDefault(); onPan(pan + step * visible * 0.2); }
    if (event.key === 'Home') { event.preventDefault(); onPan(0); }
    if (event.key === 'End') { event.preventDefault(); onPan(page); }
  };
  const max = Math.max(1, page - visible);
  return (
    <motion.div
      ref={barRef}
      className="pan-bar"
      data-dragging={dragging || undefined}
      style={{ left, top, width }}
      role={focusable ? 'scrollbar' : undefined}
      aria-label={focusable ? 'Pan both sides' : undefined}
      aria-orientation={focusable ? 'horizontal' : undefined}
      aria-valuemin={focusable ? 0 : undefined}
      aria-valuemax={focusable ? 100 : undefined}
      aria-valuenow={focusable ? Math.round((pan / max) * 100) : undefined}
      aria-hidden={focusable ? undefined : true}
      tabIndex={focusable ? 0 : undefined}
      onKeyDown={focusable ? onKeyDown : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: t.enter }}
      exit={{ opacity: 0, transition: t.exit }}
    >
      <span className="pan-track" />
      <span className="pan-thumb" style={{ left: thumbLeft, width: thumbWidth }} />
    </motion.div>
  );
}
