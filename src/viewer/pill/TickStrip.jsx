import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { clampBase, clampTarget, indexOfVersion, nearestTick, tickWindow } from '../state/versions.js';
import { useTransitions } from '../motion.js';

const PITCH = 5; // 2px tick + 3px gap
const TICK = 2;
const GAP = 4; // extra space after a pinned base, standing for the versions skipped
const BASE_BIAS = 2; // a press this much nearer another tick still picks up the base

// Up to 12 ticks around the current version, oldest on the left. Click or drag to change version.
// While a drag is held the window stays where it was, so the tick under the pointer doesn't run away;
// on release it re-centres and the ticks slide to their new places.
// In Compare the strip is a range: the baseline is a hollow tick and the ticks between it and the target light
// up. A baseline older than the window is pinned first, with a gap after it, so it is always there to grab.
// Pressing the baseline tick (it wins near-ties) drags the baseline, held to versions older than the target; it
// only moves on the strip while dragging, and the baseline (and so the change count) is set when it is dropped.
// Dragging the target is held to versions newer than the baseline, so a scrub never moves the baseline.
export default function TickStrip({ versions, state, dispatch }) {
  const t = useTransitions();
  const trackRef = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [draftBase, setDraftBase] = useState(null); // the baseline while its tick is being dragged
  const draftRef = useRef(null); // the same, for the pointer handlers that run before a re-render
  const [layoutBase, setLayoutBase] = useState(null); // the baseline the strip was laid out with when the drag began
  const holdBase = id => { draftRef.current = id; setDraftBase(id); };

  const comparing = state.mode === 'compare';
  const baseId = comparing ? draftBase ?? state.baseId : null;
  // While a tick is held, the strip keeps the layout it had when the press began; only the roles follow.
  const strip = tickWindow(versions, anchor ?? state.versionId, comparing ? layoutBase ?? state.baseId : null);
  const indexOf = id => indexOfVersion(versions, id); // newest first: older is a bigger index
  const roleOf = id => {
    if (id === state.versionId) return 'selected';
    if (id === baseId) return 'base';
    if (baseId && indexOf(id) < indexOf(baseId) && indexOf(id) > indexOf(state.versionId)) return 'range';
    return 'plain';
  };
  const ticks = strip.ticks.map(tick => ({ ...tick, role: roleOf(tick.id) }));
  const positions = ticks.map((_, index) => index * PITCH + (strip.gapAfter !== -1 && index > strip.gapAfter ? GAP : 0));
  const dragging = anchor !== null;

  const indexAt = (clientX, preferBase) => {
    const x = clientX - trackRef.current.getBoundingClientRect().left - TICK / 2;
    const base = preferBase ? ticks.findIndex(tick => tick.role === 'base') : -1;
    return nearestTick(positions, x, base, BASE_BIAS);
  };
  const idAt = clientX => ticks[indexAt(clientX, false)]?.id ?? null;
  const select = id => {
    const next = id && comparing ? clampTarget(versions, id, state.baseId) : id;
    if (next && next !== state.versionId) dispatch({ type: 'selectVersion', id: next });
  };

  const onPointerDown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnchor(state.versionId);
    setHoverId(null);
    const pressed = ticks[indexAt(event.clientX, comparing)];
    if (pressed?.role === 'base') {
      setLayoutBase(state.baseId);
      holdBase(state.baseId);
    } else {
      select(pressed?.id);
    }
  };
  const onPointerMove = event => {
    if (dragging && draftRef.current !== null) holdBase(clampBase(versions, idAt(event.clientX), state.versionId) ?? draftRef.current);
    else if (dragging) select(idAt(event.clientX));
    else if (event.pointerType === 'mouse') setHoverId(idAt(event.clientX));
  };
  // Dropping the baseline tick sets the baseline; a cancelled drag puts it back.
  const endDrag = ({ commit }) => {
    const dropped = draftRef.current;
    if (commit && dropped !== null && dropped !== state.baseId) dispatch({ type: 'setBase', id: dropped });
    holdBase(null);
    setLayoutBase(null);
    setAnchor(null);
  };

  const oldestFirst = versions.length - 1 - indexOfVersion(versions, state.versionId);
  const current = versions.find(version => version.id === state.versionId);
  const tipId = dragging ? draftBase ?? state.versionId : hoverId;
  const tipIndex = ticks.findIndex(tick => tick.id === tipId);
  const tipVersion = tipIndex === -1 ? null : versions.find(version => version.id === tipId);
  const tipX = tipIndex === -1 ? 0 : positions[tipIndex] + TICK / 2;
  const fade = strip.fadeStart && strip.fadeEnd ? 'both' : strip.fadeStart ? 'start' : strip.fadeEnd ? 'end' : undefined;

  return (
    <div
      className="tick-strip"
      data-dragging={dragging || undefined}
      data-range={comparing || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag({ commit: true })}
      onPointerCancel={() => endDrag({ commit: false })}
      onLostPointerCapture={() => endDrag({ commit: false })}
      onPointerLeave={() => setHoverId(null)}
    >
      <input
        className="tick-input"
        type="range"
        min={0}
        max={versions.length - 1}
        step={1}
        value={oldestFirst}
        aria-label="Version timeline"
        aria-valuetext={`${current.id}, ${current.name}`}
        onChange={event => select(versions[versions.length - 1 - Number(event.target.value)]?.id)}
      />
      <div ref={trackRef} className="tick-track" data-fade={fade} style={{ width: (positions[positions.length - 1] ?? 0) + TICK }} aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          {ticks.map((tick, index) => (
            <motion.span
              key={tick.id}
              className="tick-slot"
              style={{ marginLeft: strip.gapAfter !== -1 && index === strip.gapAfter + 1 ? GAP : 0 }}
              layout="position"
              transition={t.layout}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: t.enter }}
              exit={{ opacity: 0, transition: t.exit }}
            >
              <span className="tick" data-role={tick.role} data-hover={tick.id === hoverId || undefined} />
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {tipVersion && (
          <motion.div
            key="tip"
            className="tick-tip-anchor"
            initial={{ opacity: 0, x: tipX }}
            animate={{ opacity: 1, x: tipX, transition: { opacity: t.enter, x: { ...t.enter, duration: Math.min(t.enter.duration, 0.12) } } }}
            exit={{ opacity: 0, transition: t.exit }}
            aria-hidden="true"
          >
            <div className="tick-tip">
              <span className="num">{tipVersion.id}</span>
              <span className="tick-tip-sep">·</span>
              <span className="tick-tip-name">{tipVersion.name}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
