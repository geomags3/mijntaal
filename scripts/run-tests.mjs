import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => name.endsWith('.cjs'))
  .sort()) {
  console.log(`\n${file}`);
  const result = spawnSync(process.execPath, [`tests/${file}`], {
    cwd: root,
    stdio: 'inherit',
    timeout: 60000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
