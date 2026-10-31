import { isGeneratedAttribute, isGeneratedName } from './generated-names.js';

const styleProperties = ['color', 'backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'opacity', 'transform'];
const normalize = value => value.replace(/\s+/g, ' ').trim();
const normalizeAsset = value => value.replace(/\/versions\/v\d+\//g, '/versions/snapshot/');
function labelFor(element) {
  const label = element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('alt') || element.querySelector('h1,h2,h3,legend')?.innerText || element.innerText || element.textContent;
  const text = normalize(label || '');
  return text ? text.slice(0, 100) + (text.length > 100 ? '…' : '') : ({ INPUT: 'Input field', IMG: 'Image', SVG: 'Icon', VIDEO: 'Video', CANVAS: 'Drawing', DIV: 'Section', ASIDE: 'Summary', BUTTON: 'Button' }[element.tagName] || 'Page element');
}

// The id an author gave an element so it matches across versions.
export const stableId = element => element.dataset.afterimageId;

// An id the author gave, not one a framework made up (React's useId): that one differs between builds.
const ownId = element => (element.id && !isGeneratedName(element.id) ? element.id : '');

// An href to a generated id, such as #_r_1_, is the same link in every build.
const ownValue = value => value.replace(/^#(.+)$/, (whole, id) => (isGeneratedName(id) ? '#' : whole));

// An icon's markup without the names a build generated, so a rebuilt icon is the same icon. Generated ids (a gradient's
// useId) are numbered in order, and what points at them follows.
function drawingOf(svg) {
  const copy = svg.cloneNode(true);
  const nodes = [...copy.querySelectorAll('*')];
  const ids = new Map();
  for (const node of nodes) {
    for (const { name } of [...node.attributes]) if (isGeneratedAttribute(name)) node.removeAttribute(name);
    for (const name of [...node.classList]) if (isGeneratedName(name)) node.classList.remove(name);
    if (node.hasAttribute('class') && !node.classList.length) node.removeAttribute('class');
    if (node.id && isGeneratedName(node.id)) {
      ids.set(node.id, `generated-${ids.size}`);
      node.id = ids.get(node.id);
    }
  }
  if (ids.size) {
    for (const node of nodes) {
      for (const attribute of [...node.attributes]) {
        attribute.value = attribute.value.replace(/#([^\s)"']+)/g, (whole, id) => (ids.has(id) ? `#${ids.get(id)}` : whole));
      }
    }
  }
  return copy.innerHTML;
}

function computeKey(element, keys) {
  if (stableId(element)) return `stable:${stableId(element)}`;
  if (ownId(element)) return `id:${ownId(element)}`;
  if (element.tagName === 'BODY') return 'page';
  if (element.tagName === 'LABEL' && element.htmlFor && !isGeneratedName(element.htmlFor)) return `label:${element.htmlFor}`;
  if (element.matches('input,textarea,select') && element.name) return `field:${element.tagName}:${element.name}`;
  const siblings = [...element.parentElement.children].filter(sibling => sibling.tagName === element.tagName);
  const stableClass = [...element.classList].find(name => !/^(active|selected|hidden|open|v\d+)$/.test(name) && !isGeneratedName(name) && siblings.filter(sibling => sibling.classList.contains(name)).length === 1);
  if (stableClass) return `${keyFor(element.parentElement, keys)}/${element.tagName.toLowerCase()}.${stableClass}`;
  return `${keyFor(element.parentElement, keys)}/${element.tagName.toLowerCase()}:${siblings.indexOf(element)}`;
}

// An element's key builds on its parent's, and every record lists its ancestors' keys, so each key is worked
// out once per capture (`keys`) instead of again for every descendant.
function keyFor(element, keys) {
  let key = keys.get(element);
  if (key === undefined) {
    key = computeKey(element, keys);
    keys.set(element, key);
  }
  return key;
}

export function captureDocument(doc) {
  const view = doc.defaultView;
  const records = [];
  const keys = new Map();
  for (const element of doc.body.querySelectorAll('*')) {
    if (element.closest('[data-afterimage-overlay],script,style,noscript,svg') && element.tagName.toLowerCase() !== 'svg') continue;
    if (element.matches('main,form,br,meta,link')) continue;
    const rect = element.getBoundingClientRect();
    const style = view.getComputedStyle(element);
    if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const text = normalize([...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' '));
    const visualBox = style.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(style.borderTopWidth) > 0;
    if (!text && !ownId(element) && !stableId(element) && !visualBox && !element.matches('input,textarea,select,button,img,svg,video,canvas')) continue;
    const ancestors = [];
    for (let parent = element.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) ancestors.push(keyFor(parent, keys));
    const attributes = ['src', 'alt', 'href', 'type', 'placeholder', 'aria-label'].map(name => [name, normalizeAsset(ownValue(element.getAttribute(name) || ''))]);
    if (element.tagName.toLowerCase() === 'svg') attributes.push(['drawing', drawingOf(element)]);
    const styles = Object.fromEntries(styleProperties.map(name => [name, normalizeAsset(style[name])]));
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(style[`border${side}Width`]) === 0) styles[`border${side}Color`] = 'transparent';
    }
    records.push({ key: keyFor(element, keys), ancestors, element, text, label: labelFor(element), content: normalize(element.innerText || element.getAttribute('placeholder') || element.getAttribute('alt') || ''), attrs: Object.fromEntries(attributes), attributes: JSON.stringify(attributes), styles,
      style: JSON.stringify(styles),
      rect: { x: rect.left + view.scrollX, y: rect.top + view.scrollY, width: rect.width, height: rect.height } });
  }
  const bodyStyle = view.getComputedStyle(doc.body);
  const styles = Object.fromEntries(['backgroundColor', 'backgroundImage'].map(name => [name, normalizeAsset(bodyStyle[name])]));
  records.push({ key: 'page', label: 'Page background', content: '', styles, ancestors: [], element: doc.body, page: true, text: '', attributes: '',
    style: JSON.stringify(styles), rect: { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight } });
  return records;
}
