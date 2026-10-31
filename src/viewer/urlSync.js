// The one URL writer for the page. App writes every state change through it; Copy link flushes it first, so the
// link it copies is never a coalescing interval behind.
import { createUrlWriter } from './state/urlWriter.js';

export const urlWriter = createUrlWriter({ history: window.history, location: window.location });
