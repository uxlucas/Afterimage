// The overlay: Afterimage's pill on the prototype itself, served at /afterimage/overlay.js and exported as
// afterimage-cli/overlay. One line adds it to an app: a script tag in plain HTML, or an import in a bundled app.
//
// It finds the history on its own and draws nothing when there is none:
// - on this machine, afterimage dev answers /afterimage/api/session, on the page's own origin (a plain prototype dev
//   serves itself) or on ports 4321 to 4330 (beside the app's own dev server). There the pill can also save.
// - on a built site, /afterimage/versions.json is next to the app, and the pill shows the history only.
// How this copy was loaded says which, so a built site never asks for a helper, even served from this machine:
// - a script tag dev served carries dev's stamp (window.__afterimageDev); any other script tag is a built site's copy.
// - an import has no currentScript. Bundlers replace process.env.NODE_ENV, so a production build says it is one.
// History opens the viewer as a layer over the page, in the same tab; the close button, Esc, or the viewer itself
// (it posts afterimage:close when it is framed) close it again.
//
// It is plain JavaScript with no imports, so it runs as a classic script and as a module, and it does nothing where
// there is no document (a server render of a bundled app). It draws in a shadow root, so the app's CSS can't reach it.
// It stays out of saved versions, which are builds of the same app: frame.js marks those pages before any app code
// runs, and any page in a frame is left alone too.
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__afterimageOverlay || window.__afterimageVersion) return;
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }
  window.__afterimageOverlay = true;

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
  const scriptTag = Boolean(document.currentScript);
  const servedByDev = window.__afterimageDev === true;
  let mode;
  try {
    // Written out in full so a bundler can replace it; with no bundler there is no process and this throws.
    mode = process.env.NODE_ENV;
  } catch { /* a script tag */ }
  const inDev = local && (scriptTag ? servedByDev : mode !== 'production');
  const helperPorts = Array.from({ length: 10 }, (_, i) => 4321 + i);

  const getJson = async (url, timeout = 1500) => {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const session = async base => {
    const body = await getJson(`${base}/afterimage/api/session`);
    return body?.afterimage === 1 ? { base, ...body } : null;
  };

  // Where the history is, or null. On this machine a running afterimage dev comes first: some dev servers (Vite's)
  // serve the project's own afterimage/versions.json at the same path a deployed site does, and that copy can't save.
  // A host that answers every path with the app's own page fails the JSON checks.
  async function find() {
    if (inDev && servedByDev) {
      const here = await session(location.origin);
      if (here) return here;
    } else if (inDev) {
      // One port at a time from 4321, stopping at the first helper: usually that is the first ask, and a port held by
      // some other server costs one quick refusal (which the browser logs) rather than ten at once.
      for (const port of helperPorts) {
        const found = await session(`http://${location.hostname}:${port}`);
        if (found) return found;
      }
    }
    const manifest = await getJson('/afterimage/versions.json');
    if (Array.isArray(manifest?.versions) && manifest.versions.length) {
      const latest = manifest.versions[0];
      return { base: location.origin, versions: manifest.versions.length, latest: { id: latest.id, name: latest.name }, canSave: false };
    }
    return null;
  }

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .dock { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased; color: #ededed; }
    .pill { display: flex; align-items: center; gap: 2px; padding: 5px; border-radius: 999px; background: #1b1b1b;
      box-shadow: 0 0 0 1px #ffffff14, 0 1px 2px #0000004d, 0 10px 28px #00000040; user-select: none; -webkit-user-select: none; }
    .mark { flex: none; width: 34px; height: 34px; display: grid; place-items: center; }
    .label { padding: 0 8px 0 2px; color: #8e8e8e; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .label b { color: #ededed; font-weight: 500; }
    .sep { flex: none; width: 1px; height: 18px; margin: 0 4px; background: #ffffff14; }
    button { appearance: none; height: 34px; margin: 0; padding: 0 12px; border: 0; border-radius: 999px; background: transparent;
      color: inherit; font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; }
    button:hover:not(:disabled) { background: #2a2a2a; }
    button:disabled { color: #5c5c5c; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid #ededed8c; outline-offset: 1px; }
    .primary { background: #ededed; color: #1b1b1b; }
    .primary:hover:not(:disabled) { background: #ffffff; }
    input { width: 180px; height: 34px; margin: 0 2px 0 0; padding: 0 12px; border: 0; border-radius: 999px; background: #2a2a2a;
      color: #ededed; font: inherit; }
    input::placeholder { color: #8e8e8e; }
    .status { padding: 0 12px 0 2px; white-space: nowrap; }
    .status.bad { color: #e0705f; white-space: normal; max-width: 320px; line-height: 1.35; padding: 6px 12px 6px 2px; }
    .busy { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: #e5a83b;
      vertical-align: 1px; animation: pulse 1s ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 0.35; } to { opacity: 1; } }
    .layer { position: fixed; inset: 0; z-index: 2147483647; background: #1b1b1b; opacity: 0; transition: opacity 160ms ease-out; }
    .layer[data-shown] { opacity: 1; }
    .layer iframe { display: block; width: 100%; height: 100%; border: 0; }
    .close { position: absolute; top: 12px; right: 12px; width: 34px; padding: 0; display: grid; place-items: center; background: #1b1b1b;
      box-shadow: 0 0 0 1px #ffffff14, 0 6px 16px #00000040; color: #ededed; }
    .close:hover:not(:disabled) { background: #2a2a2a; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { .layer { transition: none; } .busy { animation: none; } }
  `;
  // The wipe mark from afterimage's own icon: the first version on the left, today's on the right.
  const mark = '<svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#ededed"/><path d="M7 0h9v32H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7z" fill="#8e8e8e"/><rect x="15" y="5" width="2" height="22" rx="1" fill="#1b1b1b"/></svg>';
  const cross = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const host = document.createElement('afterimage-overlay');
  const root = host.attachShadow({ mode: 'open' });
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  let state = null;
  let view = 'idle';
  let message = '';
  let timer = 0;
  let layer = null;
  let returnFocus = null;

  const dock = make('div', { className: 'dock' });
  const pill = make('div', { className: 'pill' });
  pill.setAttribute('role', 'toolbar');
  pill.setAttribute('aria-label', 'Afterimage');
  dock.append(pill);
  const live = make('div', { className: 'visually-hidden' });
  live.setAttribute('aria-live', 'polite');
  root.append(make('style', { textContent: css }), dock, live);

  const say = text => { live.textContent = text; };
  const later = (next, ms) => {
    clearTimeout(timer);
    timer = setTimeout(next, ms);
  };
  const button = (text, onClick, extra = {}) => {
    const element = make('button', { type: 'button', textContent: text, ...extra });
    element.addEventListener('click', onClick);
    return element;
  };

  function render() {
    pill.replaceChildren();
    pill.insertAdjacentHTML('beforeend', `<span class="mark">${mark}</span>`);
    const versions = state.versions;

    if (view === 'naming') {
      const input = make('input', { type: 'text', maxLength: 120, placeholder: `Version ${versions + 1}`, ariaLabel: 'Version name' });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') save(input.value);
        if (event.key === 'Escape') { event.stopPropagation(); back(); }
      });
      pill.append(input, button('Save', () => save(input.value), { className: 'primary' }), button('Cancel', back));
      input.focus();
      return;
    }
    if (view === 'saving') {
      pill.append(make('span', { className: 'status', innerHTML: `<span class="busy"></span>Saving v${versions + 1}…` }));
      return;
    }
    if (view === 'saved' || view === 'failed') {
      pill.append(make('span', { className: `status${view === 'failed' ? ' bad' : ''}`, textContent: message }));
      return;
    }

    const label = make('span', { className: 'label' });
    if (versions) label.innerHTML = `<b>${state.latest.id}</b> · ${versions} ${versions === 1 ? 'version' : 'versions'}`;
    else label.textContent = 'No versions yet';
    pill.append(label, make('span', { className: 'sep' }));
    if (versions) pill.append(button('History', open));
    if (state.canSave) pill.append(button(versions ? 'Save' : 'Save first version', () => { view = 'naming'; render(); }, versions ? {} : { className: 'primary' }));
  }

  function back() {
    view = 'idle';
    render();
  }

  async function save(name) {
    view = 'saving';
    render();
    say('Saving. Afterimage builds the prototype first.');
    let result;
    try {
      const response = await fetch(`${state.base}/afterimage/api/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() })
      });
      result = await response.json().catch(() => ({ error: `Afterimage answered ${response.status}.` }));
      if (!response.ok) throw new Error(result.error ?? `Afterimage answered ${response.status}.`);
    } catch (error) {
      view = 'failed';
      message = `Couldn't save. ${error.message === 'Failed to fetch' ? 'Is afterimage dev still running?' : error.message}`;
      render();
      say(message);
      later(back, 6000);
      return;
    }
    if (result.saved) state = { ...state, versions: Number(result.id.slice(1)), latest: { id: result.id, name: result.name } };
    view = 'saved';
    message = result.saved ? `Saved ${result.id} "${result.name}"` : `No changes since ${result.id}`;
    render();
    say(message);
    later(back, 2400);
  }

  function open(event) {
    if (layer) return;
    returnFocus = event?.currentTarget ?? null;
    layer = make('div', { className: 'layer' });
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Version history');
    const frame = make('iframe', { src: `${state.base}/afterimage/`, title: 'Version history' });
    const closer = button('', close, { className: 'close', ariaLabel: 'Close history' });
    closer.innerHTML = cross;
    layer.append(frame, closer);
    root.append(layer);
    dock.hidden = true;
    document.documentElement.style.setProperty('overflow', 'hidden');
    requestAnimationFrame(() => layer?.setAttribute('data-shown', ''));
    frame.addEventListener('load', () => frame.focus(), { once: true });
    closer.focus();
  }

  function close() {
    if (!layer) return;
    layer.remove();
    layer = null;
    dock.hidden = false;
    document.documentElement.style.removeProperty('overflow');
    returnFocus?.focus?.();
    // A save the agent made from the terminal meanwhile shows up in the count.
    refresh();
  }

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && layer) close();
  });
  window.addEventListener('message', event => {
    if (layer && event.origin === new URL(state.base).origin && event.data?.type === 'afterimage:close') close();
  });

  async function refresh() {
    if (!state || view !== 'idle') return;
    const next = state.canSave ? await session(state.base) : null;
    if (next && (next.versions !== state.versions)) {
      state = next;
      render();
    }
  }
  // Saves the agent makes from the terminal show up when the person comes back to the page.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  const mount = async () => {
    state = await find();
    if (!state) return;
    render();
    // On <html>, beside <body> rather than in it: frameworks that redraw the body (hydration, page swaps) leave it alone.
    document.documentElement.append(host);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
