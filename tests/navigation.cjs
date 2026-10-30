const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react');
const file = path.join(__dirname, '../app/components/app-header.tsx'),
  exportsObject = {};
let warmed = [],
  headerOpen = false,
  headerRefCursor = 0,
  headerEffect;
const headerRefs = [],
  headerHooks = {
    useState() {
      return [
        headerOpen,
        (value) => (headerOpen = typeof value === 'function' ? value(headerOpen) : value),
      ];
    },
    useRef(initial) {
      const index = headerRefCursor++;
      return (headerRefs[index] ||= { current: initial });
    },
    useId: () => 'test-navigation',
    useEffect(effect) {
      headerEffect = effect;
    },
  },
  documentEvents = new Map(),
  windowEvents = new Map(),
  mediaEvents = new Map();
function events(listeners) {
  return {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
}
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: exportsObject,
    document: events(documentEvents),
    window: {
      ...events(windowEvents),
      matchMedia: () => ({ matches: true, ...events(mediaEvents) }),
    },
    require(name) {
      if (name.includes('use-collection-index'))
        return { default: () => ({ has: () => false, status: () => 'new' }) };
      if (name.endsWith('/collection-index'))
        return {
          collectionDutch: (title, article) => (article ? article + ' ' + title : title),
          collectionBookmark: (index, nl, en, lemma, label, busy, className = 'icon-button') => ({
            className,
            'aria-label': label,
            disabled: busy,
          }),
        };
      if (name === 'react') return headerHooks;
      if (name === 'next/link') return { default: 'a' };
      if (name === 'next/image') return { default: 'img' };
      if (name.includes('client-data'))
        return {
          readJson: async (path) => {
            warmed.push(path);
            return [];
          },
        };
      return require(name);
    },
  },
);
function links(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'a') out.push(node);
  for (const child of React.Children.toArray(node.props?.children)) links(child, out);
  return out;
}
function renderHeader(props) {
  headerRefCursor = 0;
  return exportsObject.default(props);
}
let destinations = [];
const header = renderHeader({
    active: 'Search',
    onNavigate: (name) => destinations.push(name),
  }),
  all = links(header),
  texts = all.find((x) => x.props.href === '/texts');
