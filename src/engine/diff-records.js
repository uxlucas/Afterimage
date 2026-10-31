export function compareRecords(current, previous, grouped = true) {
  const oldByKey = new Map(previous.map(record => [record.key, record]));
  const newByKey = new Map(current.map(record => [record.key, record]));
  const now = [], before = [];
  for (const record of current) {
    const old = oldByKey.get(record.key);
    if (!old) { now.push({ ...record, kind: 'added', reasons: ['content'] }); continue; }
    const reasons = [];
    if (record.text !== old.text || record.attributes !== old.attributes) reasons.push('content');
    if (record.style !== old.style) reasons.push('style');
    if (!record.page && ['x', 'y', 'width', 'height'].some(key => Math.abs(record.rect[key] - old.rect[key]) > 2)) reasons.push('layout');
    if (reasons.length) {
      now.push({ ...record, kind: 'changed', reasons });
      before.push({ ...old, kind: 'changed', reasons });
    }
  }
  for (const record of previous) {
    if (!newByKey.has(record.key)) before.push({ ...record, kind: 'removed', reasons: ['content'] });
  }
  return grouped ? groupChanges({ current: now, previous: before }) : { current: now, previous: before };
}

// Folds a change into its nearest changed ancestor of the same kind, so a changed section is one region.
function groupChanges({ current, previous }) {
  const group = records => {
    const parents = new Map(records.filter(record => !record.page).map(record => [record.key, record.kind]));
    return records.filter(record => !record.ancestors.some(key => parents.get(key) === record.kind));
  };
  return { current: group(current), previous: group(previous) };
}

const propertyNames = { color: 'Text color', backgroundColor: 'Background color', backgroundImage: 'Background image', fontFamily: 'Typeface', fontSize: 'Text size', fontWeight: 'Text weight', lineHeight: 'Line spacing', letterSpacing: 'Letter spacing', textAlign: 'Text alignment', borderRadius: 'Corner rounding', boxShadow: 'Shadow', gap: 'Space between items', opacity: 'Opacity', transform: 'Transform' };
const propertyLabel = key => propertyNames[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase());
const values = record => record?.styles || {};

export function buildReview(current, previous) {
  const raw = compareRecords(current, previous, false);
  const comparison = groupChanges(raw);
  const oldByKey = new Map(previous.map(record => [record.key, record]));
  const newByKey = new Map(current.map(record => [record.key, record]));
  const roots = [...comparison.current, ...comparison.previous.filter(record => record.kind === 'removed')];
  // Every raw change, filed under its own key and each ancestor's, so a region finds its members in one lookup.
  const membersOf = new Map();
  for (const record of [...raw.current, ...raw.previous.filter(record => record.kind === 'removed')]) {
    for (const key of new Set([record.key, ...record.ancestors])) {
      if (!membersOf.has(key)) membersOf.set(key, []);
      membersOf.get(key).push(record);
    }
  }
  const entries = roots.map(root => {
    const before = oldByKey.get(root.key), after = newByKey.get(root.key);
    const details = [];
    const members = membersOf.get(root.key) ?? [];
    if (root.kind !== 'changed') {
      details.push({ label: root.kind === 'added' ? 'Added to this version' : 'Removed from this version', before: before?.content || '', after: after?.content || '' });
    } else {
      for (const member of members) {
        const old = oldByKey.get(member.key), now = newByKey.get(member.key);
        const subject = member.key === root.key ? '' : (member.label || 'Element') + ' · ';
        if (!old || !now) {
          details.push({ label: subject + (!old ? 'Added' : 'Removed'), before: old?.content || '', after: now?.content || '' });
          continue;
        }
        if (old.text !== now.text) details.push({ label: subject + 'Text', before: old.text, after: now.text });
        for (const key of Object.keys(now.attrs || {})) {
          if (old.attrs?.[key] !== now.attrs[key]) details.push({ label: subject + ({ src: 'Image source', alt: 'Image description', href: 'Link destination', placeholder: 'Input hint', 'aria-label': 'Accessible label', type: 'Input type', drawing: 'Icon' }[key] || key), before: key === 'drawing' ? 'Previous icon' : old.attrs?.[key] || '', after: key === 'drawing' ? 'Updated icon' : now.attrs[key] });
        }
        for (const [key, value] of Object.entries(values(now))) {
          if (values(old)[key] !== value) details.push({ label: subject + propertyLabel(key), before: values(old)[key] || 'None', after: value, color: /Color$|^color$/.test(key) });
        }
      }
      if (before && after && !root.page) {
        const old = before.rect, now = after.rect;
        if (Math.abs(old.x - now.x) > 2 || Math.abs(old.y - now.y) > 2) details.push({ label: 'Position on the page', layout: true, before: `${Math.round(old.x)}px from left, ${Math.round(old.y)}px from top`, after: `${Math.round(now.x)}px from left, ${Math.round(now.y)}px from top` });
        if (Math.abs(old.width - now.width) > 2 || Math.abs(old.height - now.height) > 2) details.push({ label: 'Size', layout: true, before: `${Math.round(old.width)} × ${Math.round(old.height)}px`, after: `${Math.round(now.width)} × ${Math.round(now.height)}px` });
      }
    }
    const layoutOnly = members.every(member => member.kind === 'changed' && member.reasons.every(reason => reason === 'layout'));
    const kindLabel = root.kind === 'added' ? 'Added' : root.kind === 'removed' ? 'Removed' : layoutOnly ? 'Moved or resized' : members.some(member => member.reasons.includes('content')) ? 'Content changed' : 'Appearance changed';
    return { key: root.key, kind: root.kind, label: after?.label || before?.label || 'Page element', kindLabel, layoutOnly, before, after, details };
  });
  // Put content and appearance first; downstream layout shifts remain available.
  entries.sort((a, b) => Number(a.layoutOnly) - Number(b.layoutOnly));
  entries.forEach((entry, index) => { entry.number = index + 1; });
  return { entries, comparison };
}
