import test from 'node:test';
import assert from 'node:assert/strict';
import { stableId, drawingOf, ownValue } from '../src/engine/capture.js';

test('only data-afterimage-id pins a match; the old data-tm-id is gone', () => {
  assert.equal(stableId({ dataset: { afterimageId: 'card' } }), 'card');
  assert.equal(stableId({ dataset: { tmId: 'card' } }), undefined);
});

// drawingOf and ownValue need no browser beyond a handful of DOM calls, so a small stand-in covers them here.
// The plain-page e2e test runs the same code in Chrome.
class FakeElement {
  constructor(tag, attributes = {}, children = []) {
    this.tag = tag;
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.children = children;
  }
  getAttribute(name) { return this.attributes.find(attribute => attribute.name === name)?.value ?? null; }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  setAttribute(name, value) {
    const attribute = this.attributes.find(entry => entry.name === name);
    if (attribute) attribute.value = value;
    else this.attributes.push({ name, value });
  }
  removeAttribute(name) { this.attributes = this.attributes.filter(attribute => attribute.name !== name); }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get classList() {
    const names = (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    return Object.assign(names, { remove: name => this.setAttribute('class', names.filter(entry => entry !== name).join(' ')) });
  }
  cloneNode() { return new FakeElement(this.tag, Object.fromEntries(this.attributes.map(({ name, value }) => [name, value])), this.children.map(child => child.cloneNode())); }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  get innerHTML() { return this.children.map(child => `<${child.tag}${child.attributes.map(({ name, value }) => ` ${name}="${value}"`).join('')}>${child.innerHTML}</${child.tag}>`).join(''); }
}
const el = (tag, attributes, ...children) => new FakeElement(tag, attributes, children);

// An icon as two builds make it: a gradient with a generated id, and a rect that points at it.
const icon = ({ cid, scope, gradient, stop = '#f00', extra = [] }) => el('svg', { viewBox: '0 0 24 24', [`data-astro-cid-${cid}`]: '' },
  el('defs', {}, el('linearGradient', { id: gradient }, el('stop', { 'stop-color': stop }))),
  el('rect', { class: `logo ${scope}`, fill: `url(#${gradient})`, [`data-astro-cid-${cid}`]: '' }),
  ...extra);

test('an icon rebuilt with other generated names has the same drawing', () => {
  const one = icon({ cid: 'aaaaaaaa', scope: 'svelte-abc123', gradient: '_r_1_' });
  const two = icon({ cid: 'bbbbbbbb', scope: 'svelte-zzz999', gradient: ':r9:' });
  assert.equal(drawingOf(two), drawingOf(one));
  // Real names are kept: the class the author wrote is still there.
  assert.match(drawingOf(one), /class="logo"/);
  assert.match(drawingOf(one), /fill="url\(#generated-0\)"/);
});

test('a real change to an icon still changes its drawing', () => {
  const base = icon({ cid: 'aaaaaaaa', scope: 'svelte-abc123', gradient: '_r_1_' });
  assert.notEqual(drawingOf(icon({ cid: 'bbbbbbbb', scope: 'svelte-zzz999', gradient: ':r9:', stop: '#0f0' })), drawingOf(base));
  // A hand-written id is not renumbered, so renaming it is a change.
  assert.notEqual(drawingOf(icon({ cid: 'aaaaaaaa', scope: 'svelte-abc123', gradient: 'sky' })), drawingOf(icon({ cid: 'aaaaaaaa', scope: 'svelte-abc123', gradient: 'sea' })));
});

test('a reference to a generated id outside the icon is the same in every build', () => {
  const use = id => icon({ cid: 'aaaaaaaa', scope: 'svelte-abc123', gradient: 'sky', extra: [el('use', { href: `#${id}` })] });
  assert.equal(drawingOf(use('_r_7_')), drawingOf(use('_R_2_')));
  assert.notEqual(drawingOf(use('sprite-a')), drawingOf(use('sprite-b')));
});

test('a duplicate generated id counts as its first element', () => {
  const svg = el('svg', {},
    el('linearGradient', { id: '_r_1_' }), el('linearGradient', { id: '_r_1_' }),
    el('rect', { fill: 'url(#_r_1_)' }));
  assert.equal(drawingOf(svg), '<linearGradient id="generated-0"></linearGradient><linearGradient id="generated-0"></linearGradient><rect fill="url(#generated-0)"></rect>');
});

test('a link to a generated id is the same link in every build', () => {
  assert.equal(ownValue('#_r_1_'), '#');
  assert.equal(ownValue('#:r1a:'), '#');
  assert.equal(ownValue('#about'), '#about');
  assert.equal(ownValue('/about#_r_1_'), '/about#_r_1_');
  assert.equal(ownValue('https://example.com/'), 'https://example.com/');
  assert.equal(ownValue(''), '');
});
