// Actual component hooks, deterministic clock and synthetic HTTP responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
const source = ts.transpileModule(
  fs.readFileSync(path.join(root, 'app/components/live-translation.tsx'), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join('');
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function fixture(lemma, meaning = 'English meaning') {
  return {
    found: true,
    lemma,
    article: '',
    ipa: '',
    partOfSpeech: '',
    forms: [],
    related: [],
    senses: [{ meaning, example: '', exampleTranslation: '', usage: '' }],
    source: 'Azure translation',
    translationProvider: 'azure',
  };
}
function mount(initial = {}) {
  const slots = [],
    requests = [],
    saves = [],
    copies = [],
    spoken = [],
    results = [];
  const timers = new Map();
  let cursor = 0,
    nextTimer = 1,
    now = 0,
    dirty = true,
    tree,
    effects = [],
    searches = 0;
  let props = {
    query: 'home',
    context: '',
    language: 'en',
    enabled: true,
    paused: false,
    coveredBySearch: false,
    saving: false,
    audioReady: true,
    onResult: (result) => results.push(result),
    onSpeak: (value) => spoken.push(value),
    onSearch: () => searches++,
    ...initial,
  };
  const hooks = {
    useState(initialValue) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [
        slots[i],
        (value) => {
          const next = typeof value === 'function' ? value(slots[i]) : value;
          if (!Object.is(next, slots[i])) {
            slots[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initialValue) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initialValue };
      return slots[i];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        slots[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[i].cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const exported = {};
  vm.runInNewContext(source, {
    exports: exported,
    AbortController,
    setTimeout: (fn, delay) => {
      const id = nextTimer++;
      timers.set(id, { fn, time: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    navigator: { clipboard: { writeText: async (value) => copies.push(value) } },
    fetch: (url, options) =>
      new Promise((resolve) =>
        requests.push({ url, body: JSON.parse(options.body), signal: options.signal, resolve }),
      ),
    require: (name) =>
      name === 'react'
        ? hooks
        : name === 'lucide-react'
          ? { Bookmark: 'Bookmark', Copy: 'Copy', LoaderCircle: 'LoaderCircle', Volume2: 'Volume2' }
          : require(name),
  });
  function render(changes = {}) {
    props = { ...props, ...changes };
    let iterations = 0;
    do {
      assert.ok(iterations++ < 20, 'hook harness settles');
      dirty = false;
      cursor = 0;
      effects = [];
      tree = exported.default(props);
      for (const effect of effects) effect();
    } while (dirty);
    return tree;
  }
  async function flush() {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    return render();
  }
  async function advance(milliseconds) {
    const target = now + milliseconds;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.time <= target)
        .sort((a, b) => a[1].time - b[1].time)[0];
      if (!due) break;
      now = due[1].time;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
    return flush();
  }
  function respond(index, entry, ok = true) {
    requests[index].resolve({ ok, json: async () => entry });
  }
  function button(label) {
    return find(tree, (node) => node.type === 'button' && text(node).trim() === label);
  }
  function unmount() {
    for (const slot of slots) if (slot && typeof slot.cleanup === 'function') slot.cleanup();
  }
  render();
  return {
    render,
    flush,
    advance,
    respond,
    button,
    unmount,
    requests,
    saves,
    copies,
    spoken,
    results,
    get tree() {
      return tree;
    },
    get searches() {
      return searches;
    },
  };
}
(async () => {
  const app = mount();
  await app.advance(250);
  app.render({ query: 'homew' });
  await app.advance(499);
  assert.equal(app.requests.length, 0, 'typing resets the 500ms debounce');
  await app.advance(1);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/lookup');
  assert.equal(app.requests[0].body.query, 'homew');
  assert.equal(
    app.requests[0].body.live,
    true,
    'live policy is explicit; backend can prevent AI fallback',
  );
  assert.equal(app.requests[0].body.sourceLanguage, 'en');
  assert.equal(app.requests[0].body.targetLanguage, 'nl');
  const initial = fixture('huiswerk', 'homework');
  app.respond(0, initial);
  await app.flush();
  assert.equal(app.tree, null, 'result is rendered by the shared parent card');
  assert.equal(app.results[0].entry, initial, 'parent receives the exact Dutch entry');
  assert.equal(app.results[0].input, 'homew');
  app.render({ query: 'another' });
  assert.match(text(app.tree), /Updating translation/);
  assert.equal(app.results.length, 1, 'editing cannot deliver a stale result');
  await app.advance(500);
  app.render({ query: 'latest' });
  assert.equal(app.requests[1].signal.aborted, true, 'new input cancels obsolete HTTP requests');
  await app.advance(500);
  app.respond(2, fixture('nieuwste'));
  await app.flush();
  app.respond(1, fixture('oud'));
  await app.flush();
  assert.equal(app.results.at(-1).entry.lemma, 'nieuwste');
  assert.equal(app.results.length, 2, 'late response cannot reach the shared result card');
  assert.equal(app.tree, null);
  app.render({ query: 'to clear' });
  app.render({ query: '' });
  await app.advance(500);
  assert.equal(app.tree, null);
  assert.equal(app.requests.length, 3, 'clear cancels the pending debounce');
  app.render({ query: 'in flight' });
  await app.advance(500);
  app.render({ query: '' });
  assert.equal(app.requests[3].signal.aborted, true, 'clear aborts an in-flight translation');
  app.respond(3, fixture('old after clear'));
  await app.flush();
  assert.equal(app.tree, null);
  app.unmount();

  const paused = mount({ query: 'composing', paused: true });
  await paused.advance(1000);
  assert.equal(paused.requests.length, 0, 'composition pause does not send partial text');
  paused.render({ paused: false });
  await paused.advance(500);
  assert.equal(paused.requests.length, 1);
  paused.render({ language: 'nl', context: 'new sentence' });
  assert.equal(
    paused.requests[0].signal.aborted,
    true,
    'direction/context changes cancel the old request',
  );
  await paused.advance(500);
  assert.equal(paused.requests[1].body.sourceLanguage, 'nl');
  assert.equal(paused.requests[1].body.targetLanguage, 'en');
  paused.respond(1, fixture('composing', 'English displayed'));
  await paused.flush();
  assert.equal(paused.results[0].entry.senses[0].meaning, 'English displayed');
  paused.unmount();

  const disabled = mount({ enabled: false });
  await disabled.advance(1000);
  assert.equal(disabled.requests.length, 0);
  assert.equal(disabled.tree, null);
  disabled.render({ enabled: true, coveredBySearch: true });
  await disabled.advance(1000);
  assert.equal(
    disabled.requests.length,
    0,
    'submitted translation does not trigger a duplicate live call',
  );
  disabled.render({ coveredBySearch: false });
  await disabled.advance(500);
  disabled.respond(0, { error: 'Synthetic Azure failure' }, false);
  await disabled.flush();
  assert.match(text(disabled.tree), /Live translation is unavailable/);
  assert.equal(disabled.requests.length, 1, 'component does not invoke another provider itself');
  disabled.button('Search').props.onClick();
  assert.equal(disabled.searches, 1, 'user can explicitly request manual fallback');
  disabled.unmount();
  console.log(
    'PASS: live typing debounce, cancellation, stale-result protection, shared-card delivery, direction/context, clear/composition/disabled gates and explicit manual fallback. Synthetic HTTP only.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
