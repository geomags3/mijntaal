import { lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const hosting = JSON.parse(readFileSync(path.join(root, '.openai/hosting.example.json'), 'utf8'));
const failures = [];
if (
  execFileSync('git', ['ls-files', '--', '.openai/hosting.json'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
) {
  failures.push('The local .openai/hosting.json must not be tracked by Git.');
}
if (hosting.project_id) failures.push('The public template contains a deployment project_id.');
if (hosting.d1 !== 'DB' || hosting.r2 !== 'BUCKET' || !hosting.capabilities?.includes('mcp')) {
  failures.push('Required Sites DB, BUCKET or MCP declaration is missing.');
}
// Inspect the prospective commit, including tracked files that now match ignores.
const candidates = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean),
);
const privateRoots = new Set([
  'node_modules',
  'dist',
  '.next',
  '.vinext',
  '.wrangler',
  '.sites-runtime',
  '.agents',
  '.codex',
  '.claude',
  '.claude-mem',
  '.aws',
  'outputs',
  'work',
  'backup',
  'coverage',
  'out',
]);
let checked = 0;
for (const relative of candidates) {
  const absolute = path.join(root, relative);
  // Git still lists a tracked file deleted from the working tree.
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    failures.push(`Unexpected symlink: ${relative}`);
    continue;
  }
  if (
    privateRoots.has(relative.split('/')[0]) ||
    ['AGENTS.md', 'CLAUDE.md'].includes(path.basename(relative)) ||
    ['.openai/hosting.json', '.openai/deployment.local.json'].includes(relative) ||
    relative
      .split('/')
      .some(
        (name) =>
          (name.startsWith('.env') && name !== '.env.example') ||
          name.startsWith('.dev.vars') ||
          /\.(?:pem|key|p12|pfx|sqlite3?|db|log)(?:-wal|-shm)?$/i.test(name),
      )
  ) {
    failures.push(`Private data/configuration path: ${relative}`);
    continue;
  }
  const bytes = readFileSync(absolute);
  if (bytes.includes(0)) continue; // Binary assets are reviewed separately.
  const content = bytes.toString('utf8');
  checked++;
  if (
    /appgprj_[a-f0-9]{20,}|plugin_asdk_[a-z0-9_]{20,}|https:\/\/[^\s"']+\.chatgpt\.site\b|\/Users\/[a-z][^\s"']*/i.test(
      content,
    )
  ) {
    failures.push(`Personal deployment or filesystem reference: ${relative}`);
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bghp_[a-zA-Z0-9]{30,}|\bgithub_pat_[a-zA-Z0-9_]{30,}/.test(
      content,
    )
  ) {
    failures.push(`Credential pattern: ${relative}`);
  }
  if (/\bsk-(?!test)[a-zA-Z0-9_-]{30,}/.test(content))
    failures.push(`Provider credential pattern: ${relative}`);
  if (/\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{20,}/.test(content))
    failures.push(`Cloud or service credential pattern: ${relative}`);
  // Upstream dictionary quotations are preserved with attribution.
  if (!relative.startsWith('public/dictionary/') && /[\u0400-\u04ff]/.test(content)) {
    failures.push(`Non-English authored Cyrillic text: ${relative}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Public-template checks passed (${checked} text files). This is a safeguard, not an exhaustive secret audit.`,
  );
