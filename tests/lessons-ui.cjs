const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react');
const root = path.resolve(__dirname, '..'),
  cache = new Map();
let slots = [],
  cursor = 0,
  effects = [],
  calls = [],
  failNext = '',
  server;
const hooks = {
  useState(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
    const stateSlots = slots;
    return [
      stateSlots[n],
      (v) => {
        stateSlots[n] = typeof v === 'function' ? v(stateSlots[n]) : v;
      },
    ];
  },
  useRef(initial) {
    const n = cursor++;
    return (slots[n] ||= { current: initial });
  },
  useEffect(effect, deps) {
    const n = cursor++;
    const old = slots[n];
    if (!old || deps.some((d, i) => d !== old[i])) {
      slots[n] = deps;
      effects.push(effect);
    }
  },
};
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const out = {};
  cache.set(file, out);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports: out,
      require(name) {
        if (name === 'react') return hooks;
        if (name.startsWith('.')) {
          const target = path.resolve(path.dirname(file), name);
          return load(fs.existsSync(target + '.tsx') ? target + '.tsx' : target + '.ts');
        }
        return require(name);
      },
      fetch: async (url, options) => {
        if (!options?.method)
          return Response.json(
            url === '/api/programs'
              ? []
              : url.includes('?id=')
                ? server
                : [
                    {
                      id: server.id,
                      version: server.version,
                      title: server.content.title,
                      description: server.content.description,
                      minutes: 5,
                      programId: null,
                      progress: server.progress,
                    },
                  ],
          );
        const a = JSON.parse(options.body);
        calls.push(a);
        const failure = failNext;
        failNext = '';
        if (failure === 'conflict')
          return Response.json({ error: 'Progress changed elsewhere.' }, { status: 409 });
        if (!server.progress?.eventIds.includes(a.eventId)) {
          if (a.action === 'start')
            server.progress = {
              runId: 'run',
              content: server.content,
              lessonVersion: 1,
              index: 0,
              results: [],
              hinted: false,
              revealed: false,
              feedback: null,
              eventIds: [a.eventId],
              completed: false,
            };
          else server.progress = model.applyLessonAction(server.progress, a);
          server.revision++;
        }
        if (failure === 'lost') throw Error('Connection lost');
        return Response.json(server);
      },
      window: { addEventListener() {}, removeEventListener() {}, location: { reload() {} } },
      crypto,
      structuredClone,
      URL,
      Response,
      AbortSignal,
    },
    { filename: file },
  );
  return out;
}
const model = load('lib/lessons.ts'),
  view = load('app/components/lessons.tsx');
const content = {
  title: 'Dutch basics',
  description: 'Short exercises.',
  goal: 'Use a Dutch verb.',
  minutes: 5,
  blocks: [
    { id: 'intro', type: 'explanation', text: 'The verb comes second.' },
    {
      id: 'gap',
      type: 'gap',
      prompt: 'Fill the verb',
      sentence: 'Ik ___ naar huis.',
      answers: ['fiets'],
      explanation: 'Ik takes fiets.',
    },
  ],
};
server = {
  id: 'lesson',
  version: 1,
  content,
  programId: null,
  topicId: null,
  archived: false,
  order: 0,
  revision: 0,
  progress: null,
};
function nodes(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  for (const child of React.Children.toArray(node.props?.children)) nodes(child, predicate, out);
  return out;
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  return React.Children.toArray(node.props?.children)
    .map(text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function render(component = view.default, props = { visible: true }) {
  cursor = 0;
  const tree = component(props);
  const queue = effects;
  effects = [];
  for (const effect of queue) effect();
  return tree;
}
function button(tree, label) {
  const b = nodes(tree, (n) => n.type === 'button' && text(n).includes(label))[0];
  assert.ok(b, `Missing button: ${label}`);
  return b;
}
const tick = () => new Promise((r) => setImmediate(r));
(async () => {
  let tree = render();
  await tick();
  tree = render();
  button(tree, 'Dutch basics').props.onClick();
  await tick();
  tree = render();
  button(tree, 'Start lesson').props.onClick();
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Step 1 of 2'));
  failNext = 'lost';
  button(tree, 'Continue').props.onClick();
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Connection lost'));
  assert.equal(button(tree, 'All lessons').props.disabled, true);
  const failed = calls.at(-1);
  button(tree, 'Retry saving').props.onClick();
  await tick();
  tree = render();
  assert.deepEqual(calls.at(-1), failed);
  assert.ok(text(tree).includes('Step 2 of 2'));
  assert.equal(server.revision, 2);
  const exerciseNode = nodes(
    tree,
    (n) => typeof n.type === 'function' && n.type.name === 'ExerciseView',
  )[0];
  // Render the real exercise with its own hook slots.
  const parentSlots = slots;
  slots = [];
  let exercise = render(exerciseNode.type, exerciseNode.props);
  assert.equal(button(exercise, 'Check answer').props.disabled, true);
  nodes(exercise, (n) => n.type === 'input')[0].props.onChange({ target: { value: 'fiets' } });
  exercise = render(exerciseNode.type, exerciseNode.props);
  assert.equal(button(exercise, 'Check answer').props.disabled, false);
  failNext = 'conflict';
  nodes(exercise, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  slots = parentSlots;
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Progress changed elsewhere.'));
  assert.equal(
    nodes(tree, (n) => n.type === 'button' && text(n).includes('Retry saving')).length,
    0,
  );
  button(tree, 'Reload saved progress').props.onClick();
  await tick();
  tree = render();
  assert.ok(!text(tree).includes('Progress changed elsewhere.'));
  // Repeated letter blocks keep individual identities and can be removed separately.
  const sent = [],
    block = {
      id: 'letters',
      type: 'letters',
      prompt: 'Build boom',
      tokens: ['b', 'o', 'o', 'm'],
      answers: ['boom'],
      explanation: 'Boom means tree.',
    };
  const props = { ...exerciseNode.props, block, busy: false, send: (...a) => sent.push(a) };
  slots = [];
  exercise = render(exerciseNode.type, props);
  for (const index of [0, 1, 2, 3]) {
    nodes(exercise, (n) => n.props?.className === 'lesson-tokens')[0].props.children[
      index
    ].props.onClick();
    exercise = render(exerciseNode.type, props);
  }
  const built = nodes(exercise, (n) => n.props?.['aria-label'] === 'Your answer')[0];
  assert.equal(React.Children.toArray(built.props.children).length, 4);
  assert.equal(button(exercise, 'Check answer').props.disabled, false);
  nodes(exercise, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(sent[0][0], 'check');
  assert.equal(new Set(sent[0][1].answer).size, 4);
  // Reloaded feedback shows the recorded answer rather than a blank editable form.
  const feedbackProps = {
    ...props,
    lesson: {
      ...props.lesson,
      progress: {
        ...props.lesson.progress,
        feedback: {
          blockId: 'letters',
          answer: 'boom',
          correct: true,
          helped: false,
          selfAssessed: false,
        },
      },
    },
  };
  exercise = render(exerciseNode.type, feedbackProps);
  assert.ok(text(exercise).includes('Your answer: boom'));
  assert.equal(nodes(exercise, (n) => n.type === 'form').length, 0);
  console.log(
    'PASS: lesson navigation, lost-response retry IDs, pending-action guards, conflict reload, repeated blocks, answer availability and resumed feedback.',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
