// Safe access to a prototype frame's window. Pure enough for node:test: it only reads what it is given.
// A prototype frame can navigate anywhere (an external link, a site that refuses framing, a browser error page).
// Once it is cross-origin, reading its document, its scroll position or its location, or adding a listener to
// it, throws a SecurityError. Every frame-window touch goes through `frameWindow` first (Ruling 27).

// The frame's window if it is same-origin right now, else null.
export function frameWindow(frame) {
  const win = frame?.contentWindow;
  if (!win) return null;
  try {
    return win.document ? win : null;
  } catch {
    return null;
  }
}

// Origin, path and query of a URL: what decides which document a frame holds. The hash is left out, so an
// anchor link or a hash router inside the prototype still counts as the same page (I1).
export function withoutHash(href) {
  try {
    const url = new URL(href);
    return url.origin + url.pathname + url.search;
  } catch {
    return null;
  }
}

export function sameDocument(a, b) {
  const left = withoutHash(a);
  return left !== null && left === withoutHash(b);
}

// True when `frame` has finished loading `version`'s own page, give or take a hash.
export function showsVersion(frame, version, baseHref = globalThis.location?.href) {
  if (!version) return false;
  const win = frameWindow(frame);
  if (!win || win.document.readyState !== 'complete') return false;
  try {
    return sameDocument(win.location.href, new URL(version.file, baseHref).href);
  } catch {
    return false;
  }
}

// Runs `fn`, ignoring a SecurityError from a window that went cross-origin since it was bound.
export function quietly(fn) {
  try {
    fn();
  } catch {
    // the window navigated away; there is nothing left to clean up on our side
  }
}
