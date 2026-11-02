import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { groupByDay, formatSaved, previousVersion, versionNumber } from '../state/versions.js';
import { reviewKey } from '../../engine/review.js';
import { useBackgroundCounts } from '../hooks/useBackgroundCounts.js';
import { useRoute } from '../hooks/useRouteSync.js';
import { useReducedMotion } from '../hooks/useMedia.js';
import { useScrollEnd } from './scrollFade.js';
import { frameWindow } from '../frames.js';

const SEARCH_FROM = 9; // a search field shows up once there are more than 8 versions
const VIEW_SETTLE_MS = 120; // rows that only flash past while scrolling aren't worth a comparison
const FADE = 32; // the list's bottom fade; a selected row scrolls clear of it

function matches(version, query) {
  if (!query) return true;
  const digits = query.replace(/^v(?=\d)/, '');
  if (/^\d+$/.test(digits) && String(versionNumber(version)).startsWith(digits)) return true;
  return version.name.toLowerCase().includes(query);
}

function timeOf(version) {
  const saved = formatSaved(version.savedAt);
  return saved ? saved.split(', ')[1] : '';
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3 3" />
    </svg>
  );
}

// Every version, grouped by day, newest first. The current one is marked; any other is one click away.
// Change counts fill in as rows come into view.
export default function VersionList({ versions, state, dispatch, review, targetRef }) {
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const scrollerRef = useRef(null);
  const visible = useRef(new Set());
  const [pairsInView, setPairsInView] = useState([]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => versions.filter(version => matches(version, needle)), [versions, needle]);
  const groups = useMemo(() => groupByDay(shown, new Date()), [shown]);
  const counts = useBackgroundCounts(pairsInView);
  const exploring = state.mode === 'explore';
  // Each row counts the changes on the route the prototype shows, as the live review does.
  const shownRoute = useRoute();

  // Rows in view become pairs for the background queue, top to bottom. The selected version is left out
  // while exploring: the live review is already counting it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let timer = null;
    const publish = () => {
      const win = frameWindow(targetRef.current); // null once the prototype frame went cross-origin
      const width = win?.innerWidth || window.innerWidth;
      const height = win?.innerHeight || window.innerHeight;
      const pairs = [];
      for (const version of shown) {
        if (!visible.current.has(version.id)) continue;
        if (exploring && version.id === state.versionId) continue;
        const base = previousVersion(versions, version.id);
        if (!base) continue;
        pairs.push({ key: reviewKey({ target: version, base, width, height, route: shownRoute }), target: version, base, width, height, route: shownRoute });
      }
      setPairsInView(current => (current.map(pair => pair.key).join() === pairs.map(pair => pair.key).join() ? current : pairs));
    };
    const observer = new IntersectionObserver(records => {
      for (const record of records) {
        const id = record.target.dataset.version;
        if (record.isIntersecting) visible.current.add(id);
        else visible.current.delete(id);
      }
      clearTimeout(timer);
      timer = setTimeout(publish, VIEW_SETTLE_MS);
    }, { root: scroller, rootMargin: '24px 0px' });
    visible.current.clear();
    for (const row of scroller.querySelectorAll('[data-version]')) observer.observe(row);
    // Counts depend on the viewport size, so a resize publishes the same rows again at the new size.
    const onResize = () => { clearTimeout(timer); timer = setTimeout(publish, VIEW_SETTLE_MS); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', onResize); };
  }, [shown, versions, exploring, state.versionId, targetRef, shownRoute]);

  // Opening the list puts the current version in the middle of it. Later selections only scroll as far as needed.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const row = scroller?.querySelector(`[data-version="${state.versionId}"]`);
    if (!row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (!placed.current) {
      placed.current = true;
      scroller.scrollTop = top - (scroller.clientHeight - row.offsetHeight) / 2;
      return;
    }
    const pad = 32; // room for the sticky day label
    let next = null;
    if (top - pad < scroller.scrollTop) next = top - pad;
    else if (bottom + FADE > scroller.scrollTop + scroller.clientHeight) next = bottom + FADE - scroller.clientHeight;
    if (next !== null) scroller.scrollTo({ top: next, behavior: reduced ? 'instant' : 'smooth' });
  }, [state.versionId, reduced]);

  // The bottom fade only shows while there is more below.
  const [atEnd, onScroll] = useScrollEnd(scrollerRef, [groups]);

  const onSearchKey = event => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    } else if (event.key === 'Escape') {
      // Nothing typed: Esc leaves the field, like the version number's. The next Esc then closes the panel.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
    } else if (event.key === 'Enter' && shown.length) {
      event.preventDefault();
      dispatch({ type: 'selectVersion', id: shown[0].id });
    }
  };

  const countFor = version => {
    if (exploring && version.id === state.versionId) return review.status === 'ready' ? review.summary : null;
    return counts.get(version.id) ?? null;
  };

  return (
    <div className="versions">
      {versions.length >= SEARCH_FROM && (
        <label className="search">
          <SearchIcon />
          <input
            className="search-input"
            type="search"
            placeholder="Find a version"
            aria-label="Find a version by number or name"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
      )}
      <div ref={scrollerRef} className="version-list" data-end={atEnd || undefined} onScroll={onScroll}>
        {groups.length === 0 && (
          <p className="list-note">No version matches “{query.trim()}”</p>
        )}
        {groups.map(group => (
          <section key={group.label} className="vgroup" aria-label={group.label}>
            <h3 className={`vgroup-label${/\d/.test(group.label) ? ' num' : ''}`}>{group.label}</h3>
            {group.versions.map(version => {
              const selected = version.id === state.versionId;
              const count = countFor(version);
              return (
                <button
                  key={version.id}
                  type="button"
                  className="vrow"
                  data-version={version.id}
                  aria-current={selected || undefined}
                  title={version.name}
                  onClick={() => { if (!selected) dispatch({ type: 'selectVersion', id: version.id }); }}
                >
                  <span className="vrow-n num">{versionNumber(version)}</span>
                  <span className="vrow-name">{version.name}</span>
                  <span className="vrow-time num">{timeOf(version)}</span>
                  <span className="vrow-count num" data-zero={count?.total === 0 || undefined}>
                    {count && <span className="vrow-count-in" aria-label={`${count.total} ${count.total === 1 ? 'change' : 'changes'}`}>{count.total}</span>}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
