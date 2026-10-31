import { useCallback, useLayoutEffect, useState } from 'react';

// Whether a scroll box is at its end, so the list can fade its bottom edge only while there is more below.
// Returns [atEnd, onScroll]; pass `deps` that change the content so a new list is measured once it renders.
export function useScrollEnd(ref, deps) {
  const [atEnd, setAtEnd] = useState(true);
  const measure = useCallback(() => {
    const box = ref.current;
    if (!box) return;
    setAtEnd(box.scrollTop + box.clientHeight >= box.scrollHeight - 2);
  }, [ref]);
  useLayoutEffect(measure, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [atEnd, measure];
}
