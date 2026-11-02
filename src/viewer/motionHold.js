// Heavy work (a review's capture of both pages) runs on the same thread as the stage's motion, so started mid-glide
// it freezes the glide halfway and the frames land in one jump. A big move holds that work for its length.
let until = 0;

export function holdWork(ms, now = performance.now()) {
  until = Math.max(until, now + ms);
}

// How much longer work should wait, in ms: 0 when nothing is moving.
export function workHeldFor(now = performance.now()) {
  return Math.max(0, until - now);
}
