const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let slots = [],
  cursor = 0,
  effects = [],
  focus = 0,
  removed = [],
  resolveLookup;
const players = [];
const hooks = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], (v) => (slots[i] = typeof v === 'function' ? v(slots[i]) : v)];
  },
  useRef(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: initial };
    return slots[i];
  },
  useEffect(fn) {
    effects.push(fn);
  },
  useMemo: (fn) => fn(),
};
class AudioSequence {
  constructor(audio, changed) {
    this.changed = changed;
    this.calls = [];
    players.push(this);
  }
  start(text) {
    this.calls.push(text[0]);
    this.changed(-1, 'loading');
    return Promise.resolve();
  }
  stop() {
    this.changed(-1, 'idle');
  }
  pause() {
    this.changed(-1, 'paused');
  }
  resume() {
    this.changed(-1, 'playing');
  }
  dispose() {}
}
const stubs = new Map(),
  stub = (name) => {
    if (!stubs.has(name)) stubs.set(name, function Component() {});
    return { default: stubs.get(name) };
  },
  exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: exportsObject,
    window: { location: { pathname: '/', search: '' } },
    sessionStorage: { removeItem: (key) => removed.push(key) },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    require(name) {
      if (name === 'react') return hooks;
      if (name.includes('client-data')) return { clientData: { peek() {} } };
      if (name.includes('audio-sequence')) return { AudioSequence };
      if (name.includes('local-dictionary'))
        return { localLookup: () => new Promise((r) => (resolveLookup = r)) };
      if (name.startsWith('./components/')) return stub(name);
      if (name.startsWith('../lib/')) return {};
      return require(name);
    },
  },
);
function find(node, match) {
  if (!node || typeof node !== 'object') return;
  if (match(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const hit = find(child, match);
    if (hit) return hit;
  }
}
const render = () => {
    cursor = 0;
    effects = [];
    return exportsObject.default();
  },
  label = (n, l) => n.props?.['aria-label'] === l;
(async () => {
  let app = render();
  find(app, (n) => n.type === 'audio').props.ref.current = {};
  const init = effects.find((f) => f.toString().includes('new audio_sequence'));
  assert.ok(init);
  init();
  slots[0] = true; // authenticated settings allow speech
  app = render();
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.onChange({
    target: { value: 'zijn' },
  });
  app = render();
  find(app, (n) => label(n, 'Dutch sentence for context')).props.onChange({
    target: { value: 'Ik ben thuis.' },
  });
  app = render();
  const search = find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search');
  search.props.onSubmit({ preventDefault() {} });
  app = render();
  const clear = find(app, (n) => label(n, 'Clear search'));
  assert.equal(clear.props.type, 'button');
  assert.equal(clear.props.disabled, false);
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.ref.current = {
    focus() {
      focus++;
    },
  };
  clear.props.onClick();
  app = render();
  assert.equal(find(app, (n) => label(n, 'Search Dutch words or phrases')).props.value, '');
  assert.equal(find(app, (n) => label(n, 'Dutch sentence for context')).props.value, '');
  assert.equal(focus, 1);
  assert.ok(removed.includes('dutch-search-view'));
  assert.equal(find(app, (n) => label(n, 'Clear search')).props.disabled, true);
  resolveLookup({
    found: true,
    lemma: 'zijn',
    partOfSpeech: 'verb',
    forms: [{ label: 'present · first-person · singular', value: 'ben' }],
    senses: [],
    related: [],
  });
  await new Promise(setImmediate);
  app = render();
  assert.equal(
    find(app, (n) => n.props?.className === 'dictionary-entry'),
    undefined,
    'clearing invalidates pending lookups',
  );
  // Search again to inspect real form controls and call the root player through WordForms.
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.onChange({
    target: { value: 'zijn' },
  });
  app = render();
  find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search').props.onSubmit({
    preventDefault() {},
  });
  resolveLookup({
    found: true,
    lemma: 'zijn',
    partOfSpeech: 'verb',
    forms: [{ label: 'present · first-person · singular', value: 'ben' }],
    senses: [],
    related: [],
  });
  await new Promise(setImmediate);
  app = render();
  const formsType = stubs.get('./components/word-forms');
  let forms = find(app, (n) => n.type === formsType);
  assert.ok(forms);
  assert.ok(
    find(app, (n) => n.type === 'details' && n.props.open && find(n, (c) => c.type === formsType)),
    'forms start open',
  );
  forms.props.onSpeak('ben');
  app = render();
  forms = find(app, (n) => n.type === formsType);
  assert.equal(forms.props.currentAudio, 'ben');
  assert.equal(forms.props.audioState, 'loading');
  assert.deepEqual(players[0].calls, ['ben']);
  forms.props.onSpeak('ben');
  app = render();
  assert.equal(
    find(app, (n) => n.type === formsType).props.audioState,
    'idle',
    'second click cancels loading without starting another request',
  );
  assert.equal(players[0].calls.length, 1);
  console.log(
    'PASS: actual Search clear control resets query/context/results, focuses input, rejects stale lookups; Forms open by default, root pronunciation state propagated and repeated loading click cancels.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
