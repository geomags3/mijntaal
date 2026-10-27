const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  cache = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!file.endsWith('.ts')) file += '.ts';
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
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
const core = load('lib/words'),
  journal = load('lib/words-journal'),
  progress = load('lib/word-progress');
const day = '2026-10-26';
const names = [
  ['kat', 'cat'],
  ['hond', 'dog'],
  ['huis', 'house'],
  ['fiets', 'bicycle'],
  ['tafel', 'table'],
  ['stoel', 'chair'],
];
function units() {
  return names.map(([nl, en], i) =>
    core.makeUnit(
      { id: 'u' + i, title: nl, body: { en, partOfSpeech: 'noun' } },
      core.initialWordState('content' + i, day),
    ),
  );
}
function session(stage = 'intro', days) {
  const pool = units(),
    u = pool[0];
  u.state.stage = stage;
  if (days) u.state.intervalDays = days;
  const s = {
    algorithm: 2,
    preferences: { ...core.defaultWordPreferences },
    choicePool: pool.map(({ id, nl, en, lemma, partOfSpeech, alternatives }) => ({
      id,
      nl,
      en,
      lemma,
      partOfSpeech,
      alternatives,
    })),
    id: 'daily-fixture',
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
  core.nextWordQuestion(s);
  return s;
}
const act = (s, a, v = '') => core.applyWordAction(s, a, v, 0);
function answer(s) {
  const q = s.question,
    u = s.units.find((u) => u.id === q.unitId);
  return act(
    s,
    q.kind === 'intro' ? 'continue' : 'answer',
    q.kind === 'self' ? 'yes' : q.direction === 'nl-en' ? u.en : u.nl,
  );
}
let s = session(),
  introduced = answer(s);
assert.equal(introduced.closed, true);
assert.equal(introduced.units[0].state.stage, 'recognize');
assert.equal(introduced.units[0].state.due, '2026-10-27');
assert.equal(introduced.units[0].state.introducedDay, day);
assert.equal(introduced.turn, 1);
for (const [stage, kind, next, delay] of [
  ['recognize', 'choice', 'build', 3],
  ['build', 'build', 'recall', 7],
  ['recall', 'typing', 'review', 14],
]) {
  s = session(stage);
  assert.equal(s.question.kind, kind);
  const done = answer(s);
  assert.equal(done.units[0].state.stage, next);
  assert.equal(done.units[0].state.due, core.addDays(day, delay));
  assert.equal(done.units[0].done, true);
  assert.equal(
    done.units[0].state.introducedDay,
    undefined,
    'migrated learning does not consume new allowance',
  );
  assert.equal(act(done, 'next').closed, true);
}
for (const [mode, delay] of [
  ['typing', 14],
  ['letters', 10],
  ['choices', 7],
]) {
  s = session('review', 7);
  s = act(s, 'mode', mode);
  const done = answer(s);
  assert.equal(done.units[0].state.intervalDays, delay);
  assert.equal(done.units[0].state.stage, 'review');
  assert.equal(done.units[0].done, true);
}
s = session('review', 7);
s = act(act(s, 'mode', 'choices'), 'mode', 'typing');
assert.equal(
  answer(s).units[0].state.intervalDays,
  7,
  'switching back cannot erase exposed choices',
);
s = session('review', 7);
s = act(act(s, 'mode', 'letters'), 'mode', 'typing');
assert.equal(answer(s).units[0].state.intervalDays, 10);
s = session('review', 7);
s = act(s, 'hint');
assert.equal(answer(s).units[0].state.intervalDays, 3);
assert.equal(answer(s).feedback.outcome, 'supported');
s = session('review', 60);
assert.equal(answer(s).units[0].state.intervalDays, 60);
s = session('review');
s.units[0].state.interval = 3;
assert.equal(core.reviewDays(s.units[0].state), 14);
assert.equal(answer(s).units[0].state.intervalDays, 30, 'preserve old review interval');
s = session();
s = act(s, 'known');
assert.equal(s.question.kind, 'typing');
assert.equal(s.question.knownCheck, true);
assert.equal(answer(s).units[0].state.intervalDays, 3);
assert.equal(answer(s).units[0].state.stage, 'review');
const failedKnown = act(s, 'answer', 'wrong');
assert.equal(failedKnown.units[0].state.stage, 'recognize');
assert.equal(failedKnown.units[0].state.due, '2026-10-27');
s = session('review', 7);
s.preferences.repeatMistakes = false;
const failed = act(s, 'dontknow');
assert.equal(failed.units[0].done, true);
assert.equal(act(failed, 'next').closed, true);
const accepted = act(failed, 'accept');
assert.equal(accepted.units[0].state.stage, 'review');
assert.equal(accepted.units[0].state.due, '2026-10-27');
// One retry after three other exercises, never an immediate duplicate or a second retry.
s = session('review', 7);
s.units = [s.units[0], ...units().slice(1, 4)];
s = act(s, 'answer', 'wrong');
s = act(s, 'next');
for (let i = 0; i < 3; i++) {
  assert.notEqual(s.question.unitId, 'u0');
  s = answer(s);
  if (s.feedback) s = act(s, 'next');
}
assert.equal(s.question.unitId, 'u0');
s = answer(s);
assert.equal(s.units[0].state.intervalDays, 1);
s = act(s, 'next');
assert.equal(s.closed, true);
assert.equal(s.units[0].attempts, 2);
s = session('review', 7);
s = act(act(s, 'answer', 'wrong'), 'next');
assert.equal(s.closed, true, 'too few other cards means no rapid retry');
s = session('recall', 7);
s.choicePool = [];
s = act(s, 'mode', 'choices');
assert.equal(s.question.kind, 'build', 'unavailable choices fall back to letters');
assert.equal(s.question.maxHelp, 1);
s = session('review', 7);
const skipped = act(s, 'skip');
assert.equal(skipped.closed, true);
assert.equal(skipped.units[0].state.lastSeenDay, day);
assert.equal(skipped.units[0].state.due, '2026-10-27');
// Mode changes are replayable journal events, including the maximum revealed assistance.
let j = { base: { session: session('review', 7), revision: 1 }, events: [] };
j = journal.journalAppend(j, 'mode', 'choices', 0);
j = journal.journalAppend(j, 'mode', 'typing', 0);
const sent = structuredClone(j);
j = journal.journalAppend(j, 'answer', 'kat', 0);
const result = { session: journal.journalView(sent).session, revision: 3 };
const acknowledged = journal.journalAck(j, sent, result);
assert.equal(journal.journalView(acknowledged).session.units[0].state.intervalDays, 7);
assert.equal(
  JSON.stringify(journal.restoreJournal(JSON.stringify(acknowledged))),
  JSON.stringify(acknowledged),
);
for (const [due, label] of [
  ['2026-10-25', 'Today'],
  ['2026-10-26', 'Today'],
  ['2026-10-27', '1d'],
  ['2026-10-29', '3d'],
  ['2026-11-25', '30d'],
])
  assert.equal(
    progress.dueLabel({
      ...progress.learningProgress(
        { ...core.initialWordState('x', day), stage: 'build', due },
        day,
      ),
    }),
    label,
  );
assert.equal(
  progress.dueLabel(progress.learningProgress(core.initialWordState('x', day), day)),
  'New',
);
assert.equal(core.wordSessionSchema.safeParse(session()).success, true);
assert.equal(core.wordPreferencesSchema.safeParse({ newWordsPerDay: -1 }).success, false);
console.log(
  'PASS: daily stages, all answer modes and interval growth, assistance exposure, hints, known-word shortcut, bounded spaced error retry, skip/accept, old state compatibility, journal rebasing and compact due labels.',
);
