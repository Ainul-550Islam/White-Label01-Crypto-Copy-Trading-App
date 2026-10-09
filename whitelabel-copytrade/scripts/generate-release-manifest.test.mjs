// # Responsibility: verify the release manifest records the exact SHA-256 and byte length of all four committed CycloneDX SBOMs and fails when one is missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const GENERATOR_SOURCE = join(REPO_ROOT, 'scripts', 'generate-release-manifest.ts');
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const REQUIRED_SBOMS = [
  'cargo-crates.cdx.json',
  'flutter-mobile.cdx.json',
  'npm-workspaces.cdx.json',
  'python-projects.cdx.json',
];

function loadGenerator(directory) {
  const source = readFileSync(GENERATOR_SOURCE, 'utf8');
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const modulePath = join(directory, 'generate-release-manifest.cjs');
  writeFileSync(modulePath, compiled, 'utf8');
  return createRequire(modulePath)(modulePath);
}

function createSbomTree(root, filenames = REQUIRED_SBOMS) {
  const directory = join(root, 'docs', 'sbom');
  mkdirSync(directory, { recursive: true });
  for (const filename of filenames) {
    writeFileSync(join(directory, filename), `${filename}\nfixture content for release digest testing\n`, 'utf8');
  }
}

test('release manifest includes the exact committed CycloneDX SBOM SHA-256 records', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-manifest-test-'));
  const previousEpoch = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = '1791417600';
  try {
    createSbomTree(root);
    const { generateDeterministicReleaseManifest } = loadGenerator(root);
    const { summary, files } = generateDeterministicReleaseManifest(root);
    assert.equal(summary.sbom_hashes.length, REQUIRED_SBOMS.length);
    assert.deepEqual(summary.sbom_hashes.map((entry) => entry.path.split('/').at(-1)).sort(), [...REQUIRED_SBOMS].sort());

    for (const sbom of summary.sbom_hashes) {
      const file = files.find((entry) => entry.path === sbom.path);
      const bytes = readFileSync(join(root, sbom.path));
      assert.ok(file, `${sbom.path} must also appear in the complete file hash list`);
      assert.equal(sbom.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(sbom.sha256, file.sha256);
      assert.equal(sbom.size_bytes, bytes.length);
      assert.equal(sbom.size_bytes, file.size_bytes);
    }
  } finally {
    if (previousEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previousEpoch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('release manifest generation fails closed when any required CycloneDX SBOM is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-manifest-missing-sbom-test-'));
  try {
    createSbomTree(root, REQUIRED_SBOMS.slice(0, REQUIRED_SBOMS.length - 1));
    const { generateDeterministicReleaseManifest } = loadGenerator(root);
    assert.throws(
      () => generateDeterministicReleaseManifest(root),
      /missing required CycloneDX SBOM hashes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
