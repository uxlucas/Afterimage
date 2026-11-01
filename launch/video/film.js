// Loaded by stage.html. Adds the caption layer, a drawn cursor and the end card over the viewer.
// None of this ships with the viewer; record.mjs drives it through window.film.
(() => {
  const END_TITLE = 'Afterimage';
  const END_LINE = 'Version history for prototypes.';
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

  const style = document.createElement('style');
  style.textContent = `
    .film-layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .film-caption { position: absolute; left: 0; right: 0; top: 0; height: 140px; display: grid; align-content: center; justify-items: center; gap: 6px; text-align: center; }
    .film-caption [data-line] { opacity: 0; transform: translateY(8px); filter: blur(4px);
      transition: opacity 420ms ${EASE_OUT}, transform 420ms ${EASE_OUT}, filter 420ms ${EASE_OUT}; }
    .film-caption[data-in] [data-line] { opacity: 1; transform: none; filter: none; }
    .film-caption[data-in] [data-line="sub"] { transition-delay: 90ms; }
    .film-caption[data-out] [data-line] { opacity: 0; transform: translateY(-4px); filter: blur(2px); transition-duration: 220ms; transition-delay: 0ms; }
    .film-title { font-size: 30px; line-height: 1.15; font-weight: 600; letter-spacing: -0.02em; color: #111; }
    .film-sub { font-size: 18px; line-height: 1.3; color: #6e6e6e; letter-spacing: -0.005em; }
    .film-cursor { position: absolute; left: 0; top: 0; width: 24px; height: 24px; will-change: transform;
      filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.28)); opacity: 0; transition: opacity 300ms ${EASE_OUT}; }
    .film-cursor[data-on] { opacity: 1; }
    .film-cursor svg { display: block; transform-origin: 3px 3px; transition: transform 120ms ${EASE_OUT}; }
    .film-cursor[data-down] svg { transform: scale(0.86); }
    .film-end { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; background: #fff;
      opacity: 0; transition: opacity 600ms ${EASE_OUT}; }
    .film-end[data-in] { opacity: 1; }
    .film-end-title { font-size: 46px; font-weight: 600; letter-spacing: -0.03em; color: #111; }
    .film-end-line { font-size: 19px; color: #6e6e6e; }
    .film-end > * { opacity: 0; transform: translateY(8px); transition: opacity 500ms ${EASE_OUT} 200ms, transform 500ms ${EASE_OUT} 200ms; }
    .film-end[data-in] > * { opacity: 1; transform: none; }
    .film-end[data-in] > .film-end-line { transition-delay: 300ms; }
  `;
  document.head.append(style);

  const layer = document.createElement('div');
  layer.className = 'film-layer';
  layer.innerHTML = `
    <div class="film-end"><div class="film-end-title"></div><div class="film-end-line"></div></div>
    <div class="film-cursor">
      <svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2.5v16.2l4.3-4.1 2.8 6.3 2.9-1.3-2.8-6.2h6.1z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>
    </div>`;
  document.body.append(layer);
  const cursor = layer.querySelector('.film-cursor');
  const end = layer.querySelector('.film-end');
  end.querySelector('.film-end-title').textContent = END_TITLE;
  end.querySelector('.film-end-line').textContent = END_LINE;

  let caption = null;
  const at = { x: 0, y: 0 };
  const place = (x, y, ms) => {
    cursor.style.transition = `opacity 300ms ${EASE_OUT}, transform ${ms}ms ${EASE_IN_OUT}`;
    cursor.style.transform = `translate(${x - 3}px, ${y - 3}px)`;
    at.x = x; at.y = y;
  };

  window.film = {
    caption(title, sub) {
      window.film.clearCaption();
      const node = document.createElement('div');
      node.className = 'film-caption';
      node.innerHTML = '<div class="film-title" data-line="title"></div>' + (sub ? '<div class="film-sub" data-line="sub"></div>' : '');
      node.querySelector('.film-title').textContent = title;
      if (sub) node.querySelector('.film-sub').textContent = sub;
      layer.prepend(node);
      node.getBoundingClientRect(); // start from the hidden state
      node.dataset.in = '';
      caption = node;
    },
    clearCaption() {
      if (!caption) return;
      const old = caption;
      caption = null;
      old.dataset.out = '';
      setTimeout(() => old.remove(), 300);
    },
    showCursor(x, y) { place(x, y, 0); cursor.dataset.on = ''; },
    hideCursor() { delete cursor.dataset.on; },
    glide(x, y, ms) { place(x, y, ms); },
    jump(x, y) { place(x, y, 0); },
    press(down) { if (down) cursor.dataset.down = ''; else delete cursor.dataset.down; },
    endCard() { window.film.clearCaption(); window.film.hideCursor(); end.dataset.in = ''; },
  };
})();
