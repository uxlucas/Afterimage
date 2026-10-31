// Link parsing and writing: ?version=<id>&mode=explore|compare&base=<id>, plus layout, zoom, hl, filter and change.
// Pure: no React, no DOM.
import { indexOfVersion, previousVersion } from './versions.js';

const FILTERS = ['changed', 'added', 'removed'];
const ZOOMS = ['75', '100']; // Fit is the default, so it never appears in a link

// Returns only what the link can say. version, mode and base are always resolved
// against the history; layout, hl, filter and change appear only when the link has them.
export function parseUrl(search, versions) {
  const params = new URLSearchParams(search);
  const known = id => versions.some(version => version.id === id);
  const latest = versions[0];

  const asked = params.get('version');
  let versionId = asked && known(asked) ? asked : latest.id;

  let mode = params.get('mode') === 'compare' ? 'compare' : 'explore';
  let baseId = null;
  if (mode === 'compare') {
    const askedBase = params.get('base');
    if (askedBase && known(askedBase) && askedBase !== versionId) {
      // The baseline is always the older one (versions are newest first). A reversed pair is read the right way round.
      if (indexOfVersion(versions, askedBase) < indexOfVersion(versions, versionId)) [versionId, baseId] = [askedBase, versionId];
      else baseId = askedBase;
    } else {
      baseId = previousVersion(versions, versionId)?.id ?? null;
    }
    if (baseId === null) mode = 'explore';
  }

  const parsed = { versionId, mode, baseId };

  if (params.get('layout') === 'side') parsed.layout = 'side';
  if (ZOOMS.includes(params.get('zoom'))) parsed.zoom = params.get('zoom');
  if (params.get('hl') === '1') parsed.highlights = true;
  const filter = params.get('filter');
  if (FILTERS.includes(filter)) parsed.changeFilter = filter;
  const change = params.get('change');
  if (change && /^[1-9]\d*$/.test(change)) parsed.changeIndex = Number(change) - 1;
  return parsed;
}

// Returns '' for the default latest state, otherwise a string starting with '?'.
export function toSearch(state, versions) {
  const params = new URLSearchParams();
  const isDefaultView = state.versionId === versions[0].id && state.mode === 'explore';
  if (!isDefaultView) {
    params.set('version', state.versionId);
    params.set('mode', state.mode);
    if (state.mode === 'compare' && state.baseId) params.set('base', state.baseId);
  }
  if (state.layout === 'side') params.set('layout', 'side');
  // Zoom only means something side by side.
  if (state.layout === 'side' && ZOOMS.includes(state.zoom)) params.set('zoom', state.zoom);
  if (state.highlights) params.set('hl', '1');
  if (state.changeFilter && state.changeFilter !== 'all') params.set('filter', state.changeFilter);
  if (state.changeIndex !== null && state.changeIndex !== undefined) params.set('change', String(state.changeIndex + 1));
  const text = params.toString();
  return text ? `?${text}` : '';
}
