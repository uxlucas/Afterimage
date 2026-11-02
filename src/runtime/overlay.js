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
//
// The pill is the viewer's own bar, in the same place: Version N of N, Highlight, Compare, and Save. Pointing at it
// loads the viewer, hidden, over the page; a button asks the viewer for that state, on the page's route and scroll, and
// the viewer only shows once it is there, so the page seems to switch the outlines on in place. Turning everything off
// again (or Esc) hands the page back, where the visitor left the viewer. The messages are in viewer/hooks/usePageHost.js.
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
  const OPEN_TIMEOUT_MS = 12000;
  const LAYER_FADE_MS = 140; // .layer's fade in; the page's pill stays up under it until it's done

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

  // The viewer's pill (viewer/pill/pill.css and styles/tokens.css), so the two read as one control.
  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .dock { position: fixed; left: 0; right: 0; bottom: 16px; z-index: 2147483646; display: flex; justify-content: center;
      padding: 0 16px; pointer-events: none; font: 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased; color: #ededed; }
    .pill { display: flex; align-items: center; gap: 2px; max-width: 100%; padding: 5px; border-radius: 999px; background: #1b1b1b;
      white-space: nowrap; box-shadow: 0 0 0 1px #ffffff14, 0 1px 2px #0000004d, 0 10px 28px #00000040; pointer-events: auto;
      user-select: none; -webkit-user-select: none; }
    .num { font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; font-size: 12px; }
    .sep { flex: none; width: 1px; height: 18px; margin: 0 4px; background: #ffffff14; }
    .label { padding: 0 12px; color: #8e8e8e; }
    button { appearance: none; display: inline-flex; align-items: center; gap: 8px; height: 34px; margin: 0; padding: 0 12px;
      border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; line-height: 1; white-space: nowrap;
      cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      transition: background-color 150ms ease, color 150ms ease, transform 120ms cubic-bezier(0.22, 1, 0.36, 1); }
    button:active:not(:disabled) { transform: scale(0.97); }
    button:disabled { color: #5c5c5c; cursor: default; }
    @media (hover: hover) { button:hover:not(:disabled) { background: #2a2a2a; } }
    button:focus-visible, input:focus-visible { outline: 2px solid #ededed8c; outline-offset: -2px; }
    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #6fbf73; }
    .field { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; margin-left: -2px; border-radius: 6px;
      background: #ffffff0d; color: #ededed; }
    .of { color: #8e8e8e; margin-left: -4px; }
    .of .num { margin-left: 4px; }
    .primary { background: #ededed; color: #1b1b1b; }
    @media (hover: hover) { .primary:hover:not(:disabled) { background: #ffffff; } }
    button[aria-busy='true']::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #e5a83b;
      animation: pulse 0.8s ease-in-out infinite alternate; }
    input { width: 180px; height: 34px; margin: 0 2px 0 0; padding: 0 12px; border: 0; border-radius: 999px; background: #2a2a2a;
      color: #ededed; font: inherit; }
    input::placeholder { color: #8e8e8e; }
    .status { padding: 0 12px; }
    .status.bad { color: #e0705f; white-space: normal; max-width: 320px; line-height: 1.35; padding: 6px 12px; }
    .busy { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: #e5a83b;
      vertical-align: 1px; animation: pulse 1s ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 0.35; } to { opacity: 1; } }
    /* The viewer waits here, laid out but unseen, until it shows what was asked for. Not display:none, so it loads. */
    /* Under the pill the two are the same picture, so the short fade only blends the page's pill into the viewer's. */
    .layer { position: fixed; inset: 0; z-index: 2147483647; opacity: 0; pointer-events: none; transition: opacity 110ms cubic-bezier(0.22, 1, 0.36, 1); }
    .layer[data-shown] { opacity: 1; pointer-events: auto; transition-duration: 140ms; }
    .layer iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { button, .layer { transition: none; } .busy, button[aria-busy='true']::before { animation: none; } }
  `;

  const host = document.createElement('afterimage-overlay');
  const root = host.attachShadow({ mode: 'open' });
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  let state = null;
  let view = 'idle';
  let message = '';
  let timer = 0;
  // The viewer, once the pill was pointed at: { el, frame, origin, versions, listening, asked, shown }.
  // asked is { view, button } from a click until the viewer is ready.
  let viewer = null;
  let openTimer = 0;
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
  const button = (content, onClick, extra = {}) => {
    const element = make('button', { type: 'button', ...extra });
    element.append(...[content].flat());
    element.addEventListener('click', onClick);
    return element;
  };

  function render() {
    pill.replaceChildren();
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

    if (!versions) {
      pill.append(make('span', { className: 'label', textContent: 'No versions yet' }));
      if (state.canSave) pill.append(button('Save first version', () => { view = 'naming'; render(); }, { className: 'primary' }));
      return;
    }
    // Version N of N opens the list of versions, as it does in the viewer. A first version has nothing to compare.
    const number = Number(state.latest.id.slice(1)) || versions;
    const single = versions < 2;
    pill.append(
      button([
        make('span', { className: 'dot' }),
        'Version',
        make('span', { className: 'field num', textContent: String(number) }),
        make('span', { className: 'of', innerHTML: `of<span class="num">${versions}</span>` }),
      ], event => open('versions', event), { ariaLabel: `Version ${number} of ${versions}, latest. Show versions` }),
      make('span', { className: 'sep' }),
      button('Highlight', event => open('highlight', event), { disabled: single, ariaLabel: single ? 'Highlight changes, not available on the first version' : 'Highlight changes' }),
      button('Compare', event => open('compare', event), { disabled: single }),
    );
    if (state.canSave) pill.append(make('span', { className: 'sep' }), button('Save', () => { view = 'naming'; render(); }));
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

  // Loads the viewer behind the page, on the page's route, so a click finds it ready. A save since then made a version
  // the loaded viewer doesn't know, so that one is replaced.
  function prepare() {
    if (!state?.versions || viewer?.shown || viewer?.asked) return;
    if (viewer && viewer.versions === state.versions) return;
    viewer?.el.remove();
    const el = make('div', { className: 'layer' });
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    const frame = make('iframe', { src: `${state.base}/afterimage/${location.hash}`, title: 'Version history', tabIndex: -1 });
    el.append(frame);
    root.append(el);
    viewer = { el, frame, origin: new URL(state.base).origin, versions: state.versions, listening: false, asked: null, shown: false };
  }

  // The panels that scroll on this page (an app shell's content), in page order, and where each is. The viewer reads
  // its frame the same way (stage/scrollSync.js), so the two open and close on the same rows.
  const scrollingPanels = () => [...document.querySelectorAll('*')].filter(element => element.scrollHeight > element.clientHeight
    && /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY));
  const panelTops = () => scrollingPanels().map(panel => Math.round(panel.scrollTop));
  function setPanelTops(tops) {
    if (!Array.isArray(tops)) return;
    scrollingPanels().forEach((panel, index) => { if (Number.isFinite(tops[index])) panel.scrollTop = tops[index]; });
  }
  const afterFrames = (count, fn) => requestAnimationFrame(() => (count > 1 ? afterFrames(count - 1, fn) : fn()));

  // A click can come before the viewer has started; then it is asked as soon as it says it is listening.
  function ask() {
    if (!viewer?.listening || !viewer.asked) return;
    viewer.frame.contentWindow.postMessage({ type: 'afterimage:open', view: viewer.asked.view, route: location.hash, scrollY: window.scrollY, panels: panelTops() }, viewer.origin);
  }

  function open(name, event) {
    if (viewer?.shown || viewer?.asked) return;
    prepare();
    const pressed = event?.currentTarget ?? null;
    returnFocus = pressed;
    pressed?.setAttribute('aria-busy', 'true');
    viewer.asked = { view: name, button: pressed };
    ask();
    clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      // The viewer never got there (the helper stopped, say): start from scratch next time.
      viewer?.el.remove();
      viewer = null;
      view = 'failed';
      message = "Couldn't open the history. Is afterimage dev still running?";
      render();
      say(message);
      later(back, 6000);
    }, OPEN_TIMEOUT_MS);
  }

  function show() {
    if (!viewer?.asked) return;
    clearTimeout(openTimer);
    viewer.asked.button?.removeAttribute('aria-busy');
    viewer.asked = null;
    viewer.shown = true;
    const { el } = viewer;
    el.inert = false;
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Version history');
    el.setAttribute('data-shown', '');
    const fade = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : LAYER_FADE_MS;
    viewer.frame.focus();
    // Once the swap is done, the viewer moves into what was asked for, where it can be seen doing it. One thing at
    // a time: the two pills blend in place first, then the viewer's changes shape.
    const { frame, origin } = viewer;
    afterFrames(1, () => setTimeout(() => {
      if (!viewer?.shown) return;
      dock.hidden = true;
      // Only now, under an opaque viewer: dropping the page's scrollbar moves its layout.
      document.documentElement.style.setProperty('overflow', 'hidden');
      frame.contentWindow?.postMessage({ type: 'afterimage:shown' }, origin);
    }, fade));
  }

  // The viewer stays loaded for next time. The page takes the route and scroll the visitor left the viewer on, and
  // settles there under the viewer; then the viewer goes. The two look the same by then, so the swap doesn't show.
  function hide({ route, scrollY, panels } = {}) {
    if (!viewer?.shown) return;
    viewer.shown = false;
    const { el } = viewer;
    el.inert = true;
    document.documentElement.style.removeProperty('overflow');
    if (typeof route === 'string' && route !== location.hash && (route || location.hash)) location.hash = route;
    afterFrames(2, () => {
      if (typeof scrollY === 'number') window.scrollTo(0, scrollY);
      setPanelTops(panels);
      afterFrames(1, () => {
        if (viewer?.shown) return; // opened again meanwhile
        el.removeAttribute('data-shown');
        el.removeAttribute('role');
        el.removeAttribute('aria-modal');
        el.setAttribute('aria-hidden', 'true');
        dock.hidden = false;
        returnFocus?.focus?.({ preventScroll: true });
        // A save the agent made from the terminal meanwhile shows up in the count.
        refresh();
      });
    });
  }

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewer?.shown) hide();
  });
  window.addEventListener('message', event => {
    if (!viewer || event.source !== viewer.frame.contentWindow || event.origin !== viewer.origin) return;
    const type = event.data?.type;
    if (type === 'afterimage:listening') { viewer.listening = true; ask(); }
    if (type === 'afterimage:ready') show();
    if (type === 'afterimage:close') hide(event.data);
  });
  pill.addEventListener('pointerenter', prepare);
  pill.addEventListener('focusin', prepare);

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
