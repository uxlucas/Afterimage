// One saved prototype in a same-origin iframe. A hidden frame stays mounted and laid out, so the
// review can keep reading it; it is only taken out of sight and out of reach.
export default function Frame({ frameRef, version, role, visible, compare }) {
  const title = role === 'base'
    ? `${compare ? 'Before' : 'Previous version'}, ${version.label}`
    : `${compare ? 'After' : 'Prototype'}, ${version.label}`;
  return (
    <iframe
      ref={frameRef}
      className="frame"
      data-role={role}
      data-visible={visible}
      src={version.file}
      title={title}
      inert={!visible}
      tabIndex={visible ? undefined : -1}
      aria-hidden={visible ? undefined : true}
    />
  );
}
