import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = JSON.parse(readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
const database = built.d1_databases?.find((binding) => binding.binding === 'DB');
if (!database)
  throw new Error('Build the project with its DB binding before initializing local data.');
const config = path.join(root, '.sites-runtime/local-migrations.json');
mkdirSync(path.dirname(config), { recursive: true });
writeFileSync(
  config,
  JSON.stringify(
    {
      name: 'mijntaal-local',
      compatibility_date: built.compatibility_date,
      d1_databases: [{ ...database, migrations_dir: path.join(root, 'drizzle') }],
    },
    null,
    2,
  ),
);
const result = spawnSync(
  process.execPath,
  [
    '--import',
    './scripts/sites-env.mjs',
    './node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    config,
    '--persist-to',
    '.wrangler/state',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status || (result.signal ? 1 : 0));
