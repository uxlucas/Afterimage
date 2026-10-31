// The frame runtime, served at /afterimage/frame.js. A save puts it first in every saved page's <head>, as
// <script src="/afterimage/frame.js" data-afterimage-version="vN">, so it runs before any of the app's own scripts.
// It is a classic script for that reason, and so it cannot import map.js; the one mapping it needs is inlined.
// sw.js explains the approach and its limits.
(() => {
  const version = document.currentScript?.dataset.afterimageVersion;
  const prefix = `/afterimage/versions/${version}`;
  if (!version || !location.pathname.startsWith(`${prefix}/`)) return;
  // The viewer reads this to tell which version a frame holds, since the URL below no longer says.
  window.__afterimageVersion = version;

  // The app's own path at the root, so its router matches: .../vN/index.html -> /, .../vN/about/index.html -> /about/,
  // .../vN/two.html -> /two.html. Relative URLs now resolve against it too; the worker maps the result back.
  const own = location.pathname.slice(prefix.length).replace(/(^|\/)index\.html$/, '$1');
  history.replaceState(history.state, '', own + location.search + location.hash);

  // Where a navigation to `href` belongs: same-origin paths outside /afterimage/ move into this version. Anything
  // else (another origin, the viewer, a path already in a version) is left alone and gets null. So are blob:, data:
  // and other non-http URLs: a blob: URL has this page's origin but no path to move, and would come back unchanged.
  const inVersion = href => {
    const url = new URL(href, location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin !== location.origin || url.pathname === '/afterimage' || url.pathname.startsWith('/afterimage/')) return null;
    url.pathname = prefix + url.pathname;
    return url.href;
  };

  // A page navigation to /about is outside the worker's scope, so it would load the live app. The Navigation API
  // sees every one (links, location.assign and href, forms) and is the only way to catch location.assign, which
  // cannot be patched. Same-document navigations (a router's pushState) are left alone, and so are traversals,
  // downloads and POST forms, which cannot be re-sent elsewhere.
  if (window.navigation) {
    navigation.addEventListener('navigate', event => {
      if (event.destination.sameDocument || !event.cancelable || event.navigationType === 'traverse' || event.downloadRequest !== null || event.formData) return;
      const target = inVersion(event.destination.url);
      // Redirecting to where it already goes would only start this handler again.
      if (!target || target === event.destination.url) return;
      event.preventDefault();
      const redirect = navigation.navigate(target, { history: event.navigationType === 'push' ? 'auto' : 'replace' });
      // Both reject when the redirect is cut short (the viewer moves the frame meanwhile); that is not the app's error.
      redirect.committed.catch(() => {});
      redirect.finished.catch(() => {});
    });
    return;
  }

  // Without the Navigation API only plain link clicks can be caught. This listens on window in the bubble phase, so
  // it runs after the app's own handlers and leaves alone any click a router already took (defaultPrevented).
  window.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || typeof link.href !== 'string' || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const target = inVersion(link.href);
    if (!target) return;
    event.preventDefault();
    location.assign(target);
  });
})();
