// Viewer state. Pure: no React, no DOM.
// changeIndex points into the *filtered* change list, so anything that can change
// that list (version, base, mode, filter) resets it to null.
import { parseUrl } from './url.js';
import { indexOfVersion, previousVersion } from './versions.js';
import { ZOOMS } from '../stage/zoom.js';

const DEFAULTS = {
  versionId: '',
  mode: 'explore',
  baseId: null,
  layout: 'wipe',
  highlights: false,
  changeIndex: null,
  changeFilter: 'all',
  panelOpen: false,
  folders: { versions: false, changes: false },
  syncScroll: true,
  zoom: 'fit', // side by side: 'fit', '75' or '100'
  peek: false,
  pick: 0, // counts explicit picks (a row or a badge), so picking the selected change again still scrolls to it
  retracted: false, // the pill is put away in the corner, and the page shows no outlines
};

// A change number past the list (a link's ?change=99, or a list that shrank) selects nothing. Only a ready
// review knows the list, so while it is checking, or after it failed, the number is kept.
export function clampChange(changeIndex, total, status) {
  if (status !== 'ready' || changeIndex === null || changeIndex === undefined) return changeIndex ?? null;
  return changeIndex < total ? changeIndex : null;
}

export function initialState(versions, search) {
  return { ...DEFAULTS, folders: { ...DEFAULTS.folders }, versionId: versions[0].id, ...parseUrl(search, versions) };
}

// Explore compares against the previous version; compare uses the chosen baseline.
export function comparisonBase(versions, state) {
  const id = state.mode === 'compare' ? state.baseId : previousVersion(versions, state.versionId)?.id;
  return versions.find(version => version.id === id) ?? null;
}

// Versions are newest first, so an older version sits further down the list.
function isOlder(versions, id, than) {
  const index = indexOfVersion(versions, id);
  return index !== -1 && index > indexOfVersion(versions, than);
}

function selectVersion(versions, state, id) {
  if (indexOfVersion(versions, id) === -1) return state;
  const next = { ...state, versionId: id, changeIndex: null };
  // The baseline is always older than the target, so Before and After stay true.
  if (state.mode === 'compare' && (state.baseId === null || !isOlder(versions, state.baseId, id))) {
    const base = previousVersion(versions, id);
    next.baseId = base ? base.id : null;
    if (!base) next.mode = 'explore';
  }
  // Compare against a first version has nothing to compare to.
  if (next.mode === 'compare' && next.baseId === null) next.mode = 'explore';
  return next;
}

function setRetracted(state, retracted) {
  if (state.retracted === retracted) return state;
  return retracted ? { ...state, retracted: true, panelOpen: false } : { ...state, retracted: false };
}

// Framed over a live prototype, the viewer is that page with something on top. The latest version with nothing on top
// is the page itself, so the viewer gives the page back. Layout, zoom and filter are only remembered for next time.
export function showsLivePage(state, versions) {
  return state.versionId === versions[0].id && state.mode === 'explore' && !state.highlights && !state.panelOpen;
}

// The page pill's buttons: 'highlight', 'compare' or 'versions'. Whatever the viewer was left in, it opens on the
// latest version in that one state. A first version has nothing to highlight or compare, so it shows the list.
function openFromPage(versions, state, view) {
  const base = previousVersion(versions, versions[0].id);
  const shown = base ? view : 'versions';
  return {
    ...state,
    versionId: versions[0].id,
    mode: shown === 'compare' ? 'compare' : 'explore',
    baseId: shown === 'compare' ? base.id : null,
    highlights: shown === 'highlight',
    panelOpen: shown === 'versions',
    folders: shown === 'versions' ? { ...state.folders, versions: true } : state.folders,
    changeIndex: null,
    peek: false,
    retracted: false,
  };
}

export const reducer = versions => (state, action) => {
  switch (action.type) {
    case 'openFromPage':
      return openFromPage(versions, state, action.view);

    case 'selectVersion':
      return selectVersion(versions, state, action.id);

    // delta +1 is newer, -1 is older. At either end nothing moves, so nothing resets either.
    case 'stepVersion': {
      const index = indexOfVersion(versions, state.versionId);
      const target = versions[Math.min(versions.length - 1, Math.max(0, index - action.delta))];
      if (target.id === state.versionId) return state;
      return selectVersion(versions, state, target.id);
    }

    case 'goLatest':
      return selectVersion(versions, state, versions[0].id);

    case 'setMode': {
      if (action.mode === 'compare') {
        // Already comparing: keep the baseline the visitor chose.
        if (state.mode === 'compare') return state;
        const base = previousVersion(versions, state.versionId);
        return base
          ? { ...state, mode: 'compare', baseId: base.id, changeIndex: null }
          : { ...state, mode: 'explore', baseId: null, changeIndex: null };
      }
      return { ...state, mode: 'explore', baseId: null, changeIndex: null };
    }

    case 'setBase':
      if (state.mode !== 'compare' || !isOlder(versions, action.id, state.versionId)) return state;
      return { ...state, baseId: action.id, changeIndex: null };

    case 'setLayout':
      return { ...state, layout: action.layout };

    case 'setZoom':
      return ZOOMS.includes(action.zoom) ? { ...state, zoom: action.zoom } : state;

    case 'toggleHighlights':
      return { ...state, highlights: !state.highlights };

    case 'stepChange': {
      if (!(action.total > 0)) return state;
      const { total, delta } = action;
      const changeIndex = state.changeIndex === null
        ? (delta > 0 ? 0 : total - 1)
        : (state.changeIndex + delta + total) % total;
      return { ...state, changeIndex };
    }

    case 'selectChange':
      return { ...state, changeIndex: action.index, pick: (state.pick ?? 0) + 1 };

    case 'clearChange':
      return state.changeIndex === null ? state : { ...state, changeIndex: null };

    case 'clampChange': {
      const changeIndex = clampChange(state.changeIndex, action.total, action.status);
      return changeIndex === state.changeIndex ? state : { ...state, changeIndex };
    }

    case 'setFilter':
      return { ...state, changeFilter: action.filter, changeIndex: null };

    case 'togglePanel':
      return { ...state, panelOpen: !state.panelOpen };

    case 'closePanel':
      return { ...state, panelOpen: false };

    case 'toggleFolder': {
      const opening = !state.folders[action.folder];
      const folders = { ...state.folders, [action.folder]: opening };
      if (opening && action.phone) {
        for (const name of Object.keys(folders)) if (name !== action.folder) folders[name] = false;
      }
      return { ...state, folders };
    }

    // A phone shows one folder at a time. Crossing to phone width with both open keeps the changes.
    case 'oneFolder':
      return state.folders.versions && state.folders.changes
        ? { ...state, folders: { ...state.folders, versions: false } }
        : state;

    case 'toggleSync':
      return { ...state, syncScroll: !state.syncScroll };

    case 'setPeek':
      return state.peek === action.peek ? state : { ...state, peek: action.peek };

    // Putting the pill away closes the panel. Highlights keep their setting, so they show again when it comes back.
    case 'setRetracted':
      return setRetracted(state, action.retracted);

    case 'toggleRetracted':
      return setRetracted(state, !state.retracted);

    default:
      return state;
  }
};
