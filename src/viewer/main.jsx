import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { validateManifest } from '../engine/manifest.js';
import App from './App.jsx';
import './styles/tokens.css';

function Problem({ title }) {
  return (
    <section className="load-error" role="alert">
      <h1>{title}</h1>
      <p>Reload to try again.</p>
      <button type="button" onClick={() => location.reload()}>Reload</button>
    </section>
  );
}

const LoadError = () => <Problem title="History couldn't load." />;

// Anything that still throws while rendering, or in an effect, lands here instead of unmounting the root and
// leaving a blank page. The link in the address bar is kept, so Reload comes back to the same view.
class RootBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('The viewer hit an error.', error);
  }

  render() {
    return this.state.failed ? <Problem title="Something went wrong." /> : this.props.children;
  }
}

async function loadManifest() {
  const response = await fetch('versions.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`History request failed with status ${response.status}.`);
  return validateManifest(await response.json());
}

// Saved built apps ask for root paths like /assets/x.js; the frame runtime's worker (sw.js, next to this page)
// answers them from each version's own folder. Frames are created only once it is active, so a frame's first
// requests already go through it. Where service workers are unavailable (an insecure origin, a host that won't
// serve sw.js) the viewer renders anyway, and so it does when the worker is slow to activate.
const RUNTIME_WAIT_MS = 3000;
async function startRuntime() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // Absolute, like the paths in frame.js and the worker: the history is always served at /afterimage/, and a
    // relative path from /afterimage (no slash) would register the root's own /sw.js at scope /.
    // The default updateViaCache already checks sw.js itself past the HTTP cache; 'none' keeps that true for
    // anything it might import later.
    await navigator.serviceWorker.register('/afterimage/sw.js', { scope: '/afterimage/', updateViaCache: 'none' });
    await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(resolve, RUNTIME_WAIT_MS))]);
  } catch (error) {
    console.warn('The frame runtime did not start, so built apps may render without their files.', error);
  }
}

// In dev, Vite can evaluate this entry more than once on a page (after an edit it re-runs the entry, and the
// page can then import both the plain and the timestamped URL). Keep one root per page so there is only ever
// one app. The build evaluates the entry once, so this branch is dropped there.
const container = document.getElementById('root');
let root;
if (import.meta.hot) {
  root = window.__afterimageRoot ?? createRoot(container);
  window.__afterimageRoot = root;
} else {
  root = createRoot(container);
}
Promise.all([loadManifest(), startRuntime()]).then(
  ([manifest]) => root.render(<StrictMode><RootBoundary><App versions={manifest.versions} /></RootBoundary></StrictMode>),
  error => {
    console.error('Could not load version history.', error);
    root.render(<StrictMode><LoadError /></StrictMode>);
  },
);
