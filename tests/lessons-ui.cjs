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
  savedRuns = [],
  serverDeleted = false,
  holdNextList = false,
  releaseList,
  focusListener,
  networkCalls = 0,
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
    if (!old || deps.some((d, i) => d !== old.deps[i])) {
      old?.cleanup?.();
      const state = { deps, cleanup: undefined };
      slots[n] = state;
      effects.push(() => {
        state.cleanup = effect();
      });
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
          if (target.endsWith('.json'))
            return { default: JSON.parse(fs.readFileSync(target, 'utf8')) };
          return load(fs.existsSync(target + '.tsx') ? target + '.tsx' : target + '.ts');
        }
        return require(name);
      },
      fetch: async (url, options) => {
        networkCalls++;
        if (!options?.method && serverDeleted && url !== '/api/programs')
          return url.includes('?id=')
            ? Response.json({ error: 'Lesson not found.' }, { status: 404 })
            : Response.json([]);
        if (!options?.method && url === '/api/lessons' && holdNextList) {
          holdNextList = false;
          const stale = Response.json([
            {
              ...server,
              title: server.content.title,
              description: server.content.description,
              minutes: 5,
            },
          ]);
          return new Promise((resolve) => {
            releaseList = () => resolve(stale);
          });
        }
        if (!options?.method)
          return Response.json(
            url === '/api/programs'
              ? []
              : url.includes('history=true')
                ? savedRuns
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
                        progress: server.progress
                          ? {
                              completed: server.progress.completed,
                              index: server.progress.index,
                              total: server.progress.content.blocks.length,
                              lessonVersion: server.progress.lessonVersion,
                            }
                          : null,
                      },
                    ],
          );
        const a = JSON.parse(options.body);
        calls.push(a);
        const failure = failNext;
        failNext = '';
        if (failure === 'conflict')
          return Response.json({ error: 'Progress changed elsewhere.' }, { status: 409 });
        if (options.method === 'DELETE') {
          serverDeleted = true;
          savedRuns = [];
          if (failure === 'lost') throw Error('Connection lost');
          return Response.json({ id: a.id, deleted: true });
        }
        if (!server.progress?.eventIds.includes(a.eventId)) {
          if (a.action === 'restart')
            savedRuns.push({
              id: server.progress.runId,
              lesson_version: server.progress.lessonVersion,
              completed: new Date().toISOString(),
              correct: 0,
              total: server.progress.results.length,
              finished: false,
            });
          if (a.action === 'start' || a.action === 'restart')
            server.progress = {
              runId: a.action === 'restart' ? 'new-run' : 'run',
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
      window: {
        addEventListener(name, listener) {
          if (name === 'focus') focusListener = listener;
        },
        removeEventListener(name, listener) {
          if (name === 'focus' && focusListener === listener) focusListener = undefined;
        },
        location: { reload() {} },
      },
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
  assert.ok(button(tree, 'Delete lesson')); // unstarted lessons can also be removed
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
  // Restart requires explicit confirmation; cancellation and Escape do not mutate progress.
  const confirmation = () =>
    nodes(tree, (n) => typeof n.type === 'function' && n.type.name === 'LessonConfirmation')[0];
  const attemptsBeforeConfirmation = calls.length;
  button(tree, 'Start over').props.onClick();
  tree = render();
  assert.ok(confirmation());
  let panel = confirmation().type(confirmation().props);
  assert.equal(calls.length, attemptsBeforeConfirmation);
  button(panel, 'Keep learning').props.onClick();
  tree = render();
  assert.equal(confirmation(), undefined);
  assert.equal(server.progress.index, 1);
  button(tree, 'Start over').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  let escaped = false;
  panel.props.onKeyDown({
    key: 'Escape',
    preventDefault() {
      escaped = true;
    },
    stopPropagation() {},
  });
  tree = render();
  assert.equal(escaped, true);
  assert.equal(confirmation(), undefined);
  assert.equal(calls.length, attemptsBeforeConfirmation);
  button(tree, 'Start over').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  failNext = 'lost';
  button(panel, 'Start over').props.onClick();
  await tick();
  tree = render();
  const lostRestart = calls.at(-1);
  assert.equal(lostRestart.action, 'restart');
  assert.ok(text(tree).includes('Connection lost'));
  assert.equal(button(tree, 'Start over').props.disabled, true);
  button(tree, 'Retry saving').props.onClick();
  await tick();
  tree = render();
  assert.deepEqual(calls.at(-1), lostRestart);
  assert.equal(savedRuns.length, 1);
  assert.ok(text(tree).includes('Step 1 of 2'));
  button(tree, 'Previous runs').props.onClick();
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Restarted'));
  button(tree, 'All lessons').props.onClick();
  tree = render();
  assert.match(text(button(tree, 'Dutch basics')), /Continue · 1\s*\/\s*2/);
  const card = nodes(tree, (n) => n.props?.className === 'lesson-library-card')[0];
  assert.equal(nodes(card, (n) => n.type === 'button').length, 1);
  assert.equal(nodes(tree, (n) => n.type === 'button' && text(n).includes('Start over')).length, 0);
  button(tree, 'Dutch basics').props.onClick();
  await tick();
  tree = render();
  assert.equal(confirmation(), undefined);
  assert.equal(calls.length, attemptsBeforeConfirmation + 2);
  // Permanent deletion also requires confirmation; Cancel and Escape are non-mutating.
  const attemptsBeforeDelete = calls.length;
  button(tree, 'Delete lesson').props.onClick();
  tree = render();
  assert.equal(confirmation().props.kind, 'delete');
  panel = confirmation().type(confirmation().props);
  assert.ok(text(panel).includes('cannot be undone'));
  assert.equal(calls.length, attemptsBeforeDelete);
  button(panel, 'Keep lesson').props.onClick();
  tree = render();
  assert.equal(confirmation(), undefined);
  assert.equal(serverDeleted, false);
  button(tree, 'Delete lesson').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  panel.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  tree = render();
  assert.equal(confirmation(), undefined);
  assert.equal(calls.length, attemptsBeforeDelete);
  button(tree, 'Delete lesson').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  failNext = 'conflict';
  button(panel, 'Delete permanently').props.onClick();
  await tick();
  tree = render();
  assert.equal(serverDeleted, false);
  assert.ok(text(tree).includes('Reload latest lesson'));
  assert.equal(button(tree, 'Delete lesson').props.disabled, true);
  button(tree, 'Reload latest lesson').props.onClick();
  await tick();
  tree = render();
  assert.equal(confirmation(), undefined); // requires fresh explicit confirmation after reload
  button(tree, 'Delete lesson').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  holdNextList = true;
  focusListener(); // an older library response must not resurrect the deleted card
  assert.equal(typeof releaseList, 'function');
  failNext = 'lost';
  button(panel, 'Delete permanently').props.onClick();
  await tick();
  tree = render();
  const lostDelete = calls.at(-1);
  assert.equal(lostDelete.confirm, true);
  assert.ok(text(tree).includes('Deletion could not be confirmed'));
  assert.equal(button(tree, 'All lessons').props.disabled, true);
  button(tree, 'Retry deletion').props.onClick();
  await tick();
  tree = render();
  assert.deepEqual(calls.at(-1), lostDelete);
  assert.equal(nodes(tree, (n) => n.props?.className === 'lesson-library-card').length, 0);
  releaseList();
  await tick();
  tree = render();
  assert.equal(nodes(tree, (n) => n.props?.className === 'lesson-library-card').length, 0);
  assert.ok(text(tree).includes('Your next lesson starts with a conversation'));
  assert.ok(text(tree).includes('@MijnTaal'));
  // Like the sample text, the sample lesson is fully local and never creates a record.
  const beforeSampleNetwork = networkCalls,
    beforeSampleWrites = calls.length;
  button(tree, 'Explore a sample lesson').props.onClick();
  tree = render();
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Sample · not saved'));
  assert.equal(
    nodes(tree, (n) => n.type === 'button' && text(n).includes('Delete lesson')).length,
    0,
  );
  assert.equal(
    nodes(tree, (n) => n.type === 'button' && text(n).includes('Previous runs')).length,
    0,
  );
  assert.equal(networkCalls, beforeSampleNetwork);
  button(tree, 'Continue').props.onClick();
  await tick();
  tree = render();
  const sampleExercise = nodes(
    tree,
    (n) => typeof n.type === 'function' && n.type.name === 'ExerciseView',
  )[0];
  assert.equal(sampleExercise.props.block.type, 'choice');
  const sampleSlots = slots;
  slots = [];
  let sampleView = render(sampleExercise.type, sampleExercise.props);
  const rightOption = nodes(
    sampleView,
    (n) => n.type === 'input' && n.props.value === String(sampleExercise.props.block.correct),
  )[0];
  rightOption.props.onChange();
  sampleView = render(sampleExercise.type, sampleExercise.props);
  nodes(sampleView, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  slots = sampleSlots;
  await tick();
  tree = render();
  assert.equal(
    nodes(tree, (n) => typeof n.type === 'function' && n.type.name === 'ExerciseView')[0].props
      .lesson.progress.feedback.correct,
    true,
  );
  button(tree, 'Start over').props.onClick();
  tree = render();
  panel = confirmation().type(confirmation().props);
  assert.ok(text(panel).includes('not saved to your account'));
  assert.ok(!text(panel).includes('Previous runs'));
  button(panel, 'Start over').props.onClick();
  await tick();
  tree = render();
  assert.match(text(tree), /Step 1 of/);
  assert.equal(networkCalls, beforeSampleNetwork);
  assert.equal(calls.length, beforeSampleWrites);
  assert.equal(serverDeleted, true);
  button(tree, 'All lessons').props.onClick();
  await tick();
  tree = render();
  assert.ok(text(tree).includes('Explore a sample lesson'));
  assert.equal(calls.length, beforeSampleWrites);
  const samples = load('lib/sample-lesson.ts');
  const pristine = samples.createSampleLesson();
  assert.throws(
    () =>
      samples.advanceSampleLesson(
        { ...pristine, id: 'owned-lesson' },
        { action: 'start', lessonId: 'owned-lesson', revision: 0, eventId: 'demo-owner-check' },
      ),
    /not a sample/,
  );
  const startedSample = samples.advanceSampleLesson(pristine, {
    action: 'start',
    lessonId: pristine.id,
    revision: 0,
    eventId: 'demo-start',
  });
  assert.equal(pristine.progress, null);
  const sampleNext = {
    action: 'continue',
    lessonId: pristine.id,
    revision: startedSample.revision,
    eventId: 'demo-next',
  };
  const nextSample = samples.advanceSampleLesson(startedSample, sampleNext);
  assert.equal(startedSample.progress.index, 0);
  assert.equal(samples.advanceSampleLesson(nextSample, sampleNext), nextSample);
  assert.equal(samples.createSampleLesson().progress, null);
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
