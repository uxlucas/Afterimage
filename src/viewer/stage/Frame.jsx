import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { frameWindow, quietly, replaceFrame, withRoute } from '../frames.js';
import { route } from '../state/route.js';
import { matchScroll } from './scrollSync.js';

const FADE_MS = 180;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SETTLE_FRAMES = 30; // a page still changing size after half a second shows as it is
const STUCK_MS = 8000; // a version that never loads stops covering the frame

// Calls `fn` once a just-loaded page has drawn: its height has held for two frames (an app renders after load).
function whenSettled(win, fn) {
  let last = -1, still = 0, frames = 0;
  const tick = () => {
    let height = 0;
    quietly(() => { height = win.document.documentElement.scrollHeight + win.document.body.childElementCount; });
    still = height === last ? still + 1 : 0;
    last = height;
    if (still >= 2 || ++frames >= SETTLE_FRAMES) fn();
    else win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
}

// The next version, loaded over the frame and lined up with where the frame is scrolled, then faded in. It is only
// a picture: it takes no input and nothing reads it.
function Cover({ url, from, title, visible, onCovered }) {
  const ref = useRef(null);
  const onLoad = () => {
    const cover = ref.current, win = frameWindow(cover);
    if (!win) return;
    whenSettled(win, () => {
      const old = frameWindow(from.current);
      if (old) quietly(() => matchScroll(win, old));
      const fade = cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE_OUT, fill: 'forwards' });
      fade.onfinish = () => onCovered(win);
    });
  };
  return <iframe ref={ref} className="frame frame-cover" data-visible={visible} src={url} title={title} aria-hidden="true" tabIndex={-1} inert onLoad={onLoad} />;
}

// One saved prototype in a same-origin iframe. A hidden frame stays mounted and laid out, so the
// review can keep reading it; it is only taken out of sight and out of reach.
// The first version is the iframe's src. A later one replaces the page in place (replaceFrame says why), so src
// keeps naming the page the iframe first loaded. Either way the version opens on the route the viewer shows.
// A frame in view never shows a blank page between versions: the next one crossfades in over it, where it was
// scrolled, and the frame moves underneath before the cover goes.
export default function Frame({ frameRef, version, role, visible, compare }) {
  const reduced = useReducedMotion();
  const first = useRef(withRoute(version.file, route.get()));
  const shown = useRef(version.file);
  const [covers, setCovers] = useState([]); // newest last, on top
  const latest = useRef(0);
  const live = useRef({ visible, reduced });
  live.current = { visible, reduced };

  useLayoutEffect(() => {
    if (shown.current === version.file) return;
    shown.current = version.file;
    const url = withRoute(new URL(version.file, location.href).href, route.get());
    const id = ++latest.current;
    if (!live.current.visible || live.current.reduced || !frameWindow(frameRef.current)) {
      setCovers([]);
      replaceFrame(frameRef.current, url);
      return;
    }
    setCovers(list => [...list, { id, url }]);
  }, [frameRef, version.file]);

  // A cover is fully in: the ones under it can go, and the frame moves to its version underneath. Once the frame has
  // drawn there, at the cover's scroll, the cover goes; the two look the same, so that doesn't show.
  const covered = (id, url) => coverWin => {
    setCovers(list => list.filter(cover => cover.id >= id));
    if (id !== latest.current) return;
    const frame = frameRef.current;
    let stuck = 0;
    const done = () => {
      clearTimeout(stuck);
      frame.removeEventListener('load', onLoad);
      if (id === latest.current) setCovers([]);
    };
    const onLoad = () => {
      const win = frameWindow(frame);
      if (!win || id !== latest.current) { done(); return; }
      whenSettled(win, () => {
        quietly(() => matchScroll(win, coverWin));
        win.requestAnimationFrame(done);
      });
    };
    frame.addEventListener('load', onLoad);
    stuck = setTimeout(done, STUCK_MS);
    replaceFrame(frame, url);
  };

  const title = role === 'base'
    ? `${compare ? 'Before' : 'Previous version'}, ${version.label}`
    : `${compare ? 'After' : 'Prototype'}, ${version.label}`;
  return (
    <>
      <iframe
        ref={frameRef}
        className="frame"
        data-role={role}
        data-visible={visible}
        src={first.current}
        title={title}
        inert={!visible}
        tabIndex={visible ? undefined : -1}
        aria-hidden={visible ? undefined : true}
      />
      {covers.map(cover => (
        <Cover key={cover.id} url={cover.url} from={frameRef} title={title} visible={visible} onCovered={covered(cover.id, cover.url)} />
      ))}
    </>
  );
}
