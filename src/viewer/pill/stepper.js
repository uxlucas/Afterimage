// The highlight stepper's words. Pure, for node:test.
// Under a filter other than All, the stepper names it ("Change 1 of 2 added"), so its count can't be read as
// the whole list's (Ruling 26).

const WORDS = { changed: 'changed', added: 'added', removed: 'removed' };

export function filterWord(filter) {
  return WORDS[filter] ?? '';
}

export function stepperLabel({ ready, changeIndex, total, filter }) {
  if (!ready) return 'Highlights on. Turn highlights off';
  const word = filterWord(filter);
  const position = changeIndex === null ? 'none selected' : changeIndex + 1;
  return `Highlights on, change ${position} of ${total}${word ? ` ${word}` : ''}. Turn highlights off`;
}
