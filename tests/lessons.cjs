const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  sqlite = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
let beforeBatch;
function statement(sql, values = []) {
  return {
    bind(...args) {
      return statement(sql, args);
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...values) };
      return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
    },
  };
}
const env = {
  DB: {
    prepare: statement,
    async batch(statements) {
      if (beforeBatch) {
        const hook = beforeBatch;
        beforeBatch = null;
        hook();
      }
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  },
};
const cache = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!file.endsWith('.ts')) file += '.ts';
  if (cache.has(file)) return cache.get(file);
  const output = {};
  cache.set(file, output);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports: output,
      require(name) {
        if (name === 'cloudflare:workers') return { env };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
        return require(name);
      },
      crypto,
      structuredClone,
      URL,
      Request,
      Response,
      TextEncoder,
      console,
      fetch() {
        throw Error('Lesson operations must not call a provider.');
      },
    },
    { filename: file },
  );
  return output;
}
const model = load('lib/lessons'),
  service = load('lib/server/lessons');
const exercise = {
  prompt: 'Choose the Dutch answer',
  explanation: 'The verb follows the subject.',
  hint: 'Look for the verb.',
};
const blocks = [
  {
    id: 'intro',
    type: 'explanation',
    heading: 'Word order',
    text: 'Dutch main clauses put the finite verb second.',
  },
  { id: 'table', type: 'table', columns: ['Dutch', 'English'], rows: [['Ik fiets.', 'I cycle.']] },
  { id: 'diagram', type: 'diagram', steps: ['Subject', 'Verb', 'Rest'] },
  { id: 'image', type: 'image', url: 'https://example.test/bike.png', alt: 'A bicycle' },
  { ...exercise, id: 'card', type: 'flashcard', answer: 'de fiets' },
  {
    ...exercise,
    id: 'choice',
    type: 'choice',
    options: ['Ik fiets.', 'Fiets ik.', 'Ik fietsen.', 'Fietsen ik.'],
    correct: 0,
  },
  { ...exercise, id: 'letters', type: 'letters', tokens: ['b', 'o', 'o', 'm'], answers: ['boom'] },
  {
    ...exercise,
    id: 'words',
    type: 'words',
    tokens: ['Ik', 'fiets', 'naar', 'huis'],
    answers: ['Ik fiets naar huis', 'Naar huis fiets ik.'],
  },
  {
    ...exercise,
    id: 'match',
    type: 'match',
    pairs: [
      { left: 'fiets', right: 'bicycle' },
      { left: 'huis', right: 'house' },
    ],
  },
  { ...exercise, id: 'gap', type: 'gap', sentence: 'Ik ___ naar huis.', answers: ['fiets'] },
  {
    ...exercise,
    id: 'gap-choice',
    type: 'gap',
    sentence: 'Zij ___ thuis.',
    answers: ['is'],
    options: ['is', 'zijn', 'ben', 'bent'],
  },
];
const content = {
  title: 'Dutch word order',
  description: 'An introductory lesson.',
  goal: 'Build a short Dutch sentence.',
  level: 'A1',
  minutes: 10,
  blocks,
};
function check(b, answer) {
  return model.checkLessonAnswer(b, answer).correct;
}
const byType = (t) => blocks.find((b) => b.type === t);
const copy = (value) => JSON.parse(JSON.stringify(value));
function invalid(change) {
  const c = copy(content);
  change(c);
  assert.equal(model.lessonContentSchema.safeParse(c).success, false);
}
(async () => {
  assert.equal(model.lessonContentSchema.safeParse(content).success, true);
  assert.equal(check(byType('gap'), '  FIETS! '), true);
  assert.equal(check(byType('gap'), 'fietsen'), false);
  assert.equal(check(byType('words'), [0, 1, 2, 3]), true);
  assert.equal(check(byType('words'), [2, 3, 1, 0]), true);
  assert.equal(check(byType('letters'), [0, 2, 1, 3]), true);
  assert.throws(() => check(byType('letters'), [0, 1, 1, 3]), /every block/);
  assert.equal(check(byType('choice'), '0'), true);
  assert.equal(check(byType('choice'), '1'), false);
  assert.throws(() => check(byType('choice'), '99'), /four/);
  assert.equal(check(byType('match'), [0, 1]), true);
  assert.equal(check(byType('match'), [1, 0]), false);
  assert.throws(() => check(byType('match'), [0, 0]), /once/);
  invalid((c) => c.blocks.push(c.blocks[0]));
  invalid((c) => c.blocks[1].rows[0].push('extra'));
  invalid((c) => (c.blocks[3].url = 'javascript:alert(1)'));
  invalid((c) => (c.blocks[3].url = 'https://alice:secret@example.test/image'));
  invalid((c) => (c.blocks[5].options[1] = ' ik FIETS! '));
  invalid((c) => c.blocks[6].tokens.pop());
  invalid((c) => (c.blocks[7].tokens[0] = 'Zij'));
  invalid((c) => (c.blocks[8].pairs[1].right = 'bicycle'));
  invalid((c) => (c.blocks[9].sentence = 'No gap'));
  invalid((c) => (c.blocks[10].options = ['ben', 'bent']));
  invalid((c) => (c.blocks = [blocks[0], blocks[1]]));
  const program = await service.saveProgram('alice', {
    content: {
      title: 'Everyday Dutch',
      description: 'A1 foundations',
      topics: [{ id: 'word-order', title: 'Word order' }],
    },
  });
  let lesson = await service.saveLesson('alice', {
    programId: program.id,
    topicId: 'word-order',
    content,
  });
  assert.equal(lesson.version, 1);
  assert.equal((await service.listLessons('alice', program.id)).length, 1);
  assert.equal((await service.listLessons('bob')).length, 0);
  assert.equal((await service.listPrograms('bob')).length, 0);
  await assert.rejects(
    () => service.getLesson('bob', lesson.id),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.getProgram('bob', program.id),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.saveLesson('bob', { programId: program.id, content }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.saveLesson('alice', { programId: program.id, topicId: 'missing', content }),
    /Topic/,
  );
  await assert.rejects(() => service.saveLesson('alice', { id: lesson.id, content }), /version/);
  await assert.rejects(
    () =>
      service.saveProgram('alice', {
        id: program.id,
        version: 1,
        content: { ...program.content, topics: [] },
      }),
    (e) => e.status === 409,
  );
  assert.equal((await service.getProgram('alice', program.id)).version, 1);
  const start = { lessonId: lesson.id, revision: 0, eventId: 'start-action', action: 'start' };
  lesson = await service.actOnLesson('alice', start);
  assert.equal(lesson.revision, 1);
  assert.equal((await service.actOnLesson('alice', start)).revision, 1);
  await assert.rejects(
    () => service.actOnLesson('bob', start),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.actOnLesson('alice', { ...start, eventId: 'stale' }),
    (e) => e.status === 409,
  );
  async function act(action, fields = {}) {
    lesson = await service.actOnLesson('alice', {
      lessonId: lesson.id,
      revision: lesson.revision,
      eventId: crypto.randomUUID(),
      action,
      ...fields,
    });
    return lesson;
  }
  await assert.rejects(() => act('check', { answer: 'anything' }), /unavailable/);
  await act('continue');
  await act('continue');
  await act('continue');
  await act('continue');
  await assert.rejects(() => act('rate', { recalled: true }), /Reveal/);
  await act('reveal');
  await act('rate', { recalled: true });
  assert.equal(lesson.progress.feedback.selfAssessed, true);
  await act('continue');
  await act('hint');
  await act('check', { answer: '0' });
  assert.equal(lesson.progress.feedback.helped, true);
  const savedRevision = lesson.revision;
  const reloaded = await service.getLesson('alice', lesson.id);
  assert.equal(reloaded.progress.feedback.correct, true);
  await assert.rejects(() => act('check', { answer: '0' }), /unavailable/);
  const changed = await service.saveLesson('alice', {
    id: lesson.id,
    version: 1,
    programId: program.id,
    topicId: 'word-order',
    content: { ...content, title: 'Updated lesson' },
  });
  assert.equal(changed.version, 2);
  assert.equal(changed.progress.lessonVersion, 1);
  assert.equal(changed.progress.content.title, content.title);
  await assert.rejects(
    () => service.saveLesson('alice', { id: lesson.id, version: 1, content }),
    (e) => e.status === 409,
  );
  assert.equal((await service.getLesson('alice', lesson.id)).programId, program.id);
  await act('continue');
  await act('check', { answer: [0, 1, 2, 3] });
  await act('continue');
  await act('check', { answer: [0, 1, 2, 3] });
  await act('continue');
  await act('check', { answer: [1, 0] });
  await act('continue');
  await act('check', { answer: 'FIETS.' });
  await act('continue');
  await act('check', { answer: 'is' });
  await act('continue');
  assert.equal(lesson.progress.completed, true);
  assert.equal(lesson.progress.results.length, 7);
  assert.equal((await service.lessonHistory('alice', lesson.id)).length, 1);
  assert.equal((await service.listLessons('alice'))[0].progress.completed, true);
  await assert.rejects(
    () =>
      service.actOnLesson('alice', {
        lessonId: lesson.id,
        revision: savedRevision,
        eventId: 'old-tab',
        action: 'continue',
      }),
    (e) => e.status === 409,
  );
  const oldRunId = lesson.progress.runId;
  await act('retry');
  assert.notEqual(lesson.progress.runId, oldRunId);
  assert.equal(lesson.progress.content.blocks.length, 2);
  assert.equal(lesson.progress.lessonVersion, 1);
  assert.equal((await service.lessonHistory('alice', lesson.id)).length, 1);
  await assert.rejects(() => act('start'), /unfinished/);
  await act('check', { answer: '0' });
  await act('continue');
  await act('check', { answer: [0, 1] });
  await act('continue');
  await act('restart');
  assert.equal(lesson.progress.lessonVersion, 2);
  assert.equal(lesson.progress.content.title, 'Updated lesson');
  assert.equal((await service.lessonHistory('alice', lesson.id)).length, 2);
  // Simulate a second tab committing after the read but before the transaction.
  const previousIndex = lesson.progress.index,
    revision = lesson.revision;
  beforeBatch = () =>
    sqlite
      .prepare('UPDATE lesson_progress SET revision=revision+1 WHERE lesson_id=?')
      .run(lesson.id);
  await assert.rejects(
    () => act('continue'),
    (e) => e.status === 409,
  );
  assert.equal((await service.getLesson('alice', lesson.id)).progress.index, previousIndex);
  assert.equal((await service.getLesson('alice', lesson.id)).revision, revision + 1);
  // A topic edit racing lesson creation must not create an orphan topic.
  beforeBatch = () =>
    sqlite.prepare('UPDATE lesson_programs SET version=version+1 WHERE id=?').run(program.id);
  const count = (await service.listLessons('alice')).length;
  await assert.rejects(
    () => service.saveLesson('alice', { programId: program.id, topicId: 'word-order', content }),
    (e) => e.status === 409,
  );
  assert.equal((await service.listLessons('alice')).length, count);
  // Explicit restart keeps unfinished answers and uses the latest authored lesson.
  let resetting = await service.saveLesson('reset-user', {
    content: { ...content, blocks: [blocks[0], byType('gap')] },
  });
  const resetAct = async (action, fields = {}) => {
    resetting = await service.actOnLesson('reset-user', {
      lessonId: resetting.id,
      revision: resetting.revision,
      eventId: crypto.randomUUID(),
      action,
      ...fields,
    });
    return resetting;
  };
  await assert.rejects(() => resetAct('restart'), /Start the lesson/);
  await resetAct('start');
  await resetAct('continue');
  await resetAct('hint');
  await resetAct('check', { answer: 'fiets' });
  const unfinished = copy(resetting.progress),
    oldRevision = resetting.revision;
  await service.saveLesson('reset-user', {
    id: resetting.id,
    version: 1,
    content: { ...resetting.content, title: 'Latest reset lesson' },
  });
  const restart = {
    lessonId: resetting.id,
    revision: oldRevision,
    eventId: 'explicit-restart',
    action: 'restart',
  };
  resetting = await service.actOnLesson('reset-user', restart);
  assert.notEqual(resetting.progress.runId, unfinished.runId);
  assert.equal(resetting.progress.index, 0);
  assert.equal(resetting.progress.results.length, 0);
  assert.equal(resetting.progress.feedback, null);
  assert.equal(resetting.progress.hinted, false);
  assert.equal(resetting.progress.lessonVersion, 2);
  assert.equal(resetting.progress.content.title, 'Latest reset lesson');
  let savedRuns = await service.lessonHistory('reset-user', resetting.id);
  assert.equal(savedRuns.length, 1);
  assert.equal(savedRuns[0].finished, false);
  assert.equal(savedRuns[0].id, unfinished.runId);
  assert.equal(savedRuns[0].total, 1);
  assert.equal(savedRuns[0].correct, 0); // a hinted answer is not independently correct
  assert.deepEqual(
    JSON.parse(
      sqlite
        .prepare('SELECT body FROM lesson_runs WHERE id=? AND owner=?')
        .get(unfinished.runId, 'reset-user').body,
    ),
    unfinished,
  );
  const revisionAfterRestart = resetting.revision;
  assert.equal((await service.actOnLesson('reset-user', restart)).revision, revisionAfterRestart);
  assert.equal((await service.lessonHistory('reset-user', resetting.id)).length, 1);
  await assert.rejects(
    () =>
      service.actOnLesson('reset-user', {
        ...restart,
        action: 'continue',
        eventId: 'old-tab-after-reset',
      }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => service.actOnLesson('bob', { ...restart, revision: revisionAfterRestart }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.lessonHistory('bob', resetting.id),
    (e) => e.status === 404,
  );
  const liveRunId = resetting.progress.runId;
  beforeBatch = () =>
    sqlite
      .prepare('UPDATE lesson_progress SET revision=revision+1 WHERE lesson_id=?')
      .run(resetting.id);
  await assert.rejects(
    () => resetAct('restart'),
    (e) => e.status === 409,
  );
  assert.equal((await service.getLesson('reset-user', resetting.id)).progress.runId, liveRunId);
  assert.equal((await service.lessonHistory('reset-user', resetting.id)).length, 1);
  assert.ok((await service.lessonHistory('alice', lesson.id)).every((run) => run.finished));
  resetting = await service.getLesson('reset-user', resetting.id);
  await service.saveLesson('reset-user', {
    id: resetting.id,
    version: resetting.version,
    content: resetting.content,
    archived: true,
  });
  await assert.rejects(() => resetAct('restart'), /archived/);
  savedRuns = await service.lessonHistory('reset-user', resetting.id);
  assert.equal(savedRuns.length, 1);
  // Permanent deletion removes only the owned lesson and its complete run graph.
  const deleteProgram = await service.saveProgram('erase-owner', {
    content: {
      title: 'Keep this program',
      description: 'Synthetic deletion boundary.',
      topics: [],
    },
  });
  const shortLesson = { ...content, blocks: [blocks[0], byType('gap')] };
  let doomed = await service.saveLesson('erase-owner', {
    programId: deleteProgram.id,
    content: shortLesson,
  });
  const sibling = await service.saveLesson('erase-owner', {
    programId: deleteProgram.id,
    content: { ...shortLesson, title: 'Keep this lesson' },
  });
  sqlite
    .prepare('INSERT INTO materials(id,owner,kind,title,body,created) VALUES(?,?,?,?,?,?)')
    .run(
      'kept-material',
      'erase-owner',
      'phrase',
      'de fiets',
      '{"en":"the bicycle"}',
      new Date().toISOString(),
    );
  const doomedAct = async (action, fields = {}) => {
    doomed = await service.actOnLesson('erase-owner', {
      lessonId: doomed.id,
      revision: doomed.revision,
      eventId: crypto.randomUUID(),
      action,
      ...fields,
    });
  };
  await doomedAct('start');
  await doomedAct('continue');
  await doomedAct('check', { answer: 'fiets' });
  await doomedAct('continue');
  await doomedAct('restart');
  await doomedAct('continue');
  await doomedAct('check', { answer: 'wrong' });
  await doomedAct('restart');
  assert.equal((await service.lessonHistory('erase-owner', doomed.id)).length, 2);
  const deletion = () => ({
    id: doomed.id,
    version: doomed.version,
    revision: doomed.revision,
    confirm: true,
  });
  await assert.rejects(
    () => service.deleteLesson('erase-owner', { ...deletion(), confirm: false }),
    /true/,
  );
  await assert.rejects(
    () => service.deleteLesson('erase-owner', { ...deletion(), owner: 'bob' }),
    /owner/,
  );
  await assert.rejects(
    () => service.deleteLesson('erase-owner', { ...deletion(), version: doomed.version + 1 }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => service.deleteLesson('erase-owner', { ...deletion(), revision: doomed.revision - 1 }),
    (e) => e.status === 409,
  );
  // Missing/unowned deletes are no-ops, with the same response as a safe retry.
  assert.equal((await service.deleteLesson('bob', deletion())).deleted, true);
  assert.equal(
    (await service.getLesson('erase-owner', doomed.id)).progress.runId,
    doomed.progress.runId,
  );
  beforeBatch = () =>
    sqlite
      .prepare('UPDATE lesson_progress SET revision=revision+1 WHERE lesson_id=?')
      .run(doomed.id);
  await assert.rejects(
    () => service.deleteLesson('erase-owner', deletion()),
    (e) => e.status === 409,
  );
  assert.equal((await service.lessonHistory('erase-owner', doomed.id)).length, 2);
  doomed = await service.getLesson('erase-owner', doomed.id);
  beforeBatch = () =>
    sqlite.prepare('UPDATE lessons SET version=version+1 WHERE id=?').run(doomed.id);
  await assert.rejects(
    () => service.deleteLesson('erase-owner', deletion()),
    (e) => e.status === 409,
  );
  assert.equal((await service.lessonHistory('erase-owner', doomed.id)).length, 2);
  doomed = await service.getLesson('erase-owner', doomed.id);
  const deleteInput = deletion();
  assert.equal((await service.deleteLesson('erase-owner', deleteInput)).deleted, true);
  assert.equal((await service.deleteLesson('erase-owner', deleteInput)).deleted, true);
  for (const table of ['lessons', 'lesson_progress', 'lesson_runs']) {
    const column = table === 'lessons' ? 'id' : 'lesson_id';
    assert.equal(
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=? AND owner=?`)
        .get(doomed.id, 'erase-owner').n,
      0,
    );
  }
  assert.equal(
    (await service.getProgram('erase-owner', deleteProgram.id)).content.title,
    'Keep this program',
  );
  assert.equal(
    (await service.getLesson('erase-owner', sibling.id)).content.title,
    'Keep this lesson',
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM materials WHERE id=?').get('kept-material').n,
    1,
  );
  await assert.rejects(
    () =>
      service.actOnLesson('erase-owner', {
        lessonId: doomed.id,
        revision: doomed.revision,
        action: 'continue',
        eventId: 'after-delete',
      }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () =>
      service.saveLesson('erase-owner', {
        id: doomed.id,
        version: doomed.version,
        content: shortLesson,
      }),
    (e) => e.status === 404,
  );
  const route = load('app/api/lessons/route');
  const req = (data, headers = {}) =>
    new Request('https://example.test/api/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  assert.equal((await route.POST(req(start))).status, 401);
  const deleteReq = (headers = {}) =>
    new Request('https://example.test/api/lessons', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(deleteInput),
    });
  assert.equal((await route.DELETE(deleteReq())).status, 401);
  assert.equal(
    (
      await route.DELETE(
        deleteReq({ 'oai-authenticated-user-id': 'erase-owner', origin: 'https://other.test' }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await route.DELETE(deleteReq({ 'oai-authenticated-user-id': 'erase-owner' }))).status,
    200,
  );
  assert.equal(
    (
      await route.POST(
        req(start, { 'oai-authenticated-user-id': 'alice', origin: 'https://other.test' }),
      )
    ).status,
    403,
  );
  const mcp = load('app/mcp/route');
  async function call(method, params, user = 'alice') {
    return (
      await mcp.POST(
        new Request('https://example.test/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': user },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      )
    ).json();
  }
  const discovery = await call('tools/list');
  for (const name of [
    'list_programs',
    'get_program',
    'save_program',
    'list_lessons',
    'get_lesson',
    'save_lesson',
    'delete_lesson',
  ])
    assert.ok(discovery.result.tools.find((t) => t.name === name));
  assert.equal(
    discovery.result.tools.find((t) => t.name === 'save_lesson').inputSchema.additionalProperties,
    false,
  );
  assert.equal(
    (await call('tools/call', { name: 'get_lesson', arguments: { id: lesson.id } }, 'bob')).result
      .isError,
    true,
  );
  const newLesson = await call('tools/call', { name: 'save_lesson', arguments: { content } });
  const mcpLesson = JSON.parse(newLesson.result.content[0].text);
  assert.ok(mcpLesson.id);
  assert.equal(
    discovery.result.tools.find((t) => t.name === 'delete_lesson').annotations.destructiveHint,
    true,
  );
  assert.equal(
    (
      await call('tools/call', {
        name: 'delete_lesson',
        arguments: {
          id: mcpLesson.id,
          version: mcpLesson.version,
          revision: mcpLesson.revision,
          confirm: false,
        },
      })
    ).result.isError,
    true,
  );
  const removedByMcp = await call('tools/call', {
    name: 'delete_lesson',
    arguments: {
      id: mcpLesson.id,
      version: mcpLesson.version,
      revision: mcpLesson.revision,
      confirm: true,
    },
  });
  assert.equal(JSON.parse(removedByMcp.result.content[0].text).deleted, true);
  await assert.rejects(
    () => service.getLesson('alice', mcpLesson.id),
    (e) => e.status === 404,
  );
  console.log(
    'PASS: all lesson formats, validation, owner isolation, MCP/API, authoritative grading, resumable snapshots, history, retries and atomic version conflicts.',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
