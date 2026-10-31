import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { filterEntries } from '../../engine/review.js';
import { useTransitions } from '../motion.js';
import { useReducedMotion } from '../hooks/useMedia.js';
import { filterWord, stepperLabel } from './stepper.js';

export function HighlightIcon() {
  return (
    <svg className="pill-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M7 3H4a1 1 0 0 0-1 1v3m10-4h3a1 1 0 0 1 1 1v3M3 13v3a1 1 0 0 0 1 1h3m6 0h3a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function Chevron({ direction }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction < 0 ? 'M9.5 4 5.5 8l4 4' : 'm6.5 4 4 4-4 4'} />
    </svg>
  );
}

// Animates its own width to fit its content, so the segments beside it slide instead of jumping.
function AutoWidth({ ref, className, children, ...rest }) {
  const t = useTransitions();
  const innerRef = useRef(null);
  const [width, setWidth] = useState(null);
  // Measure after every render, before paint, so a content swap and its width change start on the same frame.
  // The observer catches changes that don't come from a render (fonts loading).
  useLayoutEffect(() => {
    const next = innerRef.current.offsetWidth;
    setWidth(current => (current === next ? current : next));
  });
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const observer = new ResizeObserver(() => setWidth(inner.offsetWidth));
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div {...rest} ref={ref} className={className} initial={false} animate={{ width: width ?? 'auto' }} transition={t.layout}>
      <div ref={innerRef} className="auto-width-inner">{children}</div>
    </motion.div>
  );
}

// One view of the segment. Once it starts leaving it becomes inert, so Tab and clicks skip it while it fades.
// Going inert waits for a passive effect, after the segment has had its chance to move focus to the new view.
// If the same view comes back mid-exit (a quick double toggle), it is live again in that same render.
function Swap({ ref, children, ...props }) {
  const present = useIsPresent();
  const [gone, setGone] = useState(false);
  useEffect(() => { setGone(!present); }, [present]);
  return <motion.div {...props} ref={ref} className="seg-content" inert={(!present && gone) || undefined}>{children}</motion.div>;
}

const digitsOf = value => String(value).length;

