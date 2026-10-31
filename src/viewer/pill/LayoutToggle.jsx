import { useRef } from 'react';
import { motion } from 'motion/react';
import { useTransitions } from '../motion.js';

const OPTIONS = [['wipe', 'Wipe'], ['side', 'Side by side']];

// Wipe | Side by side, as a radio group: one tab stop, arrow keys move between the two. The raised
// indicator slides to the chosen option instead of jumping.
export default function LayoutToggle({ layout, dispatch }) {
  const t = useTransitions();
  const refs = useRef({});
  const pick = value => { if (value !== layout) dispatch({ type: 'setLayout', layout: value }); };

  const onKeyDown = event => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = OPTIONS.findIndex(([value]) => value === layout);
    const [next] = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    pick(next);
    refs.current[next]?.focus({ preventScroll: true });
  };

  return (
    <div className="layout-toggle" role="radiogroup" aria-label="Compare layout" onKeyDown={onKeyDown}>
      {OPTIONS.map(([value, label]) => {
        const on = value === layout;
        return (
          <button
            key={value}
            ref={element => { refs.current[value] = element; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="layout-opt"
            data-on={on || undefined}
            onClick={() => pick(value)}
          >
            {on && <motion.span layoutId="compare-layout-indicator" className="layout-indicator" transition={t.layout} />}
            <span className="layout-opt-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
