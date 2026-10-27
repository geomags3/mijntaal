const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict'),
  React = require('react');
const root = path.resolve(__dirname, '..'),
  modules = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (!file.endsWith('.ts')) file += '.ts';
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require: (n) => (n.startsWith('.') ? load(path.resolve(path.dirname(file), n)) : require(n)),
      crypto,
      structuredClone,
    },
  );
  return exports;
}
const words = load('lib/words'),
  day = '2026-10-26',
  u = words.makeUnit(
    { id: 'u', title: 'de polder', body: { en: 'polder' } },
    { ...words.initialWordState('content', day), stage: 'review', intervalDays: 7 },
  ),
  other = ['hond', 'kat', 'huis'].map((nl, i) =>
    words.makeUnit(
      { id: 'd' + i, title: nl, body: { en: ['dog', 'cat', 'house'][i] } },
      words.initialWordState('d' + i, day),
    ),
  );
const session = {
  algorithm: 2,
  preferences: words.defaultWordPreferences,
  choicePool: [u, ...other].map(({ id, nl, en, lemma, partOfSpeech, alternatives }) => ({
    id,
    nl,
    en,
    lemma,
    partOfSpeech,
    alternatives,
  })),
  id: 'ui-session',
  day,
  timeZone: 'Europe/Amsterdam',
  units: [u],
  turn: 0,
  cardLimit: 15,
  question: null,
  feedback: null,
  closed: false,
  elapsed: 0,
  correct: 0,
  wrong: 0,
  supported: 0,
};
words.nextWordQuestion(session);
const result = { session, revision: 1, scope: 'ui-owner' },
  storage = new Map(),
  drafts = new Map();
let slots = [],
  cursor = 0,
  stateCount = 0,
  refs = [],
  refCount = 0;
const hooks = {
  useState(initial) {
    const n = cursor++,
      ordinal = stateCount++;
    if (!(n in slots))
      slots[n] =
        ordinal === 0
          ? false
          : ordinal === 1
            ? result
            : ordinal === 2
              ? true
              : ordinal === 4
                ? false
                : typeof initial === 'function'
                  ? initial()
                  : initial;
    return [slots[n], (v) => (slots[n] = typeof v === 'function' ? v(slots[n]) : v)];
  },
  useRef(initial) {
    const n = cursor++,
      ordinal = refCount++;
    if (!(n in slots)) slots[n] = { current: initial };
    refs[ordinal] = slots[n];
    return slots[n];
  },
  useEffect() {},
};
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(root, 'app/components/words-practice.tsx'), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
  {
    exports: exportsObject,
    require(n) {
      if (n === 'react') return hooks;
      if (n.includes('use-word-audio')) return { default: () => ({ state: 'idle', play() {} }) };
      if (n.includes('client-data')) return { clientData: { peek() {} } };
      if (n.endsWith('words-journal')) return load('lib/words-journal');
      if (n.endsWith('/words')) return words;
      if (n.endsWith('/word-progress')) return load('lib/word-progress');
      if (n.endsWith('/practice-input')) return load('lib/practice-input');
      if (n.startsWith('.')) return { default: () => null };
      return require(n);
    },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    sessionStorage: { getItem: (k) => drafts.get(k) || null, setItem: (k, v) => drafts.set(k, v) },
    structuredClone,
    crypto,
    queueMicrotask,
  },
);
function find(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (fn(node)) return node;
  for (const c of React.Children.toArray(node.props?.children)) {
    const hit = find(c, fn);
    if (hit) return hit;
  }
}
const render = () => {
  cursor = 0;
  stateCount = 0;
  refCount = 0;
  return exportsObject.default({
    onCollection() {},
    onChanged() {},
    onSpeak() {},
    audioReady: true,
    request: async () => {
      throw Error('No network expected before completing this round');
    },
  });
};
let node = render();
const j = { base: result, events: [] };
refs[0].current = j;
refs[4].current = 'ui-owner';
storage.set('words-journal:ui-owner', JSON.stringify(j));
assert.ok(find(node, (n) => n.props?.['aria-label'] === 'Answer format'));
find(node, (n) => n.type === 'button' && n.props.children === 'Choices').props.onClick();
node = render();
assert.ok(find(node, (n) => n.props?.className === 'words-options'));
assert.equal(refs[0].current.events[0].action, 'mode');
find(node, (n) => n.type === 'button' && n.props.children === 'Letters').props.onClick();
node = render();
assert.ok(find(node, (n) => n.props?.className === 'words-bank'));
find(node, (n) => n.type === 'button' && n.props.children === 'Type').props.onClick();
node = render();
const input = find(node, (n) => n.type === 'input' && n.props.placeholder === 'Type in Dutch…');
assert.ok(input);
input.props.onChange({ target: { value: 'de polder' } });
node = render();
find(node, (n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
node = render();
assert.ok(find(node, (n) => n.props?.className === 'words-feedback '));
assert.ok(find(node, (n) => n.props?.className === 'words-next-review'));
assert.equal(
  load('lib/words-journal').journalView(refs[0].current).session.units[0].state.intervalDays,
  7,
  'UI does not lose assistance history',
);
console.log(
  'PASS: actual Words card switches Choices / Letters / Type, submits typed answer through local journal, retains revealed assistance and shows next review without a server check.',
);
