import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { parseVersionInput, versionNumber } from '../state/versions.js';
import { useTransitions } from '../motion.js';
import { useReducedMotion } from '../hooks/useMedia.js';

// The version number as an inline field. Nothing changes until Enter; Esc or leaving the field puts the
// number back. The hint sits above the pill, next to the field it talks about.
// By default it picks the selected version. Compare's baseline field passes its own `choices` (the versions
// older than the target, so a newer number gets the range hint) and its own `onPick` / `onStep`.
export default function VersionField({ versions, version, dispatch, inputId, choices = versions, onPick, onStep, label = 'Version number', baseline, fieldRef }) {
  const t = useTransitions();
  const reduced = useReducedMotion();
  const hintId = useId();
  const inputRef = useRef(null);
  const justFocused = useRef(false);
  const [scope, animate] = useAnimate();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(null); // what the visitor typed; null shows the current number
  const [error, setError] = useState(null);

  const number = versionNumber(version);
  const digits = String(versionNumber(versions[0])).length;
  const chars = Math.max(3, digits);

  // ↑/↓ change the version while the field is focused: show the new number, selected, ready to type over.
  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement === input) input.select();
  }, [number]);

  const reset = () => { setDraft(null); setError(null); };

  const reject = hint => {
    setError(hint);
    inputRef.current?.select();
    if (!reduced && scope.current) animate(scope.current, { x: [0, -3, 3, -2, 2, 0] }, { duration: 0.24, ease: 'easeOut' });
  };

  const onKeyDown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (draft === null || draft === String(number)) { inputRef.current.blur(); return; }
      const result = parseVersionInput(draft, choices);
      if (!result.ok) { reject(result.hint); return; }
      if (onPick) onPick(result.id);
      else dispatch({ type: 'selectVersion', id: result.id });
      inputRef.current.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      reset();
      const delta = event.key === 'ArrowUp' ? 1 : -1;
      if (onStep) onStep(delta);
      else dispatch({ type: 'stepVersion', delta });
    }
  };

  const hint = error ?? (focused ? 'typing' : null);

  return (
    <>
      <span ref={scope} className="version-field-wrap">
        <input
          ref={element => { inputRef.current = element; if (fieldRef) fieldRef.current = element; }}
          id={inputId}
          className="version-field num"
          data-invalid={error ? true : undefined}
          data-baseline={baseline || undefined}
          style={{ width: `calc(${chars}ch + 12px)` }}
          type="text"
          inputMode="numeric"
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          maxLength={chars}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint ? hintId : undefined}
          value={draft ?? String(number)}
          onChange={event => { setDraft(event.target.value.replace(/\D/g, '')); setError(null); }}
          onFocus={event => { setFocused(true); justFocused.current = true; event.target.select(); }}
          onMouseUp={event => { if (justFocused.current) { event.preventDefault(); justFocused.current = false; } }}
          onBlur={() => { setFocused(false); justFocused.current = false; reset(); }}
          onKeyDown={onKeyDown}
        />
      </span>
      <AnimatePresence>
        {hint && (
          <motion.div
            key="hint"
            id={hintId}
            className="pill-hint"
            data-error={error ? true : undefined}
            role="status"
            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0, transition: t.enter }}
            exit={{ opacity: 0, y: reduced ? 0 : 2, transition: t.exit }}
          >
            {error ?? <>Enter to go <span aria-hidden="true">·</span> <kbd>↑</kbd><kbd>↓</kbd> step</>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
