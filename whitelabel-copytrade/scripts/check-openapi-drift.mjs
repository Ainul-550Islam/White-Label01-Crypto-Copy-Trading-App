// # NEW — Fails CI when the committed OpenAPI spec or Postman collection differs from the Nest route graph

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCli,
  ['run', 'openapi:export', '--workspace', '@wlct/api', '--', '--check'],
  {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit',
  },
);

if (result.error) {
  process.stderr.write(`Unable to run the deterministic OpenAPI export: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
