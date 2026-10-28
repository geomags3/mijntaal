const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mijntaal-dictionary-test-'));
const root = path.resolve(__dirname, '..');
try {
  // Synthetic sources distinguish English sense labels from Dutch labels and preserve homographs.
  execFileSync('python3', [
    '-c',
    String.raw`
import pathlib,sqlite3,json,hashlib,sys
p=pathlib.Path(sys.argv[1]); (p/'kaikki').mkdir(); (p/'inputs').mkdir()
record={'word':'bank','pos':'noun','senses':[{'glosses':['financial institution'],'tags':['common']}],'forms':[]}
f=p/'kaikki'/'00.json';f.write_text(json.dumps({'bank':[record]}))
h=hashlib.sha256();h.update(f.name.encode()+b'\0'+hashlib.sha256(f.read_bytes()).digest())
source={'id':'kaikki-fixture','format':'mijntaal-v1','path':'kaikki','sha256':h.hexdigest(),'license':'fixture','snapshot':'test','url':'https://example.invalid/kaikki'}
lock={'schemaVersion':1,'kaikki':source,'wikdict':[]}
for pair in ['en-nl','nl-en']:
 f=p/'inputs'/(pair+'.sqlite3');c=sqlite3.connect(f)
 c.execute('create table translation(lexentry,sense_num,sense,written_rep,trans_list,score,importance,is_good)')
 rows=[('eng/bank__Noun__1',1,'financial institution','bank','bank',100,1,1),('eng/bank__Noun__2',2,'river edge','bank','oever | wal',90,1,1)] if pair=='en-nl' else [('nld/bank__noun__1',1,'zitplaats','bank','bench | couch',100,1,1)]
 c.executemany('insert into translation values(?,?,?,?,?,?,?,?)',rows);c.commit();c.close()
 lock['wikdict'].append({'id':'wikdict-'+pair,'format':'wikdict-sqlite-v2','languages':pair.split('-'),'filename':pair+'.sqlite3','sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'license':'fixture','snapshot':'test','url':'https://example.invalid/'+pair})
(p/'sources.json').write_text(json.dumps(lock))
`,
    temporary,
  ]);
  const build = (output, database) => [
    path.join(root, 'scripts/dictionary-build.py'),
    '--sources',
    path.join(temporary, 'sources.json'),
    '--kaikki-dir',
    path.join(temporary, 'kaikki'),
    '--wikdict-dir',
    path.join(temporary, 'inputs'),
    '--database',
    path.join(temporary, database),
    '--output',
    path.join(temporary, output),
  ];
  execFileSync('python3', build('first', 'first.sqlite3'));
  execFileSync('python3', build('second', 'second.sqlite3'));
  const names = fs.readdirSync(path.join(temporary, 'first')).sort();
  assert.deepEqual(names, fs.readdirSync(path.join(temporary, 'second')).sort());
  for (const name of names)
    assert.equal(
      fs.readFileSync(path.join(temporary, 'first', name), 'utf8'),
      fs.readFileSync(path.join(temporary, 'second', name), 'utf8'),
    );
  const manifest = JSON.parse(fs.readFileSync(path.join(temporary, 'first/manifest.json')));
  assert.deepEqual(manifest.counts, { kaikkiRecords: 1, translationRecords: 3 });
  assert.equal(manifest.sources.length, 3);
  const rows = names
    .filter((name) => /^en-[a-f0-9]{2}.json$/.test(name))
    .flatMap((name) =>
      Object.values(JSON.parse(fs.readFileSync(path.join(temporary, 'first', name)))),
    );
  const bank = rows[0];
  assert.equal(bank.length, 2);
  assert.equal(bank[0].sense, 'financial institution');
  assert.equal(bank[1].sense, 'river edge');
  assert.equal(bank[1].source, 'wikdict-en-nl');
  assert.deepEqual(bank[1].targets, ['oever', 'wal']);
  const check = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute("select count(*) from entries").fetchone()[0],c.execute("select count(*) from translations").fetchone()[0]]))',
        path.join(temporary, 'first.sqlite3'),
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(check, [1, 3]);
  // Unpinned changes fail before touching the last valid browser export.
  const before = fs.readFileSync(path.join(temporary, 'first/manifest.json'), 'utf8');
  fs.appendFileSync(path.join(temporary, 'inputs/en-nl.sqlite3'), 'tampered');
  const failed = spawnSync('python3', build('first', 'third.sqlite3'), { encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /checksum mismatch/);
  assert.equal(fs.readFileSync(path.join(temporary, 'first/manifest.json'), 'utf8'), before);
  console.log(
    'PASS: deterministic pinned dictionary build, independent senses, provenance, canonical SQLite and fail-before-replace source verification. Synthetic fixtures only.',
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
