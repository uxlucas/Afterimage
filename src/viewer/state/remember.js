// Whether the pill is put away, remembered in the visitor's browser and never in a link.
// If storage is unavailable (private window, blocked site data) the pill just starts out; never an error.
export function rememberRetracted(getStorage, key = 'afterimage-retracted') {
  return {
    read() {
      try {
        return getStorage().getItem(key) === '1';
      } catch {
        return false;
      }
    },
    write(retracted) {
      try {
        const storage = getStorage();
        if (retracted) storage.setItem(key, '1');
        else storage.removeItem(key);
      } catch {
        // storage is unavailable: the choice lasts for this visit
      }
    },
  };
}
