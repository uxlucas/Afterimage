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

// Where a version's entry page sits once the frame runtime has rewritten its URL to the app's own path, the same way
// frame.js does: versions/v2/index.html -> /, versions/v2/nested/index.html -> /nested/.
export function entryPath(file) {
  return file.replace(/^versions\/[^/]+/, '').replace(/(^|\/)index\.html$/, '$1');
}

// True when `frame` has finished loading `version`'s own page, give or take a hash. A version saved with the frame
// runtime names itself, and its URL is the app's own path, so both must match: another page or route of the same
// version is not the page being compared. frame.js records where the app settled before the person touched the
// frame (__afterimagePath), so an app that redirects on load still counts, and the file the document came from
// (__afterimageFile), so a page reached by a hard link does not. A frame.js without them is held to the entry
// page's path. Versions saved before the runtime (Northwind) are told apart by URL.
export function showsVersion(frame, version, baseHref = globalThis.location?.href) {
  if (!version) return false;
  const win = frameWindow(frame);
  if (!win || win.document.readyState !== 'complete') return false;
  if (win.__afterimageVersion !== undefined) {
    if (win.__afterimageVersion !== version.id) return false;
    const here = win.location.pathname + win.location.search;
    if (win.__afterimagePath === undefined) return here === entryPath(version.file);
    try {
      return here === win.__afterimagePath && win.__afterimageFile === new URL(version.file, baseHref).pathname;
    } catch {
      return false;
    }
  }
  try {
    return sameDocument(win.location.href, new URL(version.file, baseHref).href);
  } catch {
    return false;
  }
}

// Moves `frame` to `url` without adding a history entry. Changing src would add one, and Back would then take the
// frame to its previous page by the URL the frame runtime rewrote it to (the app's own path), which is the live app.
// location.replace is allowed on a window that went cross-origin too.
export function replaceFrame(frame, url) {
  const win = frame?.contentWindow;
  if (win) win.location.replace(url);
  else if (frame) frame.src = url;
}

// Runs `fn`, ignoring a SecurityError from a window that went cross-origin since it was bound.
export function quietly(fn) {
  try {
    fn();
  } catch {
    // the window navigated away; there is nothing left to clean up on our side
  }
}
