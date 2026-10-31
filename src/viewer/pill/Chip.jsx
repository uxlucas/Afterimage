import { motion } from 'motion/react';
import { versionNumber } from '../state/versions.js';
import { useTransitions } from '../motion.js';

// The pill, put away: a small chip in the corner that still says where you are. Clicking it brings the pill back.
export default function Chip({ state, versions, chipRef, onShow }) {
  const t = useTransitions();
  const latest = versions[0];
  const target = versions.find(version => version.id === state.versionId) ?? latest;
  const base = state.mode === 'compare' ? versions.find(version => version.id === state.baseId) ?? null : null;
  const isLatest = target.id === latest.id;
  const number = versionNumber(target);
  const where = base
    ? `v${versionNumber(base)} to v${number}`
    : `v${number} of ${versionNumber(latest)}${isLatest ? ', latest' : ''}`;

  return (
    <motion.button
      type="button"
      ref={chipRef}
      className="pill chip"
      aria-label={`Show Afterimage. ${where}`}
      onClick={onShow}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, transition: t.enter }}
    >
      {base ? (
        <>
          <span className="num">v{versionNumber(base)}</span>
          <span className="muted" aria-hidden="true">→</span>
          <span className="num">v{number}</span>
        </>
      ) : (
        <>
          <span className="pill-dot" data-latest={isLatest || undefined} aria-hidden="true" />
          <span className="num">v{number}</span>
        </>
      )}
      <span className="pill-hint chip-hint" aria-hidden="true">Show Afterimage <kbd>.</kbd></span>
    </motion.button>
  );
}
