/**
 * Tests for the repository SBOM generator (run: `node --test scripts/`).
 *
 * These are the claims the generator makes, and each one is a claim a buyer's diligence would test:
 * that it covers every ecosystem in the tree, that the document validates, that two runs over the
 * same tree produce the same bytes, that a dependency with no recorded version is named rather than
 * dropped or invented, and that a missing manifest fails the run instead of quietly narrowing the
 * document.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import {
  MANIFESTS,
  buildCycloneDxDocument,
  buildCycloneDxDocuments,
  buildSpdxDocument,
  classifyLicenseText,
  collectComponents,
  extractReadmeLicenseSection,
  integrityToSpdxChecksum,
  normalizeSpdxExpression,
  npmNameFromPath,
  parsePubspecLock,
  parseRequirementLine,
  readFlutterComponents,
  readLicenseFilesFromTarGz,
  readNpmComponents,
  readRequirementComponents,
  resolveLicenseMetadata,
  validateCycloneDxDocument,
  validateSpdxDocument,
} from './generate-sbom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'generate-sbom.mjs');

function tempRepo() {
  return mkdtempSync(join(tmpdir(), 'sbom-test-'));
}

function createTarGzFile(name, text) {
  const content = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
  header.write(`${checksum}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

test('every manifest the generator claims to read exists in the tree', () => {
  const all = [...MANIFESTS.npm, ...MANIFESTS.requirements, ...MANIFESTS.pyproject, ...MANIFESTS.cargo, ...MANIFESTS.flutter];
  assert.ok(all.length >= 9, `expected the generator to name its sources, saw ${all.length}`);
  for (const relative of all) {
    assert.ok(existsSync(join(REPO_ROOT, relative)), `${relative} is named by MANIFESTS but does not exist`);
  }
});

test('the real tree produces a valid SPDX-2.3 document covering npm, pypi, cargo and pub', () => {
  const { document, components } = buildSpdxDocument({ created: '2026-10-07T00:00:00Z' });

  assert.deepEqual(validateSpdxDocument(document), []);

  const ecosystems = new Set(components.map((entry) => entry.ecosystem));
  assert.deepEqual([...ecosystems].sort(), ['cargo', 'npm', 'pub', 'pypi']);
  assert.ok(components.length > 200, `expected hundreds of components, saw ${components.length}`);

  const npmCount = components.filter((entry) => entry.ecosystem === 'npm').length;
  const cargoCount = components.filter((entry) => entry.ecosystem === 'cargo').length;
  const pypiCount = components.filter((entry) => entry.ecosystem === 'pypi').length;
  const pubCount = components.filter((entry) => entry.ecosystem === 'pub').length;
  assert.ok(npmCount > 100, `expected the npm tree to be large, saw ${npmCount}`);
  assert.ok(pypiCount >= 20, `expected the python services to contribute, saw ${pypiCount}`);
  assert.ok(cargoCount > 0, 'expected the rust crates to contribute');
  assert.equal(pubCount, 77, `expected all 77 Flutter lockfile packages, saw ${pubCount}`);

  // Every npm package in the lockfile is a resolved download with an exact version.
  for (const entry of components.filter((item) => item.ecosystem === 'npm' && item.pinned)) {
    assert.match(entry.version, /^\d+\.\d+\.\d+/, `${entry.name} has a non-semver version ${entry.version}`);
    assert.equal(entry.purl, `pkg:npm/${entry.name}@${entry.version}`);
  }
});

test('two runs over the same tree with the same creation time are byte-identical', () => {
  const first = buildSpdxDocument({ created: '2026-10-07T00:00:00Z' }).document;
  const second = buildSpdxDocument({ created: '2026-10-07T00:00:00Z' }).document;
  assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));

  // And the namespace is a function of the content, so an unchanged tree keeps its identity.
  const other = buildSpdxDocument({ created: '2026-10-08T00:00:00Z' }).document;
  assert.equal(first.documentNamespace, other.documentNamespace);
  assert.notEqual(first.creationInfo.created, other.creationInfo.created);
});

/**
 * Writes every path the generator declares, so a test tree is a complete (if small) repository. The
 * packages map is the resolved npm tree; the other files are the pinned and range-declared manifests.
 */