// Off: "Highlight" with the change count. On: a stepper, "Change 3 of 15 ‹ ›".
export default function HighlightSegment({ state, dispatch, review, disabled, phone }) {
  const t = useTransitions();
  const reduced = useReducedMotion();
  const { status, summary } = review;
  const ready = status === 'ready';
  const total = useMemo(() => filterEntries(review.entries, state.changeFilter).length, [review.entries, state.changeFilter]);

  // While a new count is on its way, keep the old one's width so nothing shifts when it lands.
  const lastTotal = useRef(null);
  const lastSteps = useRef(null);
  useEffect(() => {
    if (!ready) return;
    lastTotal.current = summary.total;
    lastSteps.current = total;
  }, [ready, summary.total, total]);

  const rootRef = useRef(null);
  const toggles = useRef({});
  const refocus = useRef(false);
  const toggleRef = key => element => { if (element) toggles.current[key] = element; };

  const on = state.highlights && !disabled;
  const toggle = () => {
    refocus.current = Boolean(rootRef.current?.contains(document.activeElement));
    dispatch({ type: 'toggleHighlights' });
  };
  const step = delta => dispatch({ type: 'stepChange', delta, total });

  let view = 'off';
  if (on) view = status === 'failed' ? 'failed' : ready && total === 0 ? 'none' : 'steps';

  // The view swaps out from under whatever had focus. If focus was in this segment, hand it to the new view's
  // toggle so a keyboard user keeps their place (Enter on Highlight, then Tab reaches the arrows).
  const shown = useRef(view);
  useLayoutEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    const held = refocus.current || Boolean(rootRef.current?.contains(document.activeElement));
    refocus.current = false;
    if (held) toggles.current[view]?.focus({ preventScroll: true });
  }, [view]);

  const swap = {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: t.enter },
    exit: { opacity: 0, y: reduced ? 0 : -6, transition: t.exit },
  };

  let content;
  if (view === 'off') {
    const showCount = !disabled && status !== 'failed';
    const countText = ready ? summary.total : lastTotal.current ?? '';
    const label = disabled
      ? 'Highlight changes, not available on the first version'
      : ready ? `Highlight changes, ${summary.total} ${summary.total === 1 ? 'change' : 'changes'}` : 'Highlight changes';
    content = (
      <Swap key="off" {...swap}>
        <motion.button
          ref={toggleRef('off')}
          type="button"
          className="pill-btn highlight-btn"
          aria-pressed={false}
          aria-label={label}
          disabled={disabled}
          onClick={toggle}
          initial={false}
          animate={{ opacity: disabled ? 0.4 : 1 }}
          transition={t.enter}
        >
          {phone ? <HighlightIcon /> : <span>Highlight</span>}
          {showCount && (
            <motion.span
              className="pill-count num"
              data-zero={ready && summary.total === 0 ? true : undefined}
              initial={false}
              animate={{ opacity: ready ? 1 : 0 }}
              transition={ready ? t.enter : t.exit}
            >
              {countText}
            </motion.span>
          )}
        </motion.button>
      </Swap>
    );
  } else if (view === 'steps') {
    const shownTotal = ready ? total : lastSteps.current;
    const slot = `${digitsOf(shownTotal ?? 0)}ch`;
    const position = ready && state.changeIndex !== null ? state.changeIndex + 1 : '–';
    const canStep = ready && total > 0;
    // Under a filter the stepper says which (Ruling 26). The word is fixed while stepping, so the width holds.
    const word = filterWord(state.changeFilter);
    content = (
      <Swap key="steps" {...swap}>
        <button
          ref={toggleRef('steps')}
          type="button"
          className="pill-btn stepper-label"
          aria-pressed
          aria-label={stepperLabel({ ready, changeIndex: state.changeIndex, total, filter: state.changeFilter })}
          onClick={toggle}
        >
          <HighlightIcon />
          <span className="stepper-text" data-filter={word || undefined}>
            {!phone && <span className="stepper-prefix">Change</span>}
            <span className="num stepper-n" style={{ minWidth: slot }} data-empty={position === '–' || undefined}>{position}</span>
            <span className="muted">of</span>
            <motion.span
              className="num muted stepper-total"
              initial={false}
              animate={{ opacity: ready ? 1 : 0 }}
              transition={ready ? t.enter : t.exit}
            >
              {shownTotal ?? ''}
            </motion.span>
            {/* A phone has no room for the word (it clips at 360px): a dot in the outlines' colour for that kind
                stands in for it, and the label above says it in full. */}
            {word && (phone
              ? <span className="stepper-filter-dot" data-kind={state.changeFilter} aria-hidden="true" />
              : <span className="muted stepper-filter">{word}</span>)}
          </span>
        </button>
        <span className="stepper-arrows">
          <button type="button" className="pill-step" aria-label="Previous change" disabled={!canStep} onClick={() => step(-1)}><Chevron direction={-1} /></button>
          <button type="button" className="pill-step" aria-label="Next change" disabled={!canStep} onClick={() => step(1)}><Chevron direction={1} /></button>
        </span>
      </Swap>
    );
  } else {
    content = (
      <Swap key={view} {...swap}>
        <button ref={toggleRef(view)} type="button" className="pill-btn stepper-label" aria-pressed aria-label={`${view === 'none' ? 'No visible changes' : "Couldn't check changes"}. Turn highlights off`} onClick={toggle}>
          <HighlightIcon />
          <span className="muted">{view === 'none' ? (phone ? '0' : 'No visible changes') : (phone ? '–' : "Couldn't check")}</span>
        </button>
      </Swap>
    );
  }

  return (
    <AutoWidth ref={rootRef} className="pill-seg highlight-seg" data-on={on || undefined}>
      <AnimatePresence initial={false} mode="popLayout">
        {content}
      </AnimatePresence>
    </AutoWidth>
  );
}
