// # NEW — Fails the TypeScript SDK suite when generated OpenAPI types are stale

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const sdkRoot = resolve(__dirname, '../..');
const generatorPath = resolve(sdkRoot, 'scripts/generate.mjs');

test('generated TypeScript SDK types match the committed OpenAPI spec', () => {
  execFileSync(process.execPath, [generatorPath, '--check'], {
    cwd: sdkRoot,
    stdio: 'inherit',
  });
});
