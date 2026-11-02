import { useLayoutEffect, useRef } from 'react';
import { replaceFrame, withRoute } from '../frames.js';
import { route } from '../state/route.js';

// One saved prototype in a same-origin iframe. A hidden frame stays mounted and laid out, so the
// review can keep reading it; it is only taken out of sight and out of reach.
// The first version is the iframe's src. A later one replaces the page in place (replaceFrame says why), so src
// keeps naming the page the iframe first loaded. Either way the version opens on the route the viewer shows.
export default function Frame({ frameRef, version, role, visible, compare }) {
  const first = useRef(withRoute(version.file, route.get()));
  const shown = useRef(version.file);
  useLayoutEffect(() => {
    if (shown.current === version.file) return;
    shown.current = version.file;
    replaceFrame(frameRef.current, withRoute(new URL(version.file, location.href).href, route.get()));
  }, [frameRef, version.file]);
  const title = role === 'base'
    ? `${compare ? 'Before' : 'Previous version'}, ${version.label}`
    : `${compare ? 'After' : 'Prototype'}, ${version.label}`;
  return (
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
  );
}
