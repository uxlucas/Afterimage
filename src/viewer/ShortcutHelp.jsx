import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTransitions } from './motion.js';
import { useReducedMotion } from './hooks/useMedia.js';
import './shortcuts.css';

// The spec's list, grouped by what you are doing. Strings are the spec's.
const GROUPS = [
  {
    name: 'Versions',
    rows: [
      { keys: ['[', ']'], text: 'previous / next version' },
      { keys: ['G'], text: 'type a version number' },
      { keys: ['L'], text: 'go to latest' },
    ],
  },
  {
    name: 'Changes',
    rows: [
      { keys: ['H'], text: 'highlights on/off' },
      { keys: ['J', 'K'], text: 'next / previous change' },
    ],
  },
  {
    name: 'Compare',
    rows: [
      { keys: ['B'], text: 'hold to see the previous version (or the baseline, in Compare)' },
      { keys: ['C'], text: 'compare' },
    ],
  },
  {
    name: 'Panel',
    rows: [
      { keys: ['V'], text: 'open / close panel' },
      { keys: ['.'], text: 'hide / show Afterimage' },
      { keys: ['Esc'], text: 'closes whatever is on top' },
      { keys: ['?'], text: 'this list' },
    ],
  },
];

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

// A small dark sheet over the page. While it is open focus is on its close button; closing puts focus back
// where it was. Esc is handled by the app, which knows what else is open.
export default function ShortcutHelp({ open, onClose }) {
  const t = useTransitions();
  const reduced = useReducedMotion();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="help"
          className="help-scrim"
          onClick={event => { if (event.target === event.currentTarget) onClose(); }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: t.enter }}
          exit={{ opacity: 0, transition: t.exit }}
        >
          <motion.section
            className="help-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            // The close button is the only control, so Tab stays put.
            onKeyDown={event => { if (event.key === 'Tab') event.preventDefault(); }}
            initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: t.enter }}
            exit={{ opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : 0.98, transition: t.exit }}
          >
            <header className="help-head">
              <h2 className="help-title">Keyboard shortcuts</h2>
              <button ref={closeRef} type="button" className="help-close" aria-label="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            </header>
            <div className="help-body">
              {GROUPS.map(group => (
                <section key={group.name} className="help-group" aria-label={group.name}>
                  <h3 className="help-group-name">{group.name}</h3>
                  <dl className="help-rows">
                    {group.rows.map(row => (
                      <div key={row.keys.join('')} className="help-row">
                        <dt className="help-keys">{row.keys.map(label => <kbd key={label}>{label}</kbd>)}</dt>
                        <dd className="help-text">{row.text}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
