import { useLayoutEffect, useRef } from 'react';
import { replaceFrame } from '../frames.js';

// One saved prototype in a same-origin iframe. A hidden frame stays mounted and laid out, so the
// review can keep reading it; it is only taken out of sight and out of reach.
// The first version is the iframe's src. A later one replaces the page in place (replaceFrame says why), so src
// keeps naming the page the iframe first loaded.
export default function Frame({ frameRef, version, role, visible, compare }) {
  const first = useRef(version.file);
  const shown = useRef(version.file);
  useLayoutEffect(() => {
    if (shown.current === version.file) return;
    shown.current = version.file;
    replaceFrame(frameRef.current, new URL(version.file, location.href).href);
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
