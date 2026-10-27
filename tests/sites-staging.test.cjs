const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mijntaal-stage-test-'));
const source = path.join(temporary, 'source');
const stagingDirectories = [];
const siteId = 'appgprj_' + 'a'.repeat(32);
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Staging test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'Staging test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
};
function write(file, content) {
  const target = path.join(source, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { env, encoding: 'utf8' });
}
function run(...args) {
  return spawnSync(process.execPath, [path.join(source, 'scripts/stage-sites.mjs'), ...args], {
    cwd: source,
    env,
    encoding: 'utf8',
  });
}
function success(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  fs.mkdirSync(source);
  for (const file of [
    'scripts/stage-sites.mjs',
    'scripts/check-public-release.mjs',
    '.gitignore',
    '.openai/hosting.example.json',
  ]) {
    write(file, fs.readFileSync(path.join(project, file)));
  }
  git(source, 'init', '--quiet');
  write('package.json', '{"type":"module"}\n');
  write('.openai/hosting.json', fs.readFileSync(path.join(source, '.openai/hosting.example.json')));
  assert.match(run().stderr, /Set project_id/);
  const hosting = { project_id: siteId, d1: 'DB', r2: 'BUCKET', capabilities: ['mcp'] };
  write('.openai/hosting.json', JSON.stringify(hosting));
  write('app/api/backup/route.ts', 'export const backup = true;\n');
  write('app/page.tsx', 'export const title = "Initial";\n');
  write('node_modules/private.txt', 'not source');
  write('.sites-runtime/private.txt', 'not source');
  const originalManifest = fs.readFileSync(path.join(source, '.openai/hosting.json'), 'utf8');
  const result = success(run());
  const checkout = result.staging_path;
  stagingDirectories.push(checkout);
  assert.equal(result.deployed, false);
  assert.equal(result.project_id, siteId);
  assert.ok(fs.existsSync(path.join(checkout, 'app/api/backup/route.ts')));
  for (const excluded of ['.git', 'node_modules', '.sites-runtime'])
    assert.ok(!fs.existsSync(path.join(checkout, excluded)));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(checkout, '.openai/hosting.json'))).project_id,
    siteId,
  );
  assert.equal(
    fs.readFileSync(path.join(source, '.openai/hosting.json'), 'utf8'),
    originalManifest,
  );
  git(checkout, 'init', '--quiet');
  git(checkout, 'add', '--all');
  git(checkout, 'commit', '--quiet', '-m', 'Deployment fixture');
  assert.equal(git(checkout, 'ls-files', '.openai/hosting.json').trim(), '.openai/hosting.json');
  const head = git(checkout, 'rev-parse', 'HEAD');
  fs.unlinkSync(path.join(source, 'app/api/backup/route.ts'));
  write('app/page.tsx', 'export const title = "Updated";\n');
  success(run('--checkout', checkout));
  assert.ok(!fs.existsSync(path.join(checkout, 'app/api/backup/route.ts')));
  assert.match(fs.readFileSync(path.join(checkout, 'app/page.tsx'), 'utf8'), /Updated/);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), head, 'Staging must not create a commit');
  assert.match(run('--checkout', checkout).stderr, /has changes/);
  git(checkout, 'add', '--all');
  git(checkout, 'commit', '--quiet', '-m', 'Updated fixture');
  write(
    '.openai/hosting.json',
    JSON.stringify({ ...hosting, project_id: 'appgprj_' + 'b'.repeat(32) }),
  );
  assert.match(run('--checkout', checkout).stderr, /different Site/);
  write('.openai/hosting.json', originalManifest);
  fs.symlinkSync(path.join(temporary, 'outside'), path.join(source, 'linked-file'));
  assert.notEqual(run().status, 0, 'Symlinks must fail closed');
  fs.unlinkSync(path.join(source, 'linked-file'));
  git(source, 'add', '--force', '.openai/hosting.json');
  assert.notEqual(run().status, 0, 'A tracked local manifest must fail closed');
  console.log('Sites staging: source filtering, updates, deletions and target protections passed.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  for (const directory of stagingDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
}
