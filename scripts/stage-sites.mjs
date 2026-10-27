import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2).filter((arg) => arg !== '--');

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
}

// Git ignores determine the source set, with additional protection against
// accidentally tracked local files. Match root paths, preserving app/api/backup.
function privatePath(file) {
  const parts = file.split('/');
  return (
    [
      '.git',
      'node_modules',
      'dist',
      '.next',
      '.vinext',
      '.wrangler',
      '.sites-runtime',
      '.agents',
      '.codex',
      'backup',
      'outputs',
      'work',
      'coverage',
      'out',
    ].includes(parts[0]) ||
    file === '.openai/hosting.json' ||
    file === '.openai/deployment.local.json' ||
    parts.some(
      (part) =>
        (part.startsWith('.env') && part !== '.env.example') ||
        part.startsWith('.dev.vars') ||
        part.endsWith('.pem'),
    )
  );
}

function requireRegularFile(directory, file) {
  let current = directory;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlinks cannot be staged: ${file}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`Not a regular source file: ${file}`);
}

function main() {
  if (args.includes('--help')) {
    console.log('Usage: pnpm sites:stage [--checkout <opened Sites checkout>]');
    console.log('Stages local source only. Does not authenticate, build, push, or deploy.');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--checkout'))
    throw new Error('Use --help for usage.');
  const localManifest = path.join(root, '.openai/hosting.json');
  if (!existsSync(localManifest))
    throw new Error(
      'Copy .openai/hosting.example.json to .openai/hosting.json, then link it to your Site.',
    );
  requireRegularFile(root, '.openai/hosting.json');
  const hosting = JSON.parse(readFileSync(localManifest, 'utf8'));
  if (
    typeof hosting.project_id !== 'string' ||
    !/^appgprj_[a-f0-9]{32}$/.test(hosting.project_id)
  ) {
    throw new Error(
      'Set project_id in your ignored .openai/hosting.json to the intended Site ID. No Site was created or changed.',
    );
  }
  if (hosting.d1 !== 'DB' || hosting.r2 !== 'BUCKET' || !hosting.capabilities?.includes('mcp')) {
    throw new Error('The local hosting manifest must retain DB, BUCKET and the mcp capability.');
  }
  const manifestKeys = new Set([
    'project_id',
    'd1',
    'r2',
    'capabilities',
    'static',
    'plugins',
    'connectors',
  ]);
  if (Object.keys(hosting).some((key) => !manifestKeys.has(key))) {
    throw new Error(
      'Unexpected hosting configuration field. Keep secrets in Sites runtime settings.',
    );
  }
  execFileSync(process.execPath, [path.join(root, 'scripts/check-public-release.mjs')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const forbidden = tracked.filter(privatePath);
  if (forbidden.length)
    throw new Error(`Private/generated files are tracked by Git: ${forbidden.join(', ')}`);
  const files = [
    ...new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    ),
  ].filter((file) => !privatePath(file) && existsSync(path.join(root, file)));
  for (const file of files) requireRegularFile(root, file);

  let destination;
  let oldFiles = [];
  if (args.length) {
    destination = realpathSync(path.resolve(args[1]));
    const source = realpathSync(root);
    if (
      destination === source ||
      source.startsWith(destination + path.sep) ||
      destination.startsWith(source + path.sep)
    ) {
      throw new Error('The deployment checkout must be outside the public source folder.');
    }
    // Only replace a clean, opened deployment repository for this exact Site.
    if (lstatSync(path.join(destination, '.git')).isSymbolicLink())
      throw new Error('The deployment Git directory must not be a symlink.');
    if (realpathSync(git(destination, ['rev-parse', '--show-toplevel']).trim()) !== destination)
      throw new Error('Use the checkout returned by the Sites source helper.');
    if (git(destination, ['status', '--porcelain', '--untracked-files=all']).trim())
      throw new Error(
        'Deployment checkout has changes. Preserve or reconcile them before staging.',
      );
    const previous = JSON.parse(git(destination, ['show', 'HEAD:.openai/hosting.json']));
    if (previous.project_id !== hosting.project_id)
      throw new Error('The deployment checkout belongs to a different Site.');
    oldFiles = git(destination, ['ls-files', '-z']).split('\0').filter(Boolean);
    for (const file of oldFiles) requireRegularFile(destination, file);
    // Validate every destination ancestor before copying; never follow an
    // ignored symlink in the opened checkout into another directory.
    for (const file of [...files, '.openai/hosting.json']) {
      let current = destination;
      for (const part of file.split('/')) {
        current = path.join(current, part);
        if (existsSync(current) && lstatSync(current).isSymbolicLink())
          throw new Error(`Symlink in deployment checkout: ${file}`);
      }
    }
  } else {
    destination = mkdtempSync(path.join(tmpdir(), 'mijntaal-sites-'));
  }

  const desired = new Set([...files, '.openai/hosting.json']);
  for (const file of oldFiles) {
    if (!desired.has(file)) rmSync(path.join(destination, file));
  }
  for (const file of files) {
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, file), target);
  }
  mkdirSync(path.join(destination, '.openai'), { recursive: true });
  writeFileSync(
    path.join(destination, '.openai/hosting.json'),
    JSON.stringify(hosting, null, 2) + '\n',
    { mode: 0o600 },
  );
  // The public repository ignores this file; the private deployment repository
  // must track it for the supported Sites source workflow.
  writeFileSync(
    path.join(destination, '.gitignore'),
    readFileSync(path.join(root, '.gitignore'), 'utf8') +
      '\n# Included only in the Sites source snapshot.\n!/.openai/hosting.json\n',
  );
  console.log(
    JSON.stringify(
      {
        project_id: hosting.project_id,
        staging_path: destination,
        source_files: desired.size,
        deployed: false,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to stage Sites source.');
  process.exitCode = 1;
}
