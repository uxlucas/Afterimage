// A file that something else holds open (a static server, an indexer, Windows antivirus scanning a file just written)
// often frees itself within a moment, so an operation that hits one is tried once more before giving up.
const lockedCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);

export const isLocked = error => lockedCodes.has(error?.code);

// Runs operation, and once more after delayMs when it fails on a locked file. The second failure is thrown as it is.
export async function retryLocked(operation, delayMs = 250) {
  try {
    return await operation();
  } catch (error) {
    if (!isLocked(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return operation();
  }
}
