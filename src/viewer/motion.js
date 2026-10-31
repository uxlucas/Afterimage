// Shared motion values. Enter is ease-out, exit is ~20% faster, layout moves are a spring with no bounce.
import { useReducedMotion } from 'motion/react';

export const transitions = {
  enter: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  exit: { duration: 0.17, ease: [0.22, 1, 0.36, 1] },
  layout: { type: 'spring', duration: 0.25, bounce: 0 },
};

const instant = { duration: 0 };
const still = { enter: instant, exit: instant, layout: instant };

// The transitions to use right now: all instant when the visitor asks for reduced motion.
export function useTransitions() {
  return useReducedMotion() ? still : transitions;
}
