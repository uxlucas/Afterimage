import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls, useIsPresent } from 'motion/react';
import { comparisonBase } from '../state/model.js';
import { formatSaved, indexOfVersion, previousVersion, versionNumber } from '../state/versions.js';
import { useTransitions } from '../motion.js';
import { useReducedMotion } from '../hooks/useMedia.js';
import { urlWriter } from '../urlSync.js';
import VersionList from './VersionList.jsx';
import ChangeList from './ChangeList.jsx';
import './panel.css';

const COPIED_MS = 1200;

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.6.6" />
      <path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.6-.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

function Chevron({ open }) {
  const t = useTransitions();
  return (
    <motion.svg
      className="row-chevron"
      width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      initial={false}
      animate={{ rotate: open ? 90 : 0 }}
      transition={t.layout}
    >
      <path d="m6.5 4 4 4-4 4" />
    </motion.svg>
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden field for plain http hosts.
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.append(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    field.remove();
    return ok;
  }
}

function CopyLink() {
  const t = useTransitions();
  const [copied, setCopied] = useState(0); // time of the last copy, so copying again restarts the check
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const onClick = async () => {
    urlWriter.flush(); // the address bar can be one coalescing interval behind the view
    if (await copyText(location.href)) setCopied(Date.now());
  };
  const swap = {
    initial: { opacity: 0, scale: 0.7 },
    animate: { opacity: 1, scale: 1, transition: t.enter },
    exit: { opacity: 0, scale: 0.7, transition: t.exit },
  };
  return (
    <>
      <button type="button" className="icon-btn" data-done={copied ? true : undefined} aria-label="Copy link to this view" onClick={onClick}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={copied ? 'check' : 'link'} className="icon-swap" {...swap}>
            {copied ? <CheckIcon /> : <LinkIcon />}
          </motion.span>
        </AnimatePresence>
      </button>
      <span className="sr-only" role="status">{copied ? 'Link copied' : ''}</span>
    </>
  );
}

// Animates to the height of its content, so things that grow or shrink inside (notes, folders) move
// what's below them instead of jumping.
function AutoHeight({ children, className }) {
  const t = useTransitions();
  const innerRef = useRef(null);
  const [height, setHeight] = useState('auto');
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div className={className} initial={false} animate={{ height }} transition={t.layout} style={{ overflow: 'hidden' }}>
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}

// The author's notes: the first one shows, the rest open in place.
function Notes({ notes }) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  const first = notes[0];
  const rest = notes.length - 1;

  useLayoutEffect(() => {
    const element = firstRef.current;
    if (!element) return undefined;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [first, open]);

  if (!first) return null;
  const canOpen = rest > 0 || clipped || open;
  return (
    <AutoHeight className="notes">
      <p ref={firstRef} className="note" data-clamped={!open || undefined}>{first}</p>
      {open && notes.slice(1).map((note, index) => <p key={index} className="note">{note}</p>)}
      {canOpen && (
        <button type="button" className="text-btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? 'Show less' : rest > 0 ? <><span className="num">{rest}</span> more</> : 'More'}
        </button>
      )}
    </AutoHeight>
  );
}

function Folder({ children, label }) {
  const t = useTransitions();
  return (
    <motion.div
      className="folder"
      role="region"
      aria-label={label}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1, transition: { height: t.layout, opacity: t.enter } }}
      exit={{ height: 0, opacity: 0, transition: { height: { ...t.layout, duration: t.layout.duration * 0.8 }, opacity: t.exit } }}
    >
      <div className="folder-inner">{children}</div>
    </motion.div>
  );
}

function Switch({ on, onToggle, label, dim }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} data-dim={dim || undefined} onClick={onToggle}>
      <span className="switch-track"><span className="switch-thumb" /></span>
    </button>
  );
}

