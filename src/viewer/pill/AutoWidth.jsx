import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useTransitions } from '../motion.js';

// Animates its own width to fit its content, so the segments beside it slide instead of jumping. While it moves it
// clips what doesn't fit yet; at rest it doesn't, so a hint can still show outside it.
export default function AutoWidth({ ref, className, children, ...rest }) {
  const t = useTransitions();
  const innerRef = useRef(null);
  const [width, setWidth] = useState(null);
  // Measure after every render, before paint, so a content swap and its width change start on the same frame.
  // The observer catches changes that don't come from a render (fonts loading).
  useLayoutEffect(() => {
    const next = innerRef.current.offsetWidth;
    setWidth(current => (current === next ? current : next));
  });
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const observer = new ResizeObserver(() => setWidth(inner.offsetWidth));
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  const outer = useRef(null);
  const clip = moving => () => { if (outer.current) outer.current.style.overflow = moving ? 'hidden' : ''; };
  const setRefs = element => {
    outer.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };
  return (
    <motion.div
      {...rest}
      ref={setRefs}
      className={className}
      initial={false}
      animate={{ width: width ?? 'auto' }}
      transition={t.layout}
      onAnimationStart={clip(true)}
      onAnimationComplete={clip(false)}
    >
      <div ref={innerRef} className="auto-width-inner">{children}</div>
    </motion.div>
  );
}