function seedTree(root, { npm = {}, requirements = {}, pyproject = {}, cargo = {}, flutter = {} } = {}) {
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'root' }, ...npm } }));
  for (const relative of MANIFESTS.requirements) {
    mkdirSync(join(root, dirname(relative)), { recursive: true });
    writeFileSync(join(root, relative), requirements[relative] ?? '');
  }
  for (const relative of MANIFESTS.pyproject) {
    mkdirSync(join(root, dirname(relative)), { recursive: true });
    writeFileSync(join(root, relative), pyproject[relative] ?? '[project]\ndependencies = []\n');
  }
  for (const relative of MANIFESTS.cargo) {
    mkdirSync(join(root, dirname(relative)), { recursive: true });
    writeFileSync(join(root, relative), cargo[relative] ?? '');
  }
  for (const relative of MANIFESTS.flutter) {
    mkdirSync(join(root, dirname(relative)), { recursive: true });
    writeFileSync(
      join(root, relative),
      flutter[relative] ?? [
        'packages:',
        '  test_package:',
        '    dependency: transitive',
        '    description:',
        '      name: test_package',
        `      sha256: ${'a'.repeat(64)}`,
        '      url: "https://pub.dev"',
        '    source: hosted',
        '    version: "1.0.0"',
      ].join('\n'),
    );
  }
  return root;
}

