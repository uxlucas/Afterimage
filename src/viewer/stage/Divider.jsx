import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { useTransitions } from '../motion.js';

const STEP = 5;
const GRIP_ROOM = 17; // half the grip plus a little air: the grip stays whole at 0% and 100%
const clamp = value => Math.min(100, Math.max(0, value));

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="4" r="1.1" /><circle cx="7" cy="4" r="1.1" />
      <circle cx="3" cy="8" r="1.1" /><circle cx="7" cy="8" r="1.1" />
      <circle cx="3" cy="12" r="1.1" /><circle cx="7" cy="12" r="1.1" />
    </svg>
  );
}

// The wipe divider: a 1px line with a grip. Drag it anywhere along its length, or focus the grip and use the
// arrow keys. `value` is the percent of the stage that shows Before; dragging calls `onChange` (Stage's state),
// which re-renders the stage. `split` is the motion value Stage drives from it (and animates on a layout switch
// or snaps for peek); the line, grip and clip all read it, so they always move together.
export default function Divider({ split, value, onChange, stageRef, stageWidth, beforeLabel, onDragging }) {
  const t = useTransitions();
  const [dragging, setDragging] = useState(false);
  const pointer = useRef(null);
  const left = useTransform(split, v => `${v}%`);
  // The line goes to the very edge; the grip stops short of it.
  const width = useMotionValue(stageWidth);
  useEffect(() => { width.set(stageWidth); }, [width, stageWidth]);
  const gripShift = useTransform([split, width], ([v, w]) => {
    const at = (v / 100) * w;
    const shift = w > GRIP_ROOM * 2 ? Math.min(w - GRIP_ROOM, Math.max(GRIP_ROOM, at)) - at : 0;
    return `translate(calc(-50% + ${shift}px), -50%)`;
  });

  const percentAt = clientX => {
    const rect = stageRef.current.getBoundingClientRect();
    return rect.width > 0 ? clamp(((clientX - rect.left) / rect.width) * 100) : value;
  };
  const setDrag = on => { setDragging(on); onDragging?.(on); };

  const onPointerDown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    setDrag(true);
    onChange(percentAt(event.clientX));
  };
  const onPointerMove = event => {
    if (pointer.current === event.pointerId) onChange(percentAt(event.clientX));
  };
  const end = event => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setDrag(false);
  };

  const onKeyDown = event => {
    const next = { ArrowLeft: value - STEP, ArrowRight: value + STEP, Home: 0, End: 100 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next));
  };

  const rounded = Math.round(value);
  return (
    <motion.div
      className="wipe-divider"
      data-dragging={dragging || undefined}
      style={{ left }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: t.enter }}
      exit={{ opacity: 0, transition: t.exit }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span className="wipe-line" aria-hidden="true" />
      <motion.span
        className="wipe-grip"
        style={{ transform: gripShift }}
        role="slider"
        tabIndex={0}
        aria-label="Wipe divider"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}% ${beforeLabel} Before`}
        onKeyDown={onKeyDown}
      >
        <GripIcon />
      </motion.span>
    </motion.div>
  );
}
