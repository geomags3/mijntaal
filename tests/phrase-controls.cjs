const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react'),
  assert = require('node:assert/strict'),
  { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..'),
  mods = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
  if (mods.has(file)) return mods.get(file);
  const exports = {};
  mods.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: (n) => (n.startsWith('.') ? load(path.resolve(path.dirname(file), n)) : require(n)),
    },
  );
  return exports;
}
const modes = load('lib/practice-mode'),
  Badge = load('app/components/practice-badge').default;
for (const mode of ['words', 'sentences', 'off']) {
  const html = renderToStaticMarkup(React.createElement(Badge, { mode }));
  assert.ok(html.includes('aria-label="Practice: ' + modes.practiceName(mode) + '"'));
  assert.ok(html.includes('title="Practice: '));
  assert.ok(html.includes('practice-badge-' + mode));
}
const fixtures = [
  { id: 'w', kind: 'phrase', title: 'helpen', body: { en: 'to help' }, practice: true, version: 1 },
  {
    id: 's',
    kind: 'phrase',
    title: 'een deel van het spel',
    body: { en: 'part of the game', practiceMode: 'sentences' },
    practice: true,
    version: 1,
  },
  {
    id: 'o',
    kind: 'phrase',
    title: 'een spoor van vernieling',
    body: { en: 'a trail of destruction' },
    practice: false,
    version: 1,
  },
];
let slots = [],
  cursor = 0,
  posts = [];
const hooks = {
  useState(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
    return [slots[n], (v) => (slots[n] = typeof v === 'function' ? v(slots[n]) : v)];
  },
  useRef(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = { current: initial };
    return slots[n];
  },
  useEffect() {},
  useMemo: (f) => f(),
};
const stubs = new Map(),
  stub = (n) => {
    if (!stubs.has(n)) stubs.set(n, function Component() {});
    return { default: stubs.get(n) };
  },
  ex = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: ex,
    require(n) {
      if (n.includes('use-collection-index'))
        return { default: () => ({ has: () => false, status: () => 'new' }) };
      if (n.endsWith('/collection-index'))
        return {
          collectionDutch: (title, article) => (article ? article + ' ' + title : title),
          collectionBookmark: (index, nl, en, lemma, label, busy, className = 'icon-button') => ({
            className,
            'aria-label': label,
            disabled: busy,
          }),
        };
      if (n === 'react') return hooks;
      if (n.endsWith('/practice-mode')) return modes;
      if (n.includes('client-data'))
        return {
          clientData: { peek: () => fixtures },
          readJson: async (p) =>
            p.startsWith('/api/materials') ? fixtures : { preferences: {}, audioReady: true },
          dataChanged() {},
        };
      if (n.startsWith('./components/')) return stub(n);
      if (n.startsWith('../lib/')) return {};
      return require(n);
    },
    window: { location: { pathname: '/', search: '' } },
    fetch: async (p, o) => {
      posts.push(JSON.parse(o.body));
      return { ok: true, json: async () => ({ id: 'saved', version: 1 }) };
    },
    setTimeout,
    clearTimeout,
  },
);
function find(n, p) {
  if (!n || typeof n !== 'object') return;
  if (p(n)) return n;
  for (const c of React.Children.toArray(n.props?.children)) {
    const hit = find(c, p);
    if (hit) return hit;
  }
}
function all(n, p, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (p(n)) out.push(n);
  for (const c of React.Children.toArray(n.props?.children)) all(c, p, out);
  return out;
}
const render = () => {
  cursor = 0;
  return ex.default({ initialTab: 'Collection' });
};
(async () => {
  let node = render();
  assert.deepEqual(
    all(node, (n) => n.type === stubs.get('./components/practice-badge')).map((n) => n.props.mode),
    ['words', 'sentences', 'off'],
  );
  const collection = all(node, (n) => n.props?.className === 'collection-learning');
  assert.ok(find(collection[0], (n) => n.type === stubs.get('./components/learning-progress')));
  assert.equal(
    find(collection[1], (n) => n.type === stubs.get('./components/learning-progress')),
    undefined,
    'sentence cards do not display a false Words due date',
  );
  find(
    node,
    (n) => n.type === 'button' && React.Children.toArray(n.props.children).includes('Add'),
  ).props.onClick();
  node = render();
  const field = (label) =>
    find(
      node,
      (n) => n.type === 'label' && React.Children.toArray(n.props.children).includes(label),
    );
  find(field('Dutch word or phrase'), (n) => n.type === 'input').props.onChange({
    target: { value: 'een deel van het spel' },
  });
  find(field('English meaning'), (n) => n.type === 'textarea').props.onChange({
    target: { value: 'part of the game' },
  });
  find(field('Source'), (n) => n.type === 'input').props.onChange({ target: { value: 'Teacher' } });
  find(node, (n) => n.type === stubs.get('./components/practice-mode-select')).props.onChange(
    'sentences',
  );
  node = render();
  await find(node, (n) => n.type === 'form' && find(n, (c) => c.type === 'label')).props.onSubmit({
    preventDefault() {},
  });
  assert.equal(posts[0].practice, true);
  assert.equal(posts[0].body.practiceMode, 'sentences');
  assert.equal(posts[0].body.source, 'Teacher');
  assert.equal(posts[0].title, 'een deel van het spel');
  console.log(
    'PASS: accessible compact badges, correct legacy modes, no Words due label for sentence cards, and real Collection editor saves phrase/source/Sentences mode together.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
