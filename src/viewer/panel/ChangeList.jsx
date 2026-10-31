import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { filterEntries } from '../../engine/review.js';
import { useTransitions } from '../motion.js';
import { useReducedMotion } from '../hooks/useMedia.js';
import { useScrollEnd } from './scrollFade.js';

const BATCH = 12;
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'changed', label: 'Changed' },
  { id: 'added', label: 'Added' },
  { id: 'removed', label: 'Removed' },
];

const isColor = value => /^(#|rgba?\(|hsla?\(|oklch\()/i.test(String(value).trim());

// The line under the kind: what changed, then where. Added and removed say so in words.
function whatLine(entry) {
  if (entry.kind === 'added') return `Added · ${entry.label}`;
  if (entry.kind === 'removed') return `Removed · ${entry.label}`;
  const detail = entry.details.find(item => !item.layout) ?? entry.details[0];
  return detail ? `${detail.label} · ${entry.label}` : entry.label;
}

// rgb(237, 244, 231) → #edf4e7, so both sides of a colour change fit on one line.
function shortColor(text) {
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(String(text).trim());
  if (!match) return text;
  const hex = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  let alpha = match[4] === undefined ? 1 : parseFloat(match[4]) / (match[4].endsWith('%') ? 100 : 1);
  if (Number.isNaN(alpha)) alpha = 1;
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}${alpha < 1 ? hex(alpha * 255) : ''}`;
}

function Value({ text, muted }) {
  const swatch = isColor(text);
  return (
    <span className={`crow-value${muted ? ' is-before' : ''}${swatch ? ' num' : ''}`} title={swatch ? text : undefined}>
      {swatch && <span className="crow-swatch" style={{ background: text }} aria-hidden="true" />}
      {swatch ? shortColor(text) : text}
    </span>
  );
}

// One line of before → after. Added rows show what arrived, removed rows what left and where to see it.
function DiffLine({ entry, baseLabel, targetLabel }) {
  if (entry.kind === 'added') {
    const text = entry.details[0]?.after || `New in ${targetLabel}`;
    return <span className="crow-diff"><Value text={text} /></span>;
  }
  if (entry.kind === 'removed') {
    const text = entry.details[0]?.before;
    return <span className="crow-diff">{text ? <Value text={text} muted /> : <span className="crow-value is-before">Shown on <span className="num">{baseLabel}</span></span>}</span>;
  }
  const detail = entry.details.find(item => !item.layout) ?? entry.details[0];
  if (!detail) return <span className="crow-diff"><span className="crow-value is-before">{entry.kindLabel}</span></span>;
  return (
    <span className="crow-diff">
      {detail.before ? <Value text={detail.before} muted /> : <span className="crow-value is-before">None</span>}
      <span className="crow-arrow" aria-hidden="true">→</span>
      {detail.after ? <Value text={detail.after} /> : <span className="crow-value">None</span>}
    </span>
  );
}

const emptyCopy = { changed: 'Nothing changed in place', added: 'Nothing added', removed: 'Nothing removed' };

// The changes in this comparison, filterable by kind. Rows are numbered like the outlines on the page,
// and picking one scrolls the page to it.
export default function ChangeList({ state, dispatch, review, baseLabel, targetLabel, phone, onClose }) {
  const t = useTransitions();
  const reduced = useReducedMotion();
  const filtered = useMemo(() => filterEntries(review.entries, state.changeFilter), [review.entries, state.changeFilter]);
  const [limit, setLimit] = useState(BATCH);
  const listRef = useRef(null);
  const focusFrom = useRef(null);

  // A new list starts at the first batch again.
  useEffect(() => { setLimit(BATCH); }, [filtered]);
  // and from its top: a different filter is a different list.
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [state.changeFilter]);

  // A change picked from the pill or the page may sit past the shown rows; reveal up to it.
  const selected = state.changeIndex;
  const shown = Math.min(filtered.length, Math.max(limit, selected !== null ? Math.ceil((selected + 1) / BATCH) * BATCH : 0));

  // Keep the selected row in view inside the list, without scrolling the page or the panel.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || selected === null) return;
    const row = list.querySelector(`[data-index="${selected}"]`);
    if (!row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    const pad = 8;
    let next = null;
    if (top - pad < list.scrollTop) next = top - pad;
    else if (bottom + pad > list.scrollTop + list.clientHeight) next = bottom + pad - list.clientHeight;
    if (next !== null) list.scrollTo({ top: next, behavior: reduced ? 'instant' : 'smooth' });
  }, [selected, filtered, reduced]);

  // "12 more" hands focus to the first row it revealed.
  useEffect(() => {
    if (focusFrom.current === null) return;
    listRef.current?.querySelector(`[data-index="${focusFrom.current}"]`)?.focus();
    focusFrom.current = null;
  }, [shown]);

  const pick = index => {
    if (!state.highlights) dispatch({ type: 'toggleHighlights' });
    // On a phone the sheet would cover the region, so it closes first; the pill's stepper takes over from here.
    // It closes the Dock's way, so focus goes back to the pill instead of dropping to the page (Ruling 23).
    if (phone) onClose({ refocus: true });
    dispatch({ type: 'selectChange', index });
  };

  const [atEnd, onScroll] = useScrollEnd(listRef, [shown, review.status]);
  const checking = review.status === 'checking' || review.status === 'idle';
  const remaining = filtered.length - shown;

  return (
    <div className="changes">
      <div className="filters" role="group" aria-label="Show changes">
        {FILTERS.map(filter => {
          const on = state.changeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              className="filter"
              aria-pressed={on}
              onClick={() => { if (!on) dispatch({ type: 'setFilter', filter: filter.id }); }}
            >
              {on && <motion.span layoutId="filter-fill" className="filter-fill" transition={t.layout} />}
              <span className="filter-label">{filter.label}</span>
            </button>
          );
        })}
      </div>

      {checking ? (
        <p className="list-note">Checking changes…</p>
      ) : filtered.length === 0 ? (
        <p className="list-note">{emptyCopy[state.changeFilter] ?? 'No changes'} since <span className="num">{baseLabel}</span></p>
      ) : (
        <div ref={listRef} className="change-list" role="list" aria-label="Changes" data-end={atEnd || undefined} onScroll={onScroll}>
          {filtered.slice(0, shown).map((entry, index) => (
            <div role="listitem" key={entry.key + entry.kind}>
              <button
                type="button"
                className="crow"
                data-index={index}
                data-kind={entry.kind}
                aria-current={index === selected || undefined}
                onClick={() => pick(index)}
              >
                <span className="crow-badge num" aria-label={`${entry.kindLabel}, ${index + 1}`}>{index + 1}</span>
                <span className="crow-text">
                  <span className="crow-what">{whatLine(entry)}</span>
                  <DiffLine entry={entry} baseLabel={baseLabel} targetLabel={targetLabel} />
                </span>
              </button>
            </div>
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="list-more"
              onClick={() => { focusFrom.current = shown; setLimit(shown + BATCH); }}
            >
              <span className="num">{Math.min(BATCH, remaining)}</span> more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