assert.ok(texts);
assert.equal(texts.type, 'a');
let prevented = false;
texts.props.onClick({
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, true);
assert.equal(destinations.at(-1), 'Texts');
for (const name of ['Search', 'Collection', 'Lessons', 'Practice']) {
  const link = all.find((x) => x.props.href === '/?tab=' + name && !x.props['aria-label']);
  link.props.onClick({ preventDefault() {} });
  assert.equal(destinations.at(-1), name);
}
for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
  prevented = false;
  const before = destinations.length;
  texts.props.onClick({
    [modifier]: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(destinations.length, before);
}
const standalone = links(renderHeader({ active: 'Texts' })).find((x) => x.props.href === '/texts');
prevented = false;
standalone.props.onClick({
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, false); // native navigation remains a functional fallback
texts.props.onMouseEnter();
assert.ok(warmed.includes('/api/text-library'));
console.log(
  'PASS: Texts and all main navigation links invoke the internal view switch; modified clicks/native fallback preserve real URLs; data prefetch remains available.',
);
// The mobile disclosure remains operable without changing the real navigation URLs.
const headerProps = { active: 'Practice', onNavigate: (name) => destinations.push(name) };
let mobile = renderHeader(headerProps);
const toggle = () =>
  find(mobile, (node) => node.type === 'button' && 'aria-expanded' in node.props);
const navigation = () => find(mobile, (node) => node.type === 'nav');
assert.equal(toggle().props['aria-expanded'], false);
assert.equal(toggle().props['aria-controls'], navigation().props.id);
let focusedCurrent = 0,
  focusedToggle = 0;
const navTarget = {},
  toggleTarget = {};
headerRefs[0].current = {
  contains: (target) => target === navTarget,
  querySelector: () => ({
    focus() {
      focusedCurrent++;
    },
  }),
};
headerRefs[1].current = {
  contains: (target) => target === toggleTarget,
  focus() {
    focusedToggle++;
  },
};
function openMobile() {
  toggle().props.onClick();
  mobile = renderHeader(headerProps);
  assert.equal(toggle().props['aria-expanded'], true);
  return headerEffect();
}
let cleanup = openMobile();
assert.equal(focusedCurrent, 1);
documentEvents.get('pointerdown')({ target: navTarget });
assert.equal(headerOpen, true);
documentEvents.get('pointerdown')({ target: toggleTarget });
assert.equal(headerOpen, true);
let escapePrevented = false;
documentEvents.get('keydown')({
  key: 'Escape',
  preventDefault() {
    escapePrevented = true;
  },
});
assert.equal(headerOpen, false);
assert.equal(escapePrevented, true);
assert.equal(focusedToggle, 1);
cleanup();
assert.equal(documentEvents.size, 0);
assert.equal(windowEvents.size, 0);
assert.equal(mediaEvents.size, 0);
cleanup = openMobile();
documentEvents.get('pointerdown')({ target: {} });
assert.equal(headerOpen, false);
cleanup();
cleanup = openMobile();
const collectionLink = links(mobile).find((node) => node.props.href === '/?tab=Collection');
collectionLink.props.onClick({ preventDefault() {} });
assert.equal(headerOpen, false);
assert.equal(destinations.at(-1), 'Collection');
cleanup();
cleanup = openMobile();
windowEvents.get('popstate')();
assert.equal(headerOpen, false);
cleanup();
cleanup = openMobile();
mediaEvents.get('change')();
assert.equal(headerOpen, false);
cleanup();
console.log(
  'PASS: navigation starts closed, opens with linked disclosure state, focuses the active destination, closes on Escape/outside click/selection/history/resize, and removes event listeners.',
);

// Exercise the real App component's state transition without relying on a framework route swap.
let slots = [],
  cursor = 0;
const hookReact = {
  useState(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
    return [
      slots[n],
      (v) => {
        slots[n] = typeof v === 'function' ? v(slots[n]) : v;
      },
    ];
  },
  useRef(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = { current: initial };
    return slots[n];
  },
  useEffect() {},
  useMemo(f) {
    return f();
  },
};
const stubs = new Map(),
  stub = (name) => {
    if (!stubs.has(name)) stubs.set(name, function Component() {});
    return { default: stubs.get(name) };
  };
const location = new URL('https://example.test/'),
  appExports = {};
const cacheApi = {
  clientData: { peek: () => undefined },
  readJson: async () => [],
  dataChanged() {},
};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: appExports,
    URLSearchParams,
    window: {
      location,
      history: {
        pushState(_state, _title, url) {
          const next = new URL(url, location);
          location.href = next.href;
        },
      },
    },
    require(name) {
      if (name.includes('use-collection-index'))
        return { default: () => ({ has: () => false, status: () => 'new' }) };
      if (name.endsWith('/collection-index'))
        return {
          collectionDutch: (title, article) => (article ? article + ' ' + title : title),
          collectionBookmark: (index, nl, en, lemma, label, busy, className = 'icon-button') => ({
            className,
            'aria-label': label,
            disabled: busy,
          }),
        };
      if (name === 'next/link') return { default: 'a' };
      if (name === 'next/image') return { default: 'img' };
      if (name === 'react') return hookReact;
      if (name.includes('client-data')) return cacheApi;
      if (name.startsWith('./components/')) return stub(name);
      if (name.startsWith('../lib/')) return {};
      return require(name);
    },
  },
);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const render = (props) => {
  cursor = 0;
  return appExports.default(props);
};
let app = render();
const nav = () =>
  find(app, (n) => n.type === stubs.get('./components/app-header')).props.onNavigate;
nav()('Texts');
app = render();
let reader = find(app, (n) => n.type === stubs.get('./components/texts-reader'));
assert.ok(reader);
assert.equal(reader.props.visible, true);
assert.equal(location.pathname, '/texts');
assert.equal(find(app, (n) => n.props?.className === 'app').props.hidden, true);
reader.props.onNavigate('Collection');
app = render();
reader = find(app, (n) => n.type === stubs.get('./components/texts-reader'));
assert.equal(reader.props.visible, false);
assert.equal(find(app, (n) => n.props?.className === 'app').props.hidden, false);
assert.equal(location.search, '?tab=Collection');
nav()('Texts');
app = render();
assert.equal(
  find(app, (n) => n.type === stubs.get('./components/texts-reader')).props.visible,
  true,
);
slots = [];
app = render({ initialTab: 'Texts' });
assert.equal(
  find(app, (n) => n.type === stubs.get('./components/texts-reader')).props.visible,
  true,
);
console.log(
  'PASS: real App opens Texts, returns to Collection, retains the reader across toggles, and supports the direct Texts route.',
);
slots = [];
app = render({ initialTab: 'Lessons' });
assert.equal(find(app, (n) => n.type === stubs.get('./components/lessons')).props.visible, true);
nav()('Search');
app = render();
assert.equal(find(app, (n) => n.type === stubs.get('./components/lessons')).props.visible, false);
nav()('Lessons');
app = render();
assert.equal(location.search, '?tab=Lessons');
assert.equal(find(app, (n) => n.type === stubs.get('./components/lessons')).props.visible, true);
console.log('PASS: Lessons has a real destination and retains its mounted view across navigation.');
