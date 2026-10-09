#!/usr/bin/env node
// # Responsibility: generate deterministic SPDX 2.3 and CycloneDX 1.5 SBOMs from npm, Python, Cargo, and Flutter lockfiles, preserving unknown metadata instead of guessing.

/**
 * The supply-chain gate had a CI job that produced an SBOM through a third-party action, and no way
 * to produce one from the repository itself. That matters twice: a buyer performing diligence wants
 * to run the generator and read the output, and a release engineer wants to diff two SBOMs to see
 * what changed. A vendored action gives neither.
 *
 * What this reads, and why each source:
 *
 *   package-lock.json (every workspace)   npm, lockfileVersion 3. The `packages` map is the resolved
 *                                         tree, so it is the truth about what gets installed.
 *   services/*\/requirements.txt           Python services, pinned `name==version`.
 *   libs/trading-core/pyproject.toml       Declared dependencies with ranges and no lockfile.
 *   packages/sdk-python/pyproject.toml
 *   packages/sdk-rust/Cargo.lock           Rust crates with checksums.
 *   services/low-latency-gateway/Cargo.lock
 *   apps/mobile/pubspec.lock               Flutter packages pinned by version and SHA-256.
 *
 * The rule that shapes the output: a dependency whose exact version is not recorded anywhere is
 * emitted with versionInfo NOASSERTION and a comment carrying the raw declaration. It is never
 * dropped (an SBOM that omits a component understates the attack surface) and never assigned a
 * version that the tree does not state (an SBOM that invents a version is worse than no SBOM: it is
 * evidence that reads as authoritative and is not).
 *
 * Usage:
 *   node scripts/generate-sbom.mjs --out path/to/sbom.spdx.json
 *   node scripts/generate-sbom.mjs --format cyclonedx --out-dir docs/sbom --resolve-license-metadata
 *   node scripts/generate-sbom.mjs --format cyclonedx --out path/to/sbom.cdx.json --resolve-license-metadata
 *   node scripts/generate-sbom.mjs --created 2026-10-08T00:00:00Z
 *   node scripts/generate-sbom.mjs --require-pinned                 exit 1 if anything is unpinned
 *   node scripts/generate-sbom.mjs --check path/to/sbom.json         validate either supported format
 *   node scripts/generate-sbom.mjs --json                            print the combined document to stdout
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** One place that knows where the manifests are; the test asserts every entry exists. */
export const MANIFESTS = {
  npm: ['package-lock.json'],
  requirements: [
    'services/execution-engine/requirements.txt',
    'services/market-data/requirements.txt',
    'services/trading-engine/requirements.txt',
  ],
  pyproject: ['libs/trading-core/pyproject.toml', 'packages/sdk-python/pyproject.toml'],
  cargo: ['packages/sdk-rust/Cargo.lock', 'services/low-latency-gateway/Cargo.lock'],
  flutter: ['apps/mobile/pubspec.lock'],
};

const NOASSERTION = 'NOASSERTION';
const GENERATOR = 'whitelabel-sbom-generator';
const SPDX_LICENSE_IDS = new Set([
  '0BSD',
  'Apache-1.1',
  'Apache-2.0',
  'AGPL-1.0-only',
  'AGPL-1.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'CDLA-Permissive-2.0',
  'ISC',
  'GPL-1.0-only',
  'GPL-1.0-or-later',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-2.0+',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'GPL-3.0+',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'OpenSSL',
  'Python-2.0',
  'SSPL-1.0',
  'Unlicense',
  'Unicode-3.0',
  'Zlib',
]);
const SPDX_EXCEPTION_IDS = new Set(['LLVM-exception']);

function rawLicenseText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const entries = value.map(rawLicenseText).filter(Boolean);
    return entries.length > 0 ? entries.join(' OR ') : '';
  }
  if (value && typeof value === 'object') {
    return rawLicenseText(value.type ?? value.id ?? value.name ?? '');
  }
  return '';
}

/** Parse only SPDX identifiers and expressions that this generator can preserve without guessing. */
export function normalizeSpdxExpression(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/([A-Za-z0-9.+-])\/([A-Za-z0-9.+-])/g, '$1 OR $2')
    .replace(/(^|[\s(])(and|or|with)(?=$|[\s)])/gi, (match, prefix, operator) => `${prefix}${operator.toUpperCase()}`)
    .replace(/\s+/g, ' ');
  if (!normalized) return null;

  const tokens = normalized.match(/\(|\)|[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
  const residue = normalized
    .replace(/[A-Za-z0-9][A-Za-z0-9.+-]*/g, '')
    .replace(/[()\s]/g, '');
  if (tokens.length === 0 || residue.length > 0) return null;

  let index = 0;
  function parsePrimary() {
    const token = tokens[index];
    if (token === '(') {
      index += 1;
      if (!parseOr() || tokens[index] !== ')') return false;
      index += 1;
    } else {
      if (!SPDX_LICENSE_IDS.has(token)) return false;
      index += 1;
    }
    if (tokens[index]?.toUpperCase() === 'WITH') {
      index += 1;
      if (!SPDX_EXCEPTION_IDS.has(tokens[index])) return false;
      index += 1;
    }
    return true;
  }
  function parseAnd() {
    if (!parsePrimary()) return false;
    while (tokens[index]?.toUpperCase() === 'AND') {
      index += 1;
      if (!parsePrimary()) return false;
    }
    return true;
  }
  function parseOr() {
    if (!parseAnd()) return false;
    while (tokens[index]?.toUpperCase() === 'OR') {
      index += 1;
      if (!parseAnd()) return false;
    }
    return true;
  }

  if (!parseOr() || index !== tokens.length) return null;
  return normalized;
}

/** A component the SBOM names. Unknown version/license data stays explicit; it is never invented. */
function component({
  ecosystem,
  name,
  version,
  purl,
  license,
  licenseName,
  licenseSource,
  checksum,
  comment,
  raw,
  scope = 'required',
  sourcePath,
  integrity,
}) {
  const rawLicense = rawLicenseText(license);
  const licenseExpression = normalizeSpdxExpression(rawLicense);
  return {
    ecosystem,
    name,
    version: version ?? NOASSERTION,
    purl: purl ?? `${purlPrefix(ecosystem)}/${name}${version ? `@${version}` : ''}`,
    license: licenseExpression,
    licenseName: licenseExpression ? null : (licenseName ?? (rawLicense || null)),
    licenseSource: licenseSource ?? (licenseExpression ? 'lockfile' : null),
    checksum: checksum ?? null,
    comment: comment ?? null,
    raw: raw ?? null,
    scope,
    sourcePath: sourcePath ?? null,
    integrity: integrity ?? null,
    pinned: Boolean(version),
  };
}

function purlPrefix(ecosystem) {
  if (ecosystem === 'npm') return 'pkg:npm';
  if (ecosystem === 'pypi') return 'pkg:pypi';
  if (ecosystem === 'cargo') return 'pkg:cargo';
  if (ecosystem === 'pub') return 'pkg:pub';
  throw new Error(`Unknown ecosystem: ${ecosystem}`);
}

/** npm's `integrity` is `<algorithm>-<base64>`; SPDX wants hex. Unknown algorithms are kept as-is. */
export function integrityToSpdxChecksum(integrity) {
  if (typeof integrity !== 'string' || !integrity.includes('-')) return null;
  const [algorithm, encoded] = integrity.split('-');
  const normalised = algorithm.toUpperCase().replace(/^SHA(\d)/, 'SHA$1');
  const names = { SHA1: 'SHA1', SHA256: 'SHA256', SHA384: 'SHA384', SHA512: 'SHA512' };
  if (!names[normalised]) return null;
  let hex;
  try {
    hex = Buffer.from(encoded, 'base64').toString('hex');
  } catch {
    return null;
  }
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  return { algorithm: names[normalised], checksumValue: hex };
}

/** `node_modules/@scope/pkg` -> `@scope/pkg`; keeps the scope, which is part of the package name. */
export function npmNameFromPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index === -1) return null;
  return path.slice(index + marker.length);
}

