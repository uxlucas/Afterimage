import { useSyncExternalStore } from 'react';

export { useReducedMotion } from 'motion/react';

function useMedia(query) {
  return useSyncExternalStore(
    notify => {
      const list = matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

export const PHONE_QUERY = '(max-width: 640px)';

export function usePhone() {
  return useMedia(PHONE_QUERY);
}
