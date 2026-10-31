// Pure helpers shared by the save (history.js, in node) and the service worker (sw.js, in the browser).
// Plain ES module with no imports, so the browser loads it as is from /afterimage/map.js.

const served = '/afterimage';
const versionId = /^v[1-9]\d*$/;

// The viewer, the runtime and the saved versions: everything Afterimage itself serves.
export const isServedPath = pathname => pathname === served || pathname.startsWith(`${served}/`);

// The version a document lives in, from its path: /afterimage/versions/v3/... -> 'v3'. Anything else -> null.
export function versionInPath(pathname) {
  const match = /^\/afterimage\/versions\/(v[1-9]\d*)\//.exec(pathname);
  return match ? match[1] : null;
}

// Where a request from a version's document really lives. A built app asks for /assets/x.js as if it were at the
// root; from v3 that is /afterimage/versions/v3/assets/x.js. Requests already under /afterimage/ (relative URLs,
// the runtime itself) and requests from a client of no known version pass through unchanged. Takes a root path
// or an absolute URL and returns the same kind. The caller checks the origin.
export function mapRequest({ clientVersion, url }) {
  if (typeof clientVersion !== 'string' || !versionId.test(clientVersion)) return url;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
  const parsed = new URL(url, 'http://afterimage.invalid');
  if (isServedPath(parsed.pathname)) return url;
  parsed.pathname = `${served}/versions/${clientVersion}${parsed.pathname}`;
  return absolute ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

// The one tag a save adds to each page. A classic script, so it runs before anything else on the page.
export const frameTag = id => `<script src="/afterimage/frame.js" data-afterimage-version="${id}"></script>`;
const savedTag = /<script src="\/afterimage\/frame\.js" data-afterimage-version="v[1-9]\d*"><\/script>/;

// Everything that may sit before <head> in a page: a byte order mark (as a character, or as UTF-8 bytes read as
// latin1, which is how a save reads them), white space, comments, <?...?> and the doctype.
const bom = /^(?:\uFEFF|\xEF\xBB\xBF)/;
const space = /^[\t\n\f\r ]+/;
const prolog = /^(?:<!--[\s\S]*?-->|<\?[^>]*>|<!doctype[^>]*>)/i;
// An open tag with any attributes, quoted values may hold ">". The lookahead keeps <header> from counting as <head>.
const openTag = name => new RegExp(`^<${name}(?=[\\t\\n\\f\\r />])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'i');
const htmlTag = openTag('html');
const headTag = openTag('head');

// Puts the frame tag first in <head>, inserting it and changing no other byte. Without a <head> tag it goes right
// after <html ...>, else after the doctype and any comments, else at the start; the parser puts it in the head either
// way. A page that already has the tag (saved from a version's own files) only has its version id updated, so a tag
// is never doubled and the same build always injects to the same bytes.
export function injectFrameScript(html, id) {
  if (savedTag.test(html)) return html.replace(savedTag, frameTag(id));
  let position = bom.exec(html)?.[0].length ?? 0;
  let insertAt = position;
  const skip = pattern => {
    const match = pattern.exec(html.slice(position));
    if (match) position += match[0].length;
    return Boolean(match);
  };
  const skipProlog = () => {
    for (;;) {
      skip(space);
      if (!skip(prolog)) return;
      insertAt = position;
    }
  };
  skipProlog();
  if (skip(htmlTag)) {
    insertAt = position;
    skipProlog();
  }
  if (skip(headTag)) insertAt = position;
  return html.slice(0, insertAt) + frameTag(id) + html.slice(insertAt);
}