export function readNpmComponents(root) {
  const file = join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(file, 'utf8'));
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error(`${file}: no "packages" map; only lockfileVersion 3 is supported`);
  }

  const components = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!path.includes('node_modules/')) continue; // workspace roots are not third-party components
    if (entry.link === true) continue; // symlinked workspace package, not a download
    const name = entry.name ?? npmNameFromPath(path);
    if (!name) continue;
    const scope = entry.dev === true ? 'excluded' : entry.devOptional === true || entry.optional === true ? 'optional' : 'required';
    const sourcePath = `package-lock.json#${path}`;
    if (!entry.version) {
      // Present in the tree with no version at all. Naming it with NOASSERTION is the honest answer.
      components.push(
        component({
          ecosystem: 'npm',
          name,
          raw: path,
          comment: 'no version recorded in package-lock.json',
          scope,
          sourcePath,
        }),
      );
      continue;
    }
    components.push(
      component({
        ecosystem: 'npm',
        name,
        version: entry.version,
        license: entry.license ?? entry.licenses ?? null,
        checksum: integrityToSpdxChecksum(entry.integrity),
        integrity: entry.integrity ?? null,
        comment: entry.dev
          ? 'development dependency'
          : entry.devOptional
            ? 'optional dependency also reachable through development dependencies'
            : entry.optional
              ? 'optional dependency'
              : null,
        scope,
        sourcePath,
      }),
    );
  }
  return components;
}

/** `uvicorn[standard]==0.31.0` -> { name: 'uvicorn', extras: '[standard]', version: '0.31.0' }. */
export function parseRequirementLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('-')) return { name: null, comment: `pip option: ${trimmed}`, raw: trimmed };
  const pinned = /^([A-Za-z0-9._-]+)(\[[^\]]+\])?\s*==\s*([^\s;#]+)/.exec(trimmed);
  if (pinned) return { name: pinned[1], extras: pinned[2] ?? '', version: pinned[3], raw: trimmed };
  const loose = /^([A-Za-z0-9._-]+)(\[[^\]]+\])?\s*([<>=!~].*)?$/.exec(trimmed.split('#')[0].trim());
  if (loose) return { name: loose[1], extras: loose[2] ?? '', version: null, raw: trimmed };
  return { name: null, comment: `unparsed requirement: ${trimmed}`, raw: trimmed };
}

export function readRequirementComponents(root) {
  const components = [];
  for (const relative of MANIFESTS.requirements) {
    const file = join(root, relative);
    if (!existsSync(file)) throw new Error(`${relative}: missing; the SBOM cannot silently omit an ecosystem`);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const parsed = parseRequirementLine(line);
      if (!parsed) continue;
      if (!parsed.name) {
        components.push(
          component({
            ecosystem: 'pypi',
            name: parsed.raw,
            raw: relative,
            comment: parsed.comment,
            scope: 'excluded',
            sourcePath: relative,
          }),
        );
        continue;
      }
      components.push(
        component({
          ecosystem: 'pypi',
          name: parsed.name,
          version: parsed.version,
          comment: `${relative}${parsed.extras ? ` (extras ${parsed.extras})` : ''}${parsed.version ? '' : `: declared as ${parsed.raw}`}`,
          scope: 'required',
          sourcePath: relative,
        }),
      );
    }
  }
  return components;
}

/**
 * pyproject dependencies are ranges. The PEP 508 strings are kept verbatim in the comment because a
 * range is still information: `httpx>=0.27` tells an auditor what the floor is, and pretending the
 * floor is the installed version would be worse than saying the version is unknown.
 *
 * Optional-dependency groups are read too. This repository declares `dependencies = []` for its Python
 * libraries and puts the real ones under `[project.optional-dependencies]` (`live`, `dev`), so a parser
 * that only reads the runtime array would report a component-free library and hide `websockets`,
 * `httpx` and the test toolchain from anyone reading the SBOM. The group name travels in the comment
 * because "installed only with the live extra" is materially different from "always installed".
 *
 * An empty array contributes no components. It is a fact about the file, not an omission, and inventing
 * a pseudo-component named after the manifest would put a non-package into the package list.
 */
export function readPyprojectComponents(root) {
  const components = [];
  for (const relative of MANIFESTS.pyproject) {
    const file = join(root, relative);
    if (!existsSync(file)) throw new Error(`${relative}: missing; the SBOM cannot silently omit an ecosystem`);
    const text = readFileSync(file, 'utf8');

    const runtime = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
    if (runtime) {
      components.push(...specsToComponents({ arrayText: runtime[1], relative, group: null }));
    }

    const optionalIndex = text.indexOf('[project.optional-dependencies]');
    if (optionalIndex !== -1) {
      const rest = text.slice(optionalIndex);
      const nextSection = rest.indexOf('\n[', '[project.optional-dependencies]'.length);
      const section = nextSection === -1 ? rest : rest.slice(0, nextSection);
      for (const group of section.matchAll(/([A-Za-z0-9._-]+)\s*=\s*\[([\s\S]*?)\]/g)) {
        components.push(...specsToComponents({ arrayText: group[2], relative, group: group[1] }));
      }
    }

    if (!runtime && optionalIndex === -1) {
      throw new Error(`${relative}: no dependencies array and no optional-dependencies table; the file layout changed`);
    }
  }
  return components;
}

/** Quoted entries in a TOML array, each one a PEP 508 specifier. */
function specsToComponents({ arrayText, relative, group }) {
  const specs = [...arrayText.matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1].trim()).filter(Boolean);
  const where = group ? `${relative} (extra ${group})` : relative;
  return specs.map((spec) => {
    const name = /^([A-Za-z0-9._-]+)/.exec(spec)?.[1];
    if (!name) {
      return component({ ecosystem: 'pypi', name: spec, raw: where, comment: `${where}: unparsed requirement ${spec}` });
    }
    const exact = /==\s*([^\s;]+)/.exec(spec);
    return component({
      ecosystem: 'pypi',
      name,
      version: exact ? exact[1] : null,
      comment: `${where}: declared as ${spec}${exact ? '' : ' (range, no lockfile)'}`,
      scope: group === 'dev' ? 'excluded' : group ? 'optional' : 'required',
      sourcePath: relative,
    });
  });
}

