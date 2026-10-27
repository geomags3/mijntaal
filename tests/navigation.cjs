const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react');
const file = path.join(__dirname, '../app/components/app-header.tsx'),
  exportsObject = {};
let warmed = [];
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
    require(name) {
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
let destinations = [];
const header = exportsObject.default({
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
for (const name of ['Search', 'Collection', 'Practice']) {
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
const standalone = links(exportsObject.default({ active: 'Texts' })).find(
  (x) => x.props.href === '/texts',
);
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
