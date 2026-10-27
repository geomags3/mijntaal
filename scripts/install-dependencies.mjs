import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manager =
  process.env.SITES_PNPM_BIN ||
  (process.env.npm_execpath?.includes('pnpm') ? process.env.npm_execpath : undefined);
const command = manager ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = [...(manager ? [manager] : []), 'install', '--frozen-lockfile'];
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: !manager && process.platform === 'win32',
});
if (result.error) throw result.error;
process.exit(result.status || (result.signal ? 1 : 0));