export function readCargoComponents(root) {
  const components = [];
  for (const relative of MANIFESTS.cargo) {
    const file = join(root, relative);
    if (!existsSync(file)) throw new Error(`${relative}: missing; the SBOM cannot silently omit an ecosystem`);
    const text = readFileSync(file, 'utf8');
    for (const block of text.split('[[package]]').slice(1)) {
      const name = /name\s*=\s*"([^"]+)"/.exec(block)?.[1];
      const version = /version\s*=\s*"([^"]+)"/.exec(block)?.[1];
      const checksum = /checksum\s*=\s*"([^"]+)"/.exec(block)?.[1];
      const source = /source\s*=\s*"([^"]+)"/.exec(block)?.[1];
      if (!name) continue;
      components.push(
        component({
          ecosystem: 'cargo',
          name,
          version,
          checksum: checksum ? { algorithm: 'SHA256', checksumValue: checksum } : null,
          comment: `${relative}${source ? '' : ' (path/workspace member, not a registry download)'}`,
          scope: source?.startsWith('registry+') ? 'required' : 'excluded',
          sourcePath: relative,
        }),
      );
    }
  }
  return components;
}

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed.replace(/\s+#.*$/, '').trim();
}

/** Parse the lockfile subset emitted by Dart pub and fail if its structure drifts. */
export function parsePubspecLock(text) {
  const lines = text.split(/\r?\n/);
  const packages = [];
  let insidePackages = false;
  let current = null;
  let insideDescription = false;

  function finishPackage() {
    if (!current) return;
    const { dependency, source, version, description } = current;
    if (!dependency || !source || !version) {
      throw new Error(`apps/mobile/pubspec.lock: ${current.name} lacks dependency, source, or version`);
    }
    if (!['direct main', 'direct dev', 'transitive'].includes(dependency)) {
      throw new Error(`apps/mobile/pubspec.lock: ${current.name} has unsupported dependency scope ${dependency}`);
    }
    if (!['hosted', 'sdk'].includes(source)) {
      throw new Error(`apps/mobile/pubspec.lock: ${current.name} has unsupported source ${source}`);
    }
    if (source === 'hosted') {
      if (!description || typeof description !== 'object') {
        throw new Error(`apps/mobile/pubspec.lock: hosted package ${current.name} has no description map`);
      }
      if (typeof description.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(description.sha256)) {
        throw new Error(`apps/mobile/pubspec.lock: hosted package ${current.name} has no valid SHA-256 archive digest`);
      }
      if (description.url !== 'https://pub.dev') {
        throw new Error(`apps/mobile/pubspec.lock: hosted package ${current.name} uses an unreviewed host`);
      }
    }
    packages.push({ ...current, description });
    current = null;
    insideDescription = false;
  }

  for (const line of lines) {
    if (!insidePackages) {
      if (line === 'packages:') insidePackages = true;
      continue;
    }
    if (/^[^\s#][^:]*:\s*(?:#.*)?$/.test(line)) break;
    const packageHeader = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (packageHeader) {
      finishPackage();
      current = { name: packageHeader[1], dependency: null, source: null, version: null, description: null };
      continue;
    }
    if (!current || !line.trim() || line.trimStart().startsWith('#')) continue;
    const topField = /^    ([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (topField) {
      const [, key, rawValue = ''] = topField;
      if (key === 'description') {
        const scalar = parseYamlScalar(rawValue);
        current.description = scalar ? scalar : {};
        insideDescription = !scalar;
      } else {
        const value = parseYamlScalar(rawValue);
        if (key === 'dependency') current.dependency = value;
        else if (key === 'source') current.source = value;
        else if (key === 'version') current.version = value;
        insideDescription = false;
      }
      continue;
    }
    const descriptionField = /^      ([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (descriptionField && insideDescription && current.description && typeof current.description === 'object') {
      current.description[descriptionField[1]] = parseYamlScalar(descriptionField[2]);
    }
  }
  finishPackage();
  if (!insidePackages) throw new Error('apps/mobile/pubspec.lock: no packages map');
  if (packages.length === 0) throw new Error('apps/mobile/pubspec.lock: packages map is empty');
  return packages;
}

export function readFlutterComponents(root) {
  const components = [];
  for (const relative of MANIFESTS.flutter) {
    const file = join(root, relative);
    if (!existsSync(file)) throw new Error(`${relative}: missing; the SBOM cannot silently omit Flutter`);
    const packages = parsePubspecLock(readFileSync(file, 'utf8'));
    for (const entry of packages) {
      const hosted = entry.source === 'hosted';
      const version = entry.version;
      const archiveHash = hosted ? entry.description.sha256.toLowerCase() : null;
      const comment = hosted
        ? `${relative}${entry.dependency === 'direct dev' ? ' (development dependency)' : ''}`
        : `${relative} (Flutter SDK package)`;
      components.push(
        component({
          ecosystem: 'pub',
          name: entry.name,
          version,
          purl: `pkg:pub/${entry.name}@${version}`,
          checksum: archiveHash ? { algorithm: 'SHA256', checksumValue: archiveHash } : null,
          integrity: archiveHash,
          comment,
          scope: !hosted || entry.dependency === 'direct dev' ? 'excluded' : 'required',
          sourcePath: `${relative}#${entry.name}`,
        }),
      );
    }
  }
  return components;
}

function spdxId(componentEntry, used) {
  const slug = `${componentEntry.ecosystem}-${componentEntry.name}`.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 60);
  const digest = createHash('sha256').update(`${componentEntry.ecosystem}|${componentEntry.name}|${componentEntry.version}`).digest('hex').slice(0, 8);
  let id = `SPDXRef-${slug}-${digest}`;
  let counter = 1;
  while (used.has(id)) id = `SPDXRef-${slug}-${digest}-${counter++}`;
  used.add(id);
  return id;
}

/** Sorted so two runs over the same tree produce the same document, which is what makes diffing useful. */
export function collectComponents(root = REPO_ROOT) {
  const all = [
    ...readNpmComponents(root),
    ...readRequirementComponents(root),
    ...readPyprojectComponents(root),
    ...readCargoComponents(root),
    ...readFlutterComponents(root),
  ];
  const lockedPythonRuntimePackages = new Set(
    all
      .filter((entry) => entry.ecosystem === 'pypi' && entry.scope === 'required' && entry.pinned)
      .map((entry) => entry.name.toLowerCase().replace(/[-_.]+/g, '-')),
  );
  const scoped = all.map((entry) => {
    const normalizedName = entry.name.toLowerCase().replace(/[-_.]+/g, '-');
    if (entry.ecosystem === 'pypi' && entry.scope === 'optional' && !entry.pinned && lockedPythonRuntimePackages.has(normalizedName)) {
      return {
        ...entry,
        scope: 'excluded',
        comment: `${entry.comment ?? ''} (declaration-only; the pinned runtime package is listed from requirements.txt)`.trim(),
      };
    }
    return entry;
  });
  return scoped.sort((left, right) =>
    `${left.ecosystem}|${left.name}|${left.version}|${left.sourcePath ?? ''}`.localeCompare(
      `${right.ecosystem}|${right.name}|${right.version}|${right.sourcePath ?? ''}`,
    ),
  );
}

export function buildSpdxDocument({ root = REPO_ROOT, created = null, version = '1.0.0', components = null } = {}) {
  const collectedComponents = components ?? collectComponents(root);
  const used = new Set();
  const packages = collectedComponents.map((entry) => {
    const id = spdxId(entry, used);
    return {
      SPDXID: id,
      name: entry.name,
      versionInfo: entry.version,
      downloadLocation: NOASSERTION,
      filesAnalyzed: false,
      licenseConcluded: NOASSERTION,
      licenseDeclared: entry.license ?? NOASSERTION,
      supplier: NOASSERTION,
      comment: entry.comment ?? undefined,
      checksums: entry.checksum ? [entry.checksum] : undefined,
      externalRefs: [
        { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: entry.purl },
      ],
    };
  });

  const documentId = createHash('sha256')
    .update(packages.map((entry) => `${entry.SPDXID}@${entry.versionInfo}`).join('\n'))
    .digest('hex');
  const createdIso = created ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const unpinned = collectedComponents.filter((entry) => !entry.pinned);

  const rootPackage = {
    SPDXID: 'SPDXRef-Package-whitelabel-copytrade',
    name: 'whitelabel-copytrade',
    versionInfo: version,
    downloadLocation: NOASSERTION,
    filesAnalyzed: false,
    licenseConcluded: NOASSERTION,
    licenseDeclared: NOASSERTION,
    supplier: NOASSERTION,
    // The product itself is not a package-manager component; `generic` is the purl type for exactly
    // this case, and giving it one keeps the document uniform for consumers that key on purls.
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:generic/whitelabel-copytrade@${version}`,
      },
    ],
    comment: `Multi-tenant white-label crypto copy-trading platform. ${collectedComponents.length} components; ${unpinned.length} declared without an exact version.`,
  };

  const document = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `whitelabel-copytrade-${documentId.slice(0, 12)}`,
    documentNamespace: `https://whitelabel-copytrade.invalid/sbom/${documentId}`,
    creationInfo: {
      created: createdIso,
      creators: [`Tool: ${GENERATOR}-${version}`],
      licenseListVersion: '3.24',
    },
    packages: [rootPackage, ...packages],
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: rootPackage.SPDXID },
      ...packages.map((entry) => ({
        spdxElementId: rootPackage.SPDXID,
        relationshipType: 'CONTAINS',
        relatedSpdxElement: entry.SPDXID,
      })),
    ],
  };

  return { document, components: collectedComponents, unpinned };
}

/** Validation is deliberately strict about the fields a consumer actually reads. */
export function validateSpdxDocument(document) {
  const failures = [];
  // The described package is the product; everything else is a dependency, and dependencies are held
  // to the stricter purl rule because that is what a vulnerability scanner will key on.
  const described = document?.relationships?.find((entry) => entry.relationshipType === 'DESCRIBES')?.relatedSpdxElement ?? null;
  if (document?.spdxVersion !== 'SPDX-2.3') failures.push(`spdxVersion is ${document?.spdxVersion ?? 'absent'}, expected SPDX-2.3`);
  if (document?.dataLicense !== 'CC0-1.0') failures.push('dataLicense must be CC0-1.0');
  if (document?.SPDXID !== 'SPDXRef-DOCUMENT') failures.push('SPDXID must be SPDXRef-DOCUMENT');
  if (!Array.isArray(document?.packages) || document.packages.length === 0) failures.push('packages must be a non-empty array');
  if (!document?.documentNamespace) failures.push('documentNamespace is required');
  if (!document?.creationInfo?.created) failures.push('creationInfo.created is required');

  const ids = new Set();
  for (const entry of document?.packages ?? []) {
    if (!entry.SPDXID) failures.push(`package ${entry.name ?? '?'} has no SPDXID`);
    else if (ids.has(entry.SPDXID)) failures.push(`duplicate SPDXID ${entry.SPDXID}`);
    else ids.add(entry.SPDXID);
    if (!entry.name) failures.push(`package ${entry.SPDXID} has no name`);
    // versionInfo is required to be present, NOASSERTION is a legitimate value, and an empty string is not.
    if (typeof entry.versionInfo !== 'string' || entry.versionInfo.trim() === '') {
      failures.push(`package ${entry.name} has no versionInfo (use NOASSERTION rather than an empty string)`);
    }
    if (entry.filesAnalyzed !== false) failures.push(`package ${entry.name} must set filesAnalyzed false`);
    const purl = entry.externalRefs?.find((ref) => ref.referenceType === 'purl');
    if (!purl) failures.push(`package ${entry.name} has no purl externalRef`);
    else if (!/^pkg:(npm|pypi|cargo|pub|generic)\//.test(purl.referenceLocator)) {
      failures.push(`package ${entry.name} purl ${purl.referenceLocator} is not a recognised purl`);
    } else if (entry.SPDXID !== described && !/^pkg:(npm|pypi|cargo|pub)\//.test(purl.referenceLocator)) {
      failures.push(`dependency ${entry.name} purl ${purl.referenceLocator} must name its package manager`);
    }
  }
  return failures;
}

export const CYCLONEDX_FILENAMES = {
  npm: 'npm-workspaces.cdx.json',
  pypi: 'python-projects.cdx.json',
  cargo: 'cargo-crates.cdx.json',
  pub: 'flutter-mobile.cdx.json',
};

const CYCLONEDX_ROOT_NAMES = {
  npm: 'whitelabel-copytrade-npm-workspaces',
  pypi: 'whitelabel-copytrading-python-projects',
  cargo: 'whitelabel-copytrading-rust-crates',
  pub: 'wlct-mobile-flutter-application',
};

function cyclonedxLicenseObjects(entry) {
  if (entry.license) {
    const expression = normalizeSpdxExpression(entry.license);
    if (!expression) throw new Error(`${entry.purl}: cannot serialize malformed SPDX license expression ${entry.license}`);
    const ids = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
    const operators = new Set(['AND', 'OR', 'WITH']);
    const identifiers = ids.filter((token) => !operators.has(token));
    if (identifiers.length === 1 && expression === identifiers[0]) return [{ license: { id: identifiers[0] } }];
    return [{ expression }];
  }
  if (entry.licenseName) return [{ license: { name: entry.licenseName } }];
  return [];
}

function cycloneDxHash(checksum) {
  if (!checksum) return null;
  const algorithm = checksum.algorithm === 'SHA256' ? 'SHA-256' : checksum.algorithm === 'SHA512' ? 'SHA-512' : null;
  if (!algorithm || !/^[a-f0-9]+$/i.test(checksum.checksumValue)) return null;
  return { alg: algorithm, content: checksum.checksumValue.toLowerCase() };
}

function deterministicUuid(input) {
  const bytes = createHash('sha256').update(input).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cycloneDxComponent(entry) {
  const identity = `${entry.ecosystem}|${entry.sourcePath ?? ''}|${entry.name}|${entry.version}|${entry.purl}`;
  const bomRef = `urn:wlct:component:${createHash('sha256').update(identity).digest('hex')}`;
  const output = {
    type: 'library',
    'bom-ref': bomRef,
    name: entry.name,
    purl: entry.purl,
    scope: entry.scope,
    properties: [
      { name: 'wlct:ecosystem', value: entry.ecosystem },
      { name: 'wlct:source-manifest', value: entry.sourcePath ?? 'UNKNOWN' },
      { name: 'wlct:version-status', value: entry.pinned ? 'pinned' : 'UNKNOWN' },
    ],
  };
  if (entry.pinned) output.version = entry.version;
  if (entry.licenseSource) output.properties.push({ name: 'wlct:license-source', value: entry.licenseSource });
  if (entry.comment) output.properties.push({ name: 'wlct:source-note', value: entry.comment });
  const licenses = cyclonedxLicenseObjects(entry);
  if (licenses.length > 0) output.licenses = licenses;
  const hash = cycloneDxHash(entry.checksum);
  if (hash) output.hashes = [hash];
  return output;
}

/** Build one CycloneDX 1.5 BOM. Its timestamp is explicit so committed documents are reproducible. */
export function buildCycloneDxDocument({ root = REPO_ROOT, created = null, version = '1.0.0', components = null, ecosystem = null } = {}) {
  const allComponents = components ?? collectComponents(root);
  const selected = ecosystem ? allComponents.filter((entry) => entry.ecosystem === ecosystem) : allComponents;
  if (selected.length === 0) throw new Error(`No components available for CycloneDX ecosystem ${ecosystem ?? 'all'}`);
  const timestamp = created ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (Number.isNaN(new Date(timestamp).getTime())) throw new Error(`Invalid CycloneDX creation timestamp: ${timestamp}`);

  const identity = selected
    .map((entry) => `${entry.ecosystem}|${entry.purl}|${entry.license ?? entry.licenseName ?? 'UNKNOWN'}|${entry.scope}`)
    .sort()
    .join('\n');
  const rootName = ecosystem ? CYCLONEDX_ROOT_NAMES[ecosystem] : 'whitelabel-copytrading-platform';
  const rootRef = `pkg:generic/${rootName}@${version}`;
  const document = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${deterministicUuid(`${rootName}|${version}|${identity}`)}`,
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: 'White-Label Crypto Copy Trading', name: GENERATOR, version: '1.1.0' }],
      component: { type: 'application', 'bom-ref': rootRef, name: rootName, version },
    },
    components: selected.map(cycloneDxComponent).sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
  };
  return document;
}

export function buildCycloneDxDocuments({ root = REPO_ROOT, created = null, version = '1.0.0', components = null } = {}) {
  const allComponents = components ?? collectComponents(root);
  return Object.fromEntries(
    Object.entries(CYCLONEDX_FILENAMES).map(([ecosystem, filename]) => [
      filename,
      buildCycloneDxDocument({ root, created, version, components: allComponents, ecosystem }),
    ]),
  );
}

export function validateCycloneDxDocument(document) {
  const failures = [];
  if (document?.bomFormat !== 'CycloneDX') failures.push('bomFormat must be CycloneDX');
  if (document?.specVersion !== '1.5') failures.push(`specVersion is ${document?.specVersion ?? 'absent'}, expected 1.5`);
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(document?.serialNumber ?? '')) {
    failures.push('serialNumber must be a UUID URN');
  }
  if (!Number.isInteger(document?.version) || document.version < 1) failures.push('version must be a positive integer');
  if (!document?.metadata?.timestamp || Number.isNaN(new Date(document.metadata.timestamp).getTime())) {
    failures.push('metadata.timestamp must be a valid date-time');
  }
  if (!document?.metadata?.component?.name || document?.metadata?.component?.type !== 'application') {
    failures.push('metadata.component must name the application root');
  }
  if (!Array.isArray(document?.components) || document.components.length === 0) failures.push('components must be a non-empty array');

  const refs = new Set();
  for (const entry of document?.components ?? []) {
    if (!entry['bom-ref']) failures.push(`component ${entry.name ?? '?'} has no bom-ref`);
    else if (refs.has(entry['bom-ref'])) failures.push(`duplicate bom-ref ${entry['bom-ref']}`);
    else refs.add(entry['bom-ref']);
    if (!entry.name) failures.push(`component ${entry['bom-ref'] ?? '?'} has no name`);
    if (entry.version !== undefined && (typeof entry.version !== 'string' || entry.version.trim() === '')) {
      failures.push(`component ${entry.name} has an invalid version`);
    }
    if (!/^pkg:(npm|pypi|cargo|pub)\//.test(entry.purl ?? '')) failures.push(`component ${entry.name} has no supported package URL`);
    if (entry.scope !== undefined && !['required', 'optional', 'excluded'].includes(entry.scope)) {
      failures.push(`component ${entry.name} has invalid scope ${entry.scope}`);
    }
    for (const licenseEntry of entry.licenses ?? []) {
      const expression = licenseEntry?.expression;
      const license = licenseEntry?.license;
      if (expression && !normalizeSpdxExpression(expression)) failures.push(`component ${entry.name} has malformed SPDX expression ${expression}`);
      if (license && !license.id && !license.name && !license.url) failures.push(`component ${entry.name} has an empty license object`);
      if (!expression && !license) failures.push(`component ${entry.name} has an invalid license entry`);
    }
    for (const hash of entry.hashes ?? []) {
      if (!['SHA-256', 'SHA-512'].includes(hash.alg) || !/^[a-f0-9]+$/i.test(hash.content ?? '')) {
        failures.push(`component ${entry.name} has an invalid checksum`);
      }
    }
  }
  return failures;
}

const LICENSE_FETCH_USER_AGENT = 'wlct-sbom-generator/1.1 (+https://github.com/Ainul-550Islam/White-Label01-Crypto-Copy-Trading-App)';
const MAX_LICENSE_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_LICENSE_ARCHIVE_EXPANDED_BYTES = 96 * 1024 * 1024;
const MAX_LICENSE_FILE_BYTES = 1024 * 1024;
const LICENSE_FILE_NAME = /^(?:(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._ -].*)?|README(?:\.[A-Za-z0-9]+)?)$/i;

export function extractReadmeLicenseSection(text) {
  const lines = text.split(/\r?\n/);
  let headingIndex = -1;
  let headingLevel = null;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^\s{0,3}(#{1,6})\s*(?:the\s+)?licen[cs]e\b(.*)$/i.exec(lines[index]);
    if (heading) {
      headingIndex = index;
      headingLevel = heading[1].length;
      if (heading[2].trim()) return lines.slice(index).join('\n');
      break;
    }
    if (/^\s*licen[cs]e\s*:/i.test(lines[index])) return lines.slice(index).join('\n');
  }
  if (headingIndex === -1) return null;
  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const heading = /^\s{0,3}(#{1,6})\s+/.exec(lines[index]);
    if (heading && heading[1].length <= headingLevel) {
      endIndex = index;
      break;
    }
  }
  const section = lines.slice(headingIndex + 1, endIndex).join('\n').trim();
  const prose = section
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]:\s*\S+/.test(line))
    .join(' ')
    .trim();
  if (/^see\s+(?:the\s+)?(?:\[[^\]]*licen[cs]e[^\]]*\](?:\[[^\]]*\])?|(?:licen[cs]e|copying))(?:\s+file)?\.?$/i.test(prose)) return null;
  return section || null;
}

function parseTarOctal(field) {
  const value = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!value) return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid tar archive size field');
  return parsed;
}

function parsePaxPath(text) {
  for (const line of text.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(line);
    if (match) return match[1];
  }
  return null;
}

/** Read only small license files from a gzip tar archive; archive members are never extracted to disk. */
export function readLicenseFilesFromTarGz(archive) {
  if (!Buffer.isBuffer(archive) || archive.length > MAX_LICENSE_ARCHIVE_BYTES) {
    throw new Error('license archive exceeds the configured compressed-size limit');
  }
  const tar = gunzipSync(archive, { maxOutputLength: MAX_LICENSE_ARCHIVE_EXPANDED_BYTES });
  const files = [];
  let offset = 0;
  let longName = null;
  let paxPath = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 0);
    const size = parseTarOctal(header.subarray(124, 136));
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length || size > MAX_LICENSE_ARCHIVE_EXPANDED_BYTES) throw new Error('truncated or oversized tar archive member');
    const content = tar.subarray(dataStart, dataEnd);

    if (type === 'x' || type === 'g') {
      const pathValue = parsePaxPath(content.toString('utf8'));
      if (pathValue) paxPath = pathValue;
    } else if (type === 'L') {
      longName = content.toString('utf8').replace(/\0.*$/, '').trim();
    } else if (type === '0' || type === '\0' || type === ' ') {
      const memberPath = (paxPath ?? longName ?? headerPath).replace(/^\.\//, '');
      const parts = memberPath.split('/').filter(Boolean);
      const fileName = parts.at(-1) ?? '';
      if (parts.length <= 2 && LICENSE_FILE_NAME.test(fileName) && size > 0 && size <= MAX_LICENSE_FILE_BYTES) {
        let text = content.toString('utf8');
        if (/^README(?:\.|$)/i.test(fileName)) text = extractReadmeLicenseSection(text);
        if (text) files.push({ name: memberPath, text });
      }
      longName = null;
      paxPath = null;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Return an SPDX identifier only when the text has a recognized, unambiguous license signature. */
function canonicalLicenseVersion(version) {
  return version && !version.includes('.') ? `${version}.0` : version;
}

export function classifyLicenseText(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const spdxHeader = /SPDX-License-Identifier\s*:\s*([^\r\n*]+)/i.exec(text);
  if (spdxHeader) return normalizeSpdxExpression(spdxHeader[1].trim());
  const normalized = text.replace(/\s+/g, ' ').trim();
  const upper = normalized.toUpperCase();
  if (upper.includes('SERVER SIDE PUBLIC LICENSE')) return 'SSPL-1.0';
  if (upper.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
    const version = /VERSION\s+(\d+(?:\.\d+)?)/i.exec(normalized)?.[1];
    return version ? `AGPL-${canonicalLicenseVersion(version)}-${/ANY LATER VERSION|OR LATER/i.test(normalized) ? 'or-later' : 'only'}` : null;
  }
  if (upper.includes('GNU LESSER GENERAL PUBLIC LICENSE')) {
    const version = /VERSION\s+(\d+(?:\.\d+)?)/i.exec(normalized)?.[1];
    return version ? `LGPL-${canonicalLicenseVersion(version)}-${/ANY LATER VERSION|OR LATER/i.test(normalized) ? 'or-later' : 'only'}` : null;
  }
  if (upper.includes('GNU GENERAL PUBLIC LICENSE')) {
    const version = /VERSION\s+(\d+(?:\.\d+)?)/i.exec(normalized)?.[1];
    return version ? `GPL-${canonicalLicenseVersion(version)}-${/ANY LATER VERSION|OR LATER/i.test(normalized) ? 'or-later' : 'only'}` : null;
  }
  if (upper.includes('APACHE LICENSE') && /VERSION\s+2\.0/.test(upper)) return 'Apache-2.0';
  if (upper.includes('PERMISSION IS HEREBY GRANTED, FREE OF CHARGE, TO ANY PERSON OBTAINING A COPY')) return 'MIT';
  if (upper.includes('REDISTRIBUTION AND USE IN SOURCE AND BINARY FORMS')) {
    return upper.includes('NEITHER THE NAME OF') || upper.includes('NEITHER THE NAMES OF') ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (upper.includes('PERMISSION TO USE, COPY, MODIFY, AND/OR DISTRIBUTE THIS SOFTWARE')) return 'ISC';
  if (upper.includes('MOZILLA PUBLIC LICENSE') && upper.includes('2.0')) return 'MPL-2.0';
  if (upper.includes('CREATIVE COMMONS LEGAL CODE') && upper.includes('CC0 1.0')) return 'CC0-1.0';
  if (upper.includes('UNENCUMBERED SOFTWARE') && upper.includes('UNLICENSE')) return 'Unlicense';
  if (upper.includes('THIS SOFTWARE IS PROVIDED AS-IS') && upper.includes('IN NO EVENT WILL THE AUTHORS BE HELD LIABLE')) return 'Zlib';
  return null;
}

function licenseExpressionFromFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  const identified = files.map((file) => ({ file, license: classifyLicenseText(file.text) }));
  if (identified.some((entry) => !entry.license)) return null;
  const unique = [...new Set(identified.map((entry) => entry.license))];
  if (unique.length === 1) return unique[0];
  const alternativeFiles = identified.every((entry) => /^(?:LICENSE|LICENCE)[-_ ](?:MIT|APACHE)(?:\.|$)/i.test(basename(entry.file.name)));
  return alternativeFiles ? normalizeSpdxExpression(unique.join(' OR ')) : null;
}

function normalizeDeclaredLicense(value) {
  const raw = rawLicenseText(value);
  const expression = normalizeSpdxExpression(raw);
  if (expression) return expression;
  if (/^apache(?: software license| license)?[, ]+version 2\.0$/i.test(raw)) return 'Apache-2.0';
  if (/^apache[- ]2\.0$/i.test(raw)) return 'Apache-2.0';
  if (/^mit license$/i.test(raw)) return 'MIT';
  if (/^bsd[- ]3[- ]clause$/i.test(raw)) return 'BSD-3-Clause';
  if (/^bsd[- ]2[- ]clause$/i.test(raw)) return 'BSD-2-Clause';
  if (/^mpl[- ]2\.0$/i.test(raw)) return 'MPL-2.0';
  return null;
}

function isApprovedHttpsUrl(value, hostname) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === hostname && parsed.port === '' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

async function fetchResource(fetchImpl, url, { headers = {}, maxBytes = MAX_LICENSE_ARCHIVE_BYTES } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': LICENSE_FETCH_USER_AGENT, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} from ${url}`);
        if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      const declaredLength = Number(response.headers?.get?.('content-length') ?? 0);
      if (declaredLength > maxBytes) throw new Error(`download from ${url} exceeds the configured size limit`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error(`download from ${url} exceeds the configured size limit`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`unable to download ${url}`);
}

async function fetchJson(fetchImpl, url, headers = {}) {
  const bytes = await fetchResource(fetchImpl, url, { headers, maxBytes: 4 * 1024 * 1024 });
  return JSON.parse(bytes.toString('utf8'));
}

function verifySri(buffer, integrity) {
  if (typeof integrity !== 'string' || !integrity.trim()) return false;
  for (const token of integrity.trim().split(/\s+/)) {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(token);
    if (!match) continue;
    const digest = createHash(match[1]).update(buffer).digest('base64');
    if (digest === match[2]) return true;
  }
  return false;
}

function pypiClassifierExpression(classifiers) {
  for (const classifier of classifiers ?? []) {
    if (!classifier.startsWith('License ::')) continue;
    const label = classifier.split(' :: ').at(-1)?.trim() ?? '';
    if (/^mit license$/i.test(label)) return 'MIT';
    if (/^apache software license$/i.test(label)) return 'Apache-2.0';
    if (/^bsd 3[- ]clause(?: license)?$/i.test(label)) return 'BSD-3-Clause';
    if (/^bsd 2[- ]clause(?: license)?$/i.test(label)) return 'BSD-2-Clause';
    if (/^mozilla public license 2\.0/i.test(label)) return 'MPL-2.0';
    const copyleft = /^(gnu )?(affero |lesser )?general public license(?: v| version )?(\d+(?:\.\d+)?)(.*)$/i.exec(label);
    if (copyleft) {
      const family = /affero/i.test(copyleft[2] ?? '') ? 'AGPL' : /lesser/i.test(copyleft[2] ?? '') ? 'LGPL' : 'GPL';
      const suffix = /or later|later version/i.test(copyleft[4]) ? 'or-later' : 'only';
      const expression = `${family}-${canonicalLicenseVersion(copyleft[3])}-${suffix}`;
      if (SPDX_LICENSE_IDS.has(expression)) return expression;
    }
  }
  return null;
}

export async function resolveLicenseMetadata(components, { root = REPO_ROOT, fetchImpl = globalThis.fetch, concurrency = 6 } = {}) {
  if (!Array.isArray(components)) throw new Error('license metadata resolution requires a component array');
  if (typeof fetchImpl !== 'function') throw new Error('license metadata resolution requires a fetch implementation');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('license metadata resolution concurrency must be a positive integer');
  const cache = new Map();
  const results = new Array(components.length);
  let next = 0;
  async function resolveOne(entry) {
    if (entry.license || entry.scope === 'excluded') return { ...entry };
    const cacheKey = `${entry.ecosystem}|${entry.name}|${entry.version}|${entry.integrity ?? ''}`;
    let task = cache.get(cacheKey);
    if (!task) {
      task = (async () => {
        try {
          let license = null;
          let source = null;
          if (entry.ecosystem === 'npm') {
            const lockKey = entry.sourcePath?.split('#')[1];
            const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
            const lockEntry = lock.packages?.[lockKey];
            const encodedName = encodeURIComponent(entry.name).replaceAll('%2F', '%2f');
            const metadata = await fetchJson(fetchImpl, `https://registry.npmjs.org/${encodedName}/${encodeURIComponent(entry.version)}`);
            const declared = normalizeDeclaredLicense(metadata.license ?? metadata.licenses);
            if (declared) {
              license = declared;
              source = `npm registry metadata ${entry.name}@${entry.version}`;
            } else if (metadata.dist?.tarball && lockEntry?.integrity) {
              if (!isApprovedHttpsUrl(metadata.dist.tarball, 'registry.npmjs.org')) {
                throw new Error(`npm registry returned an unapproved package archive host for ${entry.name}@${entry.version}`);
              }
              const archive = await fetchResource(fetchImpl, metadata.dist.tarball);
              if (!verifySri(archive, lockEntry.integrity)) throw new Error(`npm archive integrity mismatch for ${entry.name}@${entry.version}`);
              license = licenseExpressionFromFiles(readLicenseFilesFromTarGz(archive));
              if (license) source = `npm package archive verified by package-lock.json for ${entry.name}@${entry.version}`;
            }
          } else if (entry.ecosystem === 'pypi' && entry.pinned) {
            const normalizedName = entry.name.toLowerCase().replace(/[-_.]+/g, '-');
            const metadata = await fetchJson(fetchImpl, `https://pypi.org/pypi/${encodeURIComponent(normalizedName)}/${encodeURIComponent(entry.version)}/json`);
            const info = metadata.info ?? {};
            license = normalizeDeclaredLicense(info.license_expression ?? info.license)
              ?? pypiClassifierExpression(info.classifiers);
            if (license) {
              source = `PyPI metadata ${normalizedName}==${entry.version}`;
            } else {
              const sdist = metadata.urls?.find((candidate) => candidate.packagetype === 'sdist');
              if (sdist?.url && isApprovedHttpsUrl(sdist.url, 'files.pythonhosted.org') && /\.tar\.gz$/i.test(sdist.filename ?? '')) {
                const archive = await fetchResource(fetchImpl, sdist.url);
                const expected = sdist.digests?.sha256;
                const actual = createHash('sha256').update(archive).digest('hex');
                if (!/^[a-f0-9]{64}$/i.test(expected ?? '') || actual !== expected.toLowerCase()) throw new Error(`PyPI source archive digest mismatch for ${normalizedName}==${entry.version}`);
                license = licenseExpressionFromFiles(readLicenseFilesFromTarGz(archive));
                if (license) source = `PyPI source archive verified by its JSON digest for ${normalizedName}==${entry.version}`;
              }
            }
          } else if (entry.ecosystem === 'cargo' && entry.pinned) {
            const metadata = await fetchJson(
              fetchImpl,
              `https://crates.io/api/v1/crates/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
              { 'User-Agent': LICENSE_FETCH_USER_AGENT },
            );
            license = normalizeDeclaredLicense(metadata.version?.license);
            if (license) source = `crates.io version metadata ${entry.name}@${entry.version}`;
          } else if (entry.ecosystem === 'pub' && entry.pinned && entry.version !== '0.0.0') {
            const expected = entry.integrity;
            if (!/^[a-f0-9]{64}$/i.test(expected ?? '')) throw new Error(`pub.dev lock digest is missing for ${entry.name}@${entry.version}`);
            const archive = await fetchResource(fetchImpl, `https://pub.dev/api/archives/${encodeURIComponent(entry.name)}-${encodeURIComponent(entry.version)}.tar.gz`);
            const actual = createHash('sha256').update(archive).digest('hex');
            if (actual !== expected.toLowerCase()) throw new Error(`pub.dev archive digest mismatch for ${entry.name}@${entry.version}`);
            license = licenseExpressionFromFiles(readLicenseFilesFromTarGz(archive));
            if (license) source = `pub.dev archive SHA-256 verified by pubspec.lock for ${entry.name}@${entry.version}`;
          }
          return { license, licenseSource: source };
        } catch (error) {
          return { license: null, licenseSource: `UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}` };
        }
      })();
      cache.set(cacheKey, task);
    }
    const metadata = await task;
    if (!metadata.license) return { ...entry, licenseSource: metadata.licenseSource };
    return { ...entry, license: metadata.license, licenseName: null, licenseSource: metadata.licenseSource };
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, components.length)) }, async () => {
      while (next < components.length) {
        const index = next++;
        results[index] = await resolveOne(components[index]);
      }
    }),
  );
  const unresolved = results.filter((entry) => entry.scope !== 'excluded' && !entry.license);
  return { components: results, unresolved };
}

function parseArgs(argv) {
  const options = {
    out: null,
    outDir: null,
    format: 'spdx',
    created: null,
    requirePinned: false,
    resolveLicenseMetadata: false,
    check: null,
    json: false,
    quiet: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') options.out = argv[++index];
    else if (arg === '--out-dir') options.outDir = argv[++index];
    else if (arg === '--format') options.format = argv[++index];
    else if (arg === '--created') options.created = argv[++index];
    else if (arg === '--require-pinned') options.requirePinned = true;
    else if (arg === '--resolve-license-metadata') options.resolveLicenseMetadata = true;
    else if (arg === '--check') options.check = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['spdx', 'cyclonedx'].includes(options.format)) throw new Error(`Unsupported SBOM format: ${options.format}`);
  if (options.out && options.outDir) throw new Error('--out and --out-dir cannot be used together');
  if (options.outDir && options.format !== 'cyclonedx') throw new Error('--out-dir is supported only with --format cyclonedx');
  if (options.json && (options.out || options.outDir)) throw new Error('--json cannot be combined with --out or --out-dir');
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 36).join('\n'));
    return 0;
  }

  if (options.check) {
    const document = JSON.parse(readFileSync(options.check, 'utf8'));
    const cyclonedx = document?.bomFormat === 'CycloneDX';
    const failures = cyclonedx ? validateCycloneDxDocument(document) : validateSpdxDocument(document);
    if (failures.length > 0) {
      process.stderr.write(`SBOM ${options.check} failed validation:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
      return 1;
    }
    const count = cyclonedx ? document.components.length : document.packages.length;
    const format = cyclonedx ? `CycloneDX ${document.specVersion}` : 'SPDX-2.3';
    const unit = cyclonedx ? 'components' : 'packages';
    process.stdout.write(`SBOM ${options.check} is valid ${format} with ${count} ${unit}.\n`);
    return 0;
  }

  let components = collectComponents();
  let unresolvedLicenses = [];
  if (options.resolveLicenseMetadata) {
    const resolution = await resolveLicenseMetadata(components);
    components = resolution.components;
    unresolvedLicenses = resolution.unresolved;
  }

  const unpinned = components.filter((entry) => !entry.pinned);
  if (options.format === 'cyclonedx') {
    if (options.outDir) {
      mkdirSync(options.outDir, { recursive: true });
      const documents = buildCycloneDxDocuments({ components, created: options.created });
      const written = [];
      for (const [filename, document] of Object.entries(documents)) {
        const failures = validateCycloneDxDocument(document);
        if (failures.length > 0) {
          process.stderr.write(`Refusing to write invalid SBOM ${filename}:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
          return 1;
        }
        const outputPath = join(options.outDir, filename);
        writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
        written.push(outputPath);
      }
      if (!options.quiet) process.stdout.write(`Wrote ${written.length} CycloneDX 1.5 SBOMs to ${options.outDir}.\n`);
    } else {
      const document = buildCycloneDxDocument({ components, created: options.created });
      const failures = validateCycloneDxDocument(document);
      if (failures.length > 0) {
        process.stderr.write(`Refusing to write an invalid CycloneDX SBOM:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
        return 1;
      }
      const outputPath = options.out ?? 'whitelabel-sbom.cdx.json';
      if (options.json) process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      else writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
      if (!options.quiet && !options.json) process.stdout.write(`Wrote CycloneDX 1.5 SBOM to ${outputPath} (${document.components.length} components).\n`);
      if (!options.quiet && options.json) process.stderr.write(`Generated CycloneDX 1.5 SBOM with ${document.components.length} components.\n`);
    }
  } else {
    if (options.outDir) throw new Error('--out-dir is supported only with --format cyclonedx');
    const { document, components: sbomComponents, unpinned: unresolvedVersions } = buildSpdxDocument({
      created: options.created,
      components,
    });
    const failures = validateSpdxDocument(document);
    if (failures.length > 0) {
      process.stderr.write(`Refusing to write an invalid SPDX SBOM:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
      return 1;
    }
    const outputPath = options.out ?? 'whitelabel-sbom.spdx.json';
    if (options.json) process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    else writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);

    if (!options.quiet) {
      const byEcosystem = sbomComponents.reduce((accumulator, entry) => {
        accumulator[entry.ecosystem] = (accumulator[entry.ecosystem] ?? 0) + 1;
        return accumulator;
      }, {});
      process.stdout.write(
        `SBOM: ${sbomComponents.length} components (${Object.entries(byEcosystem)
          .map(([ecosystem, count]) => `${ecosystem} ${count}`)
          .join(', ')}), ${unresolvedVersions.length} declared without an exact version.\n` +
          (options.json ? '' : `Wrote ${outputPath}\n`),
      );
      for (const entry of unresolvedVersions.slice(0, 20)) {
        process.stdout.write(`  unpinned: ${entry.ecosystem} ${entry.name} - ${entry.comment ?? 'no reason recorded'}\n`);
      }
      if (unresolvedVersions.length > 20) process.stdout.write(`  ${unresolvedVersions.length - 20} more dependencies have no exact version.\n`);
    }
  }

  if (!options.quiet && unresolvedLicenses.length > 0) {
    process.stderr.write(`License metadata remains unresolved for ${unresolvedLicenses.length} shipped or optional components; the license gate will fail closed.\n`);
    for (const entry of unresolvedLicenses.slice(0, 25)) {
      process.stderr.write(`  unresolved license: ${entry.ecosystem} ${entry.name}@${entry.version} (${entry.sourcePath ?? 'source unknown'})\n`);
    }
  }
  if (options.requirePinned && unpinned.length > 0) {
    process.stderr.write(`${unpinned.length} components have no exact version; --require-pinned was requested.\n`);
    return 1;
  }
  return 0;
}

// `node scripts/generate-sbom.mjs --json | head` closes stdout early; an unhandled EPIPE would print a
// stack trace and exit non-zero, which reads as a broken generator rather than as a closed pipe.
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
  throw error;
});

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`SBOM generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