test('a declared dependency with no exact version is named with NOASSERTION, never dropped or invented', () => {
  const root = tempRepo();
  try {
    seedTree(root, {
      npm: { 'node_modules/left-pad': { version: '1.3.0', integrity: `sha512-${Buffer.from('pad').toString('base64')}` } },
      requirements: {
        'services/execution-engine/requirements.txt': ['# a comment', 'fastapi==0.115.0', 'httpx>=0.27', 'uvicorn[standard]==0.31.0'].join('\n'),
      },
      pyproject: {
        'libs/trading-core/pyproject.toml': [
          '[project]',
          'dependencies = ["httpx>=0.27", "pydantic==2.9.2"]',
          '',
          '[project.optional-dependencies]',
          'live = [',
          '  "websockets>=13.1,<18",',
          ']',
          'dev = ["pytest>=8.0"]',
          '',
          '[tool.pytest.ini_options]',
          "addopts = \"-m 'not live'\"",
        ].join('\n'),
      },
      cargo: { 'packages/sdk-rust/Cargo.lock': '[[package]]\nname = "serde"\nversion = "1.0.210"\nchecksum = "ab"\n' },
      flutter: {
        [MANIFESTS.flutter[0]]: [
          'packages:',
          '  test_flutter:',
          '    dependency: "direct main"',
          '    description:',
          '      name: test_flutter',
          `      sha256: ${'b'.repeat(64)}`,
          '      url: "https://pub.dev"',
          '    source: hosted',
          '    version: "3.2.1"',
          '  flutter:',
          '    dependency: "direct main"',
          '    description: flutter',
          '    source: sdk',
          '    version: "0.0.0"',
          '',
        ].join('\n'),
      },
    });

    const components = collectComponents(root);
    const httpx = components.find((entry) => entry.ecosystem === 'pypi' && entry.name === 'httpx');
    assert.ok(httpx, 'the range-pinned httpx must appear in the SBOM');
    assert.equal(httpx.version, 'NOASSERTION');
    assert.equal(httpx.pinned, false);
    assert.match(httpx.comment, /httpx>=0\.27/);
    assert.equal(httpx.purl, 'pkg:pypi/httpx');

    const fastapi = components.find((entry) => entry.name === 'fastapi');
    assert.equal(fastapi.version, '0.115.0', 'an exact pin is the version, not a range');
    assert.equal(fastapi.purl, 'pkg:pypi/fastapi@0.115.0');

    // A range declared in pyproject is unpinned for the same reason a range in requirements is: no
    // lockfile records what it resolves to.
    const fromPyproject = components.find((entry) => entry.name === 'pydantic');
    assert.equal(fromPyproject.version, '2.9.2');
    const serde = components.find((entry) => entry.ecosystem === 'cargo');
    assert.deepEqual(serde.checksum, { algorithm: 'SHA256', checksumValue: 'ab' });

    const pubPackage = components.find((entry) => entry.ecosystem === 'pub' && entry.name === 'test_flutter');
    assert.equal(pubPackage.version, '3.2.1');
    assert.equal(pubPackage.purl, 'pkg:pub/test_flutter@3.2.1');
    assert.equal(pubPackage.integrity, 'b'.repeat(64));
    const flutterSdk = components.find((entry) => entry.ecosystem === 'pub' && entry.name === 'flutter');
    assert.equal(flutterSdk.version, '0.0.0');
    assert.equal(flutterSdk.scope, 'excluded');
    assert.equal(flutterSdk.checksum, null, 'SDK components have no hosted archive checksum');

    // Optional-dependency groups are part of the install surface: a component reachable only through
    // the `live` extra is still a component, and the group is named so a reader can tell the two apart.
    const websockets = components.find((entry) => entry.name === 'websockets');
    assert.ok(websockets, 'the live extra must contribute its components');
    assert.match(websockets.comment, /\(extra live\): declared as websockets>=13\.1,<18/);
    const pytest = components.find((entry) => entry.name === 'pytest');
    assert.match(pytest.comment, /\(extra dev\): declared as pytest>=8\.0/);
    // The next table in the file must not leak into the group parse.
    assert.equal(components.some((entry) => entry.name.includes('addopts')), false);

    assert.equal(parseRequirementLine('uvicorn[standard]==0.31.0').name, 'uvicorn');
    assert.equal(parseRequirementLine('# comment'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing manifest fails the run rather than narrowing the document', () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));

    // services/execution-engine/requirements.txt is named in MANIFESTS and absent from this tree.
    assert.throws(() => readRequirementComponents(root), /missing; the SBOM cannot silently omit an ecosystem/);
    assert.throws(() => collectComponents(root), /missing; the SBOM cannot silently omit an ecosystem/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('npm integrity strings become SPDX checksums, and unusable ones become nothing', () => {
  const sha512 = `sha512-${Buffer.from('hello world').toString('base64')}`;
  assert.deepEqual(integrityToSpdxChecksum(sha512), {
    algorithm: 'SHA512',
    checksumValue: Buffer.from('hello world').toString('hex'),
  });
  assert.equal(integrityToSpdxChecksum('not-an-integrity-string'), null);
  assert.equal(integrityToSpdxChecksum(undefined), null);
  assert.equal(integrityToSpdxChecksum('md5-AAAA'), null, 'an algorithm SPDX does not define must not be relabelled');

  assert.equal(npmNameFromPath('node_modules/@scope/pkg'), '@scope/pkg');
  assert.equal(npmNameFromPath('node_modules/a/node_modules/b'), 'b');
  assert.equal(npmNameFromPath('apps/api'), null, 'a workspace root is not a third-party component');
});

test('npm dependency flags distinguish development-only, optional, and shipped packages', () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/runtime-required': { version: '1.0.0' },
        'node_modules/runtime-optional': { version: '1.0.0', optional: true },
        'node_modules/dev-only': { version: '1.0.0', dev: true },
        'node_modules/dev-optional-only': { version: '1.0.0', dev: true, optional: true },
        'node_modules/shared-optional': { version: '1.0.0', devOptional: true },
      },
    }));
    const scopes = Object.fromEntries(readNpmComponents(root).map((entry) => [entry.name, entry.scope]));
    assert.deepEqual(scopes, {
      'runtime-required': 'required',
      'runtime-optional': 'optional',
      'dev-only': 'excluded',
      'dev-optional-only': 'excluded',
      'shared-optional': 'optional',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Flutter lockfile parser includes hosted archives and SDK packages without inventing archive hashes', () => {
  const parsed = parsePubspecLock(readFileSync(join(REPO_ROOT, MANIFESTS.flutter[0]), 'utf8'));
  const hosted = parsed.filter((entry) => entry.source === 'hosted');
  const sdk = parsed.filter((entry) => entry.source === 'sdk');
  assert.equal(parsed.length, 77);
  assert.equal(hosted.length, 72);
  assert.equal(sdk.length, 5);
  assert.ok(hosted.every((entry) => /^[a-f0-9]{64}$/i.test(entry.description.sha256)));
  assert.deepEqual(sdk.map((entry) => entry.name).sort(), [
    'flutter',
    'flutter_localizations',
    'flutter_test',
    'flutter_web_plugins',
    'sky_engine',
  ]);

  const lockComponents = readFlutterComponents(REPO_ROOT);
  assert.equal(lockComponents.length, parsed.length);
  assert.equal(lockComponents.filter((entry) => entry.checksum?.algorithm === 'SHA256').length, 72);
  assert.equal(
    lockComponents.filter((entry) => entry.scope === 'excluded').length,
    parsed.filter((entry) => entry.source === 'sdk' || entry.dependency === 'direct dev').length,
  );
  assert.throws(
    () => parsePubspecLock('packages:\n  missing_digest:\n    dependency: transitive\n    description:\n      name: missing_digest\n      url: "https://pub.dev"\n    source: hosted\n    version: "1.0.0"\n'),
    /no valid SHA-256 archive digest/,
  );
});

test('license archive inspection is bounded to named license files and normalizes multiline grant text', () => {
  const mitText = [
    'MIT License',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files, to deal in the Software',
    'without restriction, including without limitation the rights to use, copy, modify,',
    'merge, publish, distribute, sublicense, and/or sell copies of the Software.',
  ].join('\n');
  const archive = createTarGzFile('package/LICENSE', mitText);
  const files = readLicenseFilesFromTarGz(archive);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'package/LICENSE');
  assert.equal(classifyLicenseText(files[0].text), 'MIT');

  const readme = createTarGzFile('package/Readme.md', `# package\n\n## License\n\n${mitText}`);
  const readmeFiles = readLicenseFilesFromTarGz(readme);
  assert.equal(readmeFiles.length, 1);
  assert.equal(classifyLicenseText(readmeFiles[0].text), 'MIT');
  assert.equal(readLicenseFilesFromTarGz(createTarGzFile('package/README.md', '# package\n\nNo license section.')).length, 0);
  assert.equal(
    extractReadmeLicenseSection('# package\n\n## License\n\nSee the [LICENSE][license] file.\n\n[license]: https://example.invalid/LICENSE'),
    null,
    'README sections that only point at an included LICENSE file do not override its text',
  );
});

test('SPDX expression handling preserves known expressions and leaves unknown text unresolved', () => {
  assert.equal(normalizeSpdxExpression('MIT and Apache-2.0'), 'MIT AND Apache-2.0');
  assert.equal(normalizeSpdxExpression('Apache-2.0/MIT'), 'Apache-2.0 OR MIT');
  assert.equal(normalizeSpdxExpression('Apache-2.0 WITH LLVM-exception OR MIT'), 'Apache-2.0 WITH LLVM-exception OR MIT');
  assert.equal(normalizeSpdxExpression('AGPL-3.0-or-later'), 'AGPL-3.0-or-later');
  assert.equal(normalizeSpdxExpression('MIT OR LicenseRef-Commercial'), null);
  assert.equal(normalizeSpdxExpression('MIT AND'), null);
  assert.equal(classifyLicenseText('GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007'), 'GPL-3.0-only');
  assert.equal(classifyLicenseText('GNU AFFERO GENERAL PUBLIC LICENSE Version 3'), 'AGPL-3.0-only');
  assert.equal(classifyLicenseText('This package has a custom commercial license.'), null);
});

test('CycloneDX 1.5 output covers all four ecosystems and each generated BOM validates', () => {
  const components = collectComponents();
  const created = '2026-10-08T00:00:00Z';
  const documents = buildCycloneDxDocuments({ components, created });
  assert.deepEqual(Object.keys(documents).sort(), [
    'cargo-crates.cdx.json',
    'flutter-mobile.cdx.json',
    'npm-workspaces.cdx.json',
    'python-projects.cdx.json',
  ]);

  for (const [filename, document] of Object.entries(documents)) {
    assert.equal(document.specVersion, '1.5', filename);
    assert.deepEqual(validateCycloneDxDocument(document), [], filename);
    assert.ok(document.components.length > 0, filename);
  }

  const aggregate = buildCycloneDxDocument({ components, created });
  assert.deepEqual(validateCycloneDxDocument(aggregate), []);
  assert.equal(aggregate.components.length, components.length);
});

test('CycloneDX CLI writes all ecosystem BOMs and --check validates each artifact', () => {
  const root = tempRepo();
  const outputDirectory = join(root, 'sbom');
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--format', 'cyclonedx', '--out-dir', outputDirectory, '--created', '2026-10-08T00:00:00Z'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.match(stdout, /Wrote 4 CycloneDX 1\.5 SBOMs/);
    for (const filename of [
      'npm-workspaces.cdx.json',
      'python-projects.cdx.json',
      'cargo-crates.cdx.json',
      'flutter-mobile.cdx.json',
    ]) {
      const artifact = join(outputDirectory, filename);
      assert.ok(existsSync(artifact), `${filename} should be generated`);
      assert.match(execFileSync(process.execPath, [SCRIPT, '--check', artifact], { cwd: REPO_ROOT, encoding: 'utf8' }), /is valid CycloneDX 1\.5/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('license metadata resolution accepts exact-version SPDX data and leaves unknown metadata unresolved', async () => {
  const cargoEntry = {
    ecosystem: 'cargo',
    name: 'fixture-crate',
    version: '1.2.3',
    purl: 'pkg:cargo/fixture-crate@1.2.3',
    license: null,
    licenseName: null,
    licenseSource: null,
    checksum: null,
    comment: null,
    raw: null,
    scope: 'required',
    sourcePath: 'Cargo.lock',
    integrity: null,
    pinned: true,
  };
  let metadataRequests = 0;
  const optionalCargoEntry = { ...cargoEntry, scope: 'optional', sourcePath: 'Cargo.optional.lock', comment: 'optional dependency group' };
  const declared = await resolveLicenseMetadata([cargoEntry, optionalCargoEntry], {
    fetchImpl: async (url) => {
      metadataRequests += 1;
      assert.equal(url, 'https://crates.io/api/v1/crates/fixture-crate/1.2.3');
      return new Response(JSON.stringify({ version: { license: 'MIT OR Apache-2.0' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(declared.components[0].license, 'MIT OR Apache-2.0');
  assert.match(declared.components[0].licenseSource, /crates\.io version metadata/);
  assert.equal(declared.components[1].scope, 'optional');
  assert.equal(declared.components[1].sourcePath, 'Cargo.optional.lock');
  assert.equal(declared.components[1].comment, 'optional dependency group');
  assert.equal(metadataRequests, 1, 'identical ecosystem/name/version records must share the metadata lookup');
  assert.equal(declared.unresolved.length, 0);

  const unknown = await resolveLicenseMetadata([cargoEntry], {
    fetchImpl: async () => new Response(JSON.stringify({ version: { license: 'Commercial custom terms' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(unknown.components[0].license, null);
  assert.equal(unknown.unresolved.length, 1);
  assert.equal(unknown.unresolved[0].purl, cargoEntry.purl);
});

test('npm and pub archive license fallbacks verify lockfile digests before reading license text', async () => {
  const root = tempRepo();
  const archive = createTarGzFile(
    'package/LICENSE',
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.',
  );
  const sri = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  const archiveSha256 = createHash('sha256').update(archive).digest('hex');
  const npmEntry = {
    ecosystem: 'npm',
    name: 'fixture-package',
    version: '1.0.0',
    purl: 'pkg:npm/fixture-package@1.0.0',
    license: null,
    licenseName: null,
    licenseSource: null,
    checksum: null,
    comment: null,
    raw: null,
    scope: 'required',
    sourcePath: 'package-lock.json#node_modules/fixture-package',
    integrity: sri,
    pinned: true,
  };
  const pubEntry = {
    ...npmEntry,
    ecosystem: 'pub',
    name: 'fixture-pub',
    purl: 'pkg:pub/fixture-pub@1.0.0',
    sourcePath: 'apps/mobile/pubspec.lock#fixture-pub',
    integrity: archiveSha256,
  };
  try {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/fixture-package': { version: '1.0.0', integrity: sri },
      },
    }));
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url === 'https://registry.npmjs.org/fixture-package/1.0.0') {
        return new Response(JSON.stringify({
          dist: { tarball: 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz') {
        return new Response(archive, { status: 200 });
      }
      if (url === 'https://pub.dev/api/archives/fixture-pub-1.0.0.tar.gz') {
        return new Response(archive, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await resolveLicenseMetadata([npmEntry, pubEntry], { root, fetchImpl });
    assert.equal(result.components[0].license, 'MIT');
    assert.equal(result.components[1].license, 'MIT');
    assert.match(result.components[0].licenseSource, /verified by package-lock\.json/);
    assert.match(result.components[1].licenseSource, /verified by pubspec\.lock/);
    assert.equal(result.unresolved.length, 0);
    assert.equal(calls.length, 3);

    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/fixture-package': { version: '1.0.0', integrity: `sha512-${Buffer.from('wrong').toString('base64')}` },
      },
    }));
    const mismatched = await resolveLicenseMetadata([npmEntry], {
      root,
      fetchImpl: async (url) => {
        if (url === 'https://registry.npmjs.org/fixture-package/1.0.0') {
          return new Response(JSON.stringify({
            dist: { tarball: 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz' },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(archive, { status: 200 });
      },
    });
    assert.equal(mismatched.components[0].license, null);
    assert.match(mismatched.components[0].licenseSource, /integrity mismatch/);
    assert.equal(mismatched.unresolved.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('npm archive fallback rejects registry metadata that points to an unapproved host', async () => {
  const root = tempRepo();
  try {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/hostile-package': { version: '1.0.0', integrity: 'sha512-AAAA' } },
    }));
    const entry = {
      ecosystem: 'npm',
      name: 'hostile-package',
      version: '1.0.0',
      purl: 'pkg:npm/hostile-package@1.0.0',
      license: null,
      licenseName: null,
      licenseSource: null,
      checksum: null,
      comment: null,
      raw: null,
      scope: 'required',
      sourcePath: 'package-lock.json#node_modules/hostile-package',
      integrity: 'sha512-AAAA',
      pinned: true,
    };
    const calls = [];
    const result = await resolveLicenseMetadata([entry], {
      root,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({
          dist: { tarball: 'https://unapproved.invalid/hostile-package.tgz' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(calls.length, 1, 'the rejected archive host must never be fetched');
    assert.equal(result.components[0].license, null);
    assert.match(result.components[0].licenseSource, /unapproved package archive host/);
    assert.equal(result.unresolved.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PyPI license archive fallback requires the exact version sdist SHA-256', async () => {
  const archive = createTarGzFile(
    'fixture_distribution-1.0.0/LICENSE',
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.',
  );
  const digest = createHash('sha256').update(archive).digest('hex');
  const entry = {
    ecosystem: 'pypi',
    name: 'fixture_distribution',
    version: '1.0.0',
    purl: 'pkg:pypi/fixture-distribution@1.0.0',
    license: null,
    licenseName: null,
    licenseSource: null,
    checksum: null,
    comment: null,
    raw: null,
    scope: 'required',
    sourcePath: 'services/fixture/requirements.txt',
    integrity: null,
    pinned: true,
  };
  const metadata = {
    info: { license: '', classifiers: [] },
    urls: [{
      packagetype: 'sdist',
      url: 'https://files.pythonhosted.org/packages/example/fixture-distribution-1.0.0.tar.gz',
      filename: 'fixture-distribution-1.0.0.tar.gz',
      digests: { sha256: digest },
    }],
  };
  const resolved = await resolveLicenseMetadata([entry], {
    fetchImpl: async (url) => {
      if (url === 'https://pypi.org/pypi/fixture-distribution/1.0.0/json') {
        return new Response(JSON.stringify(metadata), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === metadata.urls[0].url) return new Response(archive, { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(resolved.components[0].license, 'MIT');
  assert.match(resolved.components[0].licenseSource, /source archive verified by its JSON digest/);
  assert.equal(resolved.unresolved.length, 0);

  const tamperedMetadata = {
    ...metadata,
    urls: [{ ...metadata.urls[0], digests: { sha256: '0'.repeat(64) } }],
  };
  const tampered = await resolveLicenseMetadata([entry], {
    fetchImpl: async (url) => {
      if (url === 'https://pypi.org/pypi/fixture-distribution/1.0.0/json') {
        return new Response(JSON.stringify(tamperedMetadata), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(archive, { status: 200 });
    },
  });
  assert.equal(tampered.components[0].license, null);
  assert.match(tampered.components[0].licenseSource, /source archive digest mismatch/);
  assert.equal(tampered.unresolved.length, 1);
});

test('the CLI writes a document that validates, and --check accepts it, and a corrupt one is rejected', () => {
  const root = tempRepo();
  try {
    const out = join(root, 'sbom.json');
    const stdout = execFileSync(process.execPath, [SCRIPT, '--out', out, '--created', '2026-10-07T00:00:00Z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.match(stdout, /SBOM: \d+ components/);
    assert.ok(existsSync(out));

    const written = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(validateSpdxDocument(written), []);

    const checked = execFileSync(process.execPath, [SCRIPT, '--check', out], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.match(checked, /is valid SPDX-2\.3 with \d+ packages\./);

    // An empty versionInfo is the failure mode that reads as authoritative: a component with no version
    // and no explanation. The validator must reject it, and the generator must never produce it.
    const tampered = JSON.parse(JSON.stringify(written));
    tampered.packages[1].versionInfo = '';
    const failures = validateSpdxDocument(tampered);
    assert.ok(
      failures.some((line) => line.includes('no versionInfo')),
      `expected a versionInfo failure, saw ${JSON.stringify(failures)}`,
    );

    const duplicate = JSON.parse(JSON.stringify(written));
    duplicate.packages[2].SPDXID = duplicate.packages[1].SPDXID;
    assert.ok(validateSpdxDocument(duplicate).some((line) => line.includes('duplicate SPDXID')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--require-pinned fails while anything is range-declared, and the count is visible either way', () => {
  const out = join(tempRepo(), 'sbom.json');
  const populated = execFileSync(process.execPath, [SCRIPT, '--out', out, '--created', '2026-10-07T00:00:00Z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.match(populated, /declared without an exact version/);

  // spawnSync rather than execFileSync: the exit code and stderr of a failing gate are the evidence,
  // and reading them off a thrown error object is a detail of the child_process implementation.
  // maxBuffer matters here: a full SBOM on stdout is several hundred kilobytes, and the default 1 MB
  // limit kills the child before it exits, which reads as "no exit code" rather than as a finding.
  const BUFFER = 64 * 1024 * 1024;
  const gated = spawnSync(process.execPath, [SCRIPT, '--json', '--require-pinned', '--quiet'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: BUFFER,
  });
  assert.equal(gated.error, undefined, `the generator could not run: ${gated.error?.message}`);
  assert.equal(gated.status, 1, 'the python distributions declare ranges and no lockfile, so --require-pinned must fail');
  assert.match(gated.stderr, /components have no exact version/);

  const ungated = spawnSync(process.execPath, [SCRIPT, '--json', '--quiet'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: BUFFER,
  });
  assert.equal(ungated.error, undefined, `the generator could not run: ${ungated.error?.message}`);
  assert.equal(ungated.status, 0, 'without --require-pinned the document is still emitted, with the gap recorded');
  const parsed = JSON.parse(ungated.stdout);
  const unpinned = parsed.packages.filter((entry) => entry.versionInfo === 'NOASSERTION');
  assert.ok(unpinned.length > 0, 'the unpinned components must be visible in the document, not only on stdout');
  assert.ok(
    unpinned.every((entry) => typeof entry.comment === 'string' && entry.comment.length > 0),
    'every NOASSERTION version must carry the declaration that produced it',
  );
});