// The panel above the pill: what this version is, its changes, and every other version, as rows that read
// as sentences. Folders open in place; nothing here takes you somewhere else.
export default function Panel({ state, dispatch, versions, review, phone, targetRef, autoFocus, tip, onClose }) {
  const t = useTransitions();
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const drag = useDragControls();
  const rootRef = useRef(null);
  const versionsRowRef = useRef(null);
  const handoff = useRef(false);

  const latest = versions[0];
  const target = versions.find(version => version.id === state.versionId) ?? latest;
  const isLatest = target.id === latest.id;
  const first = previousVersion(versions, target.id) === null;
  const base = comparisonBase(versions, state);
  const number = versionNumber(target);
  const total = versionNumber(latest);
  const newer = indexOfVersion(versions, target.id);
  const saved = formatSaved(target.savedAt);
  const savedText = saved ? (isLatest ? saved : saved.split(', ')[0]) : null;
  const nextNumber = (() => {
    const index = indexOfVersion(versions, target.id);
    return index > 0 ? versionNumber(versions[index - 1]) : number + 1;
  })();

  const { status, summary } = review;
  const ready = status === 'ready';
  const failed = status === 'failed';
  const changesOpen = state.folders.changes && !first && !failed && !(ready && summary.total === 0);
  const versionsOpen = state.folders.versions;
  const toggle = folder => dispatch({ type: 'toggleFolder', folder, phone });

  // Opened from the keyboard: start on the panel's first control.
  useEffect(() => {
    if (autoFocus) rootRef.current?.querySelector('button, input')?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Go to latest removes its own row; hand focus to the versions row so the keyboard user stays in the panel.
  useLayoutEffect(() => {
    if (isLatest && handoff.current) versionsRowRef.current?.focus({ preventScroll: true });
    handoff.current = false;
  }, [isLatest]);

  const baseLabel = base ? `v${versionNumber(base)}` : '';
  const targetLabel = `v${number}`;
  // Outside Compare the changes are always since the previous version; in Compare, across the chosen range.
  const comparing = state.mode === 'compare' && base !== null;
  const range = comparing
    ? <>from <span className="num">{baseLabel}</span> to <span className="num">{targetLabel}</span></>
    : <>since <span className="num">{baseLabel}</span></>;

  let changesRow;
  if (first) {
    changesRow = <div className="row row-static"><span className="muted">First version. Changes show up from <span className="num">v{nextNumber}</span>.</span></div>;
  } else if (failed) {
    changesRow = <div className="row row-static"><span className="muted">Couldn't check changes. Reload to try again.</span></div>;
  } else {
    const zero = ready && summary.total === 0;
    const sentence = zero
      ? <span className="muted">No visible changes {range}</span>
      : ready
        ? <span><span className="amber num">{summary.total}</span> {summary.total === 1 ? 'change' : 'changes'} {range}</span>
        : <span className="muted">Checking changes {range}…</span>;
    changesRow = (
      <div className="row row-split">
        {zero ? (
          <div className="row-main row-static-main">{sentence}</div>
        ) : (
          <button type="button" className="row-main" aria-expanded={changesOpen} onClick={() => toggle('changes')}>
            {sentence}
            <Chevron open={changesOpen} />
          </button>
        )}
        <Switch on={state.highlights} dim={zero} label="Highlight changes on the page" onToggle={() => dispatch({ type: 'toggleHighlights' })} />
      </div>
    );
  }

  const motionProps = phone
    ? {
      initial: { y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 },
      animate: { y: 0, opacity: 1, transition: reduced ? t.enter : { duration: 0.24, ease: [0.32, 0.72, 0, 1] } },
      exit: { y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1, transition: reduced ? t.exit : { duration: 0.19, ease: [0.32, 0.72, 0, 1] } },
      drag: 'y',
      dragControls: drag,
      dragListener: false,
      dragConstraints: { top: 0, bottom: 0 },
      dragElastic: { top: 0.04, bottom: 0.9 },
      onDragEnd: (_, info) => { if (info.offset.y > 72 || info.velocity.y > 480) onClose({ refocus: false }); },
    }
    : {
      initial: { opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.97 },
      animate: { opacity: 1, y: 0, scale: 1, transition: t.enter },
      exit: { opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : 0.98, transition: t.exit },
    };

  return (
    <motion.section
      ref={rootRef}
      className="panel"
      data-phone={phone || undefined}
      role="dialog"
      aria-label={comparing ? `Compare ${baseLabel} to ${targetLabel}` : `Version ${number}`}
      inert={!present || undefined}
      {...motionProps}
    >
      {phone && (
        <div className="grab" onPointerDown={event => drag.start(event)} aria-hidden="true">
          <span className="grab-bar" />
        </div>
      )}
      <div className="panel-scroll">
        <header className="panel-head">
          <div className="head-top">
            <h2 className="panel-name" title={target.name}>{target.name}</h2>
            <div className="head-icons">
              <CopyLink />
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => onClose({ refocus: true })}>
                <CloseIcon />
              </button>
            </div>
          </div>
          <p className="panel-meta">
            {comparing
              ? <><span className="num">{baseLabel}</span> → <span className="num">{targetLabel}</span></>
              : <><span className="num">v{number}</span>{!isLatest && <> of <span className="num">{total}</span></>}</>}
            {savedText && <> · saved <span className="num">{savedText}</span></>}
            <span className="tag" data-latest={isLatest || undefined}>{isLatest ? 'Latest' : 'Older'}</span>
          </p>
          <Notes key={target.id} notes={target.notes ?? []} />
        </header>

        <div className="rows">
          {changesRow}
          <AnimatePresence initial={false}>
            {changesOpen && (
              <Folder key="changes" label="Changes">
                <ChangeList phone={phone} state={state} dispatch={dispatch} review={review} baseLabel={baseLabel} targetLabel={targetLabel} onClose={onClose} />
              </Folder>
            )}
          </AnimatePresence>

          {!isLatest && (
            <div className="row row-split">
              <span className="row-text"><span className="num">{newer}</span> newer {newer === 1 ? 'version' : 'versions'}</span>
              <button
                type="button"
                className="small-btn"
                onClick={event => { handoff.current = event.currentTarget === document.activeElement; dispatch({ type: 'goLatest' }); }}
              >
                Go to latest
              </button>
            </div>
          )}

          {versions.length > 1 && (
            <div className="row">
              <button ref={versionsRowRef} type="button" className="row-main" aria-expanded={versionsOpen} onClick={() => toggle('versions')}>
                <span>
                  {isLatest
                    ? <><span className="num">{versions.length - 1}</span> earlier {versions.length - 1 === 1 ? 'version' : 'versions'}</>
                    : <>All <span className="num">{versions.length}</span> versions</>}
                </span>
                <Chevron open={versionsOpen} />
              </button>
            </div>
          )}
          <AnimatePresence initial={false}>
            {versionsOpen && versions.length > 1 && (
              <Folder key="versions" label="Versions">
                <VersionList versions={versions} state={state} dispatch={dispatch} review={review} targetRef={targetRef} />
              </Folder>
            )}
          </AnimatePresence>
        </div>
      </div>
      {tip && (
        <p className="panel-tip">
          Tip:{' '}
          <span className="tip-item"><kbd>[</kbd><kbd>]</kbd> versions,</span>{' '}
          <span className="tip-item"><kbd>J</kbd><kbd>K</kbd> changes,</span>{' '}
          <span className="tip-item"><kbd>?</kbd> for all shortcuts</span>
        </p>
      )}
    </motion.section>
  );
}
