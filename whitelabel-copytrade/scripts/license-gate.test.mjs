// # Responsibility: verify the release license gate fails closed on unknown and copyleft shipped packages, honors only exact reviewed exceptions, and writes a report from the CycloneDX BOMs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  CYCLONEDX_FILENAMES,
  buildCycloneDxDocument,
  buildCycloneDxDocuments,
} from './generate-sbom.mjs';
import {
  assessLicenseDocuments,
  parseLicenseAllowlist,
  renderThirdPartyLicenseReport,
} from './license-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const GATE_SCRIPT = join(REPO_ROOT, 'scripts', 'license-gate.mjs');
const ALLOWLIST_HEADER = [
  '# Third-party license allowlist',
  '',
  '| Package URL (PURL) | SPDX license expression | Reason | Approved by | Review date |',
  '| --- | --- | --- | --- | --- |',
];

function fixtureComponent({ ecosystem = 'npm', name = 'fixture-package', version = '1.0.0', license = 'MIT', scope = 'required' } = {}) {
  return {
    ecosystem,
    name,
    version,
    purl: `pkg:${ecosystem}/${name}@${version}`,
    license,
    licenseName: null,
    licenseSource: 'fixture registry metadata',
    checksum: null,
    comment: null,
    raw: null,
    scope,
    sourcePath: `${ecosystem}.lock`,
    integrity: null,
    pinned: true,
  };
}

function buildFixtureDocument(components) {
  return buildCycloneDxDocument({ components, created: '2026-10-08T00:00:00Z' });
}

function allowlistText(rows = []) {
  return `${[...ALLOWLIST_HEADER, ...rows].join('\n')}\n`;
}

test('the gate accepts permissive SPDX, rejects GPL-family licenses, and fails closed on unknowns', () => {
  const document = buildFixtureDocument([
    fixtureComponent({ name: 'permissive-library', license: 'MIT' }),
    fixtureComponent({ name: 'copyleft-library', license: 'GPL-3.0-only' }),
    fixtureComponent({ name: 'unknown-library', license: null }),
  ]);
  const result = assessLicenseDocuments([{ filename: 'fixture.cdx.json', document }]);
  assert.deepEqual(
    result.findings.map((finding) => finding.code).sort(),
    ['COPYLEFT_DENIED', 'LICENSE_UNKNOWN'],
  );
  assert.equal(result.shippedCount, 3);
  assert.equal(result.unresolvedCount, 1);
});

test('license gate rejects a package URL whose ecosystem conflicts with its component metadata', () => {
  const document = buildFixtureDocument([
    fixtureComponent({ ecosystem: 'npm', name: 'mislabelled-package', license: 'MIT' }),
  ]);
  document.components[0].purl = 'pkg:pub/mislabelled-package@1.0.0';
  const result = assessLicenseDocuments([
    { filename: 'npm-workspaces.cdx.json', expectedEcosystem: 'npm', document },
  ]);
  assert.ok(result.findings.some((finding) => finding.code === 'PURL_ECOSYSTEM_MISMATCH'));
});

test('an exact allowlist row requires a reason, approver, valid date, and matching SPDX expression', () => {
  const purl = 'pkg:cargo/copyleft-library@2.0.0';
  const document = buildFixtureDocument([
    fixtureComponent({ ecosystem: 'cargo', name: 'copyleft-library', version: '2.0.0', license: 'AGPL-3.0-or-later' }),
  ]);
  const approved = parseLicenseAllowlist(allowlistText([
    `| ${purl} | AGPL-3.0-or-later | Approved for isolated build tooling after counsel review; no linked distribution. | Product Security | 2026-10-08 |`,
  ]));
  const accepted = assessLicenseDocuments([{ filename: 'cargo.cdx.json', document }], approved);
  assert.deepEqual(accepted.findings, []);
  assert.equal(accepted.allowlistedCount, 1);

  assert.throws(
    () => parseLicenseAllowlist(allowlistText([
      `| ${purl} | AGPL-3.0-or-later | | Product Security | 2026-10-08 |`,
    ])),
    /specific reason/,
  );
  assert.throws(
    () => parseLicenseAllowlist(allowlistText([
      `| ${purl} | AGPL-3.0-or-later | Approved for isolated build tooling after counsel review; no linked distribution. | Product Security | 2026-02-30 |`,
    ])),
    /valid YYYY-MM-DD/,
  );
});

test('allowlist entries cannot waive unknown metadata or remain stale', () => {
  const unknownPurl = 'pkg:npm/unknown-library@1.0.0';
  const unknownDocument = buildFixtureDocument([
    fixtureComponent({ name: 'unknown-library', license: null }),
  ]);
  const invalidWaiver = parseLicenseAllowlist(allowlistText([
    `| ${unknownPurl} | MIT | This entry is not a copyleft exception and cannot establish the actual license. | Legal Review | 2026-10-08 |`,
  ]));
  const unknown = assessLicenseDocuments([{ filename: 'npm.cdx.json', document: unknownDocument }], invalidWaiver);
  assert.ok(unknown.findings.some((finding) => finding.code === 'LICENSE_UNKNOWN'));
  assert.ok(unknown.findings.some((finding) => finding.code === 'ALLOWLIST_STALE'));

  const nonCopyleft = buildFixtureDocument([
    fixtureComponent({ name: 'ordinary-library', license: 'MIT' }),
  ]);
  const stale = parseLicenseAllowlist(allowlistText([
    '| pkg:npm/removed-library@1.0.0 | GPL-2.0-only | Historical approval for a package that is no longer in the shipped graph. | Product Security | 2026-10-08 |',
  ]));
  assert.ok(
    assessLicenseDocuments([{ filename: 'npm.cdx.json', document: nonCopyleft }], stale).findings.some((finding) => finding.code === 'ALLOWLIST_STALE'),
  );
});

test('excluded development and SDK components do not become shipped-license findings', () => {
  const document = buildFixtureDocument([
    fixtureComponent({ ecosystem: 'pub', name: 'flutter_sdk', license: 'GPL-3.0-only', scope: 'excluded' }),
  ]);
  const result = assessLicenseDocuments([{ filename: 'flutter.cdx.json', document }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.shippedCount, 0);
  assert.equal(result.excludedCount, 1);
});

test('each required ecosystem SBOM must contain at least one shipped component', () => {
  const document = buildFixtureDocument([
    fixtureComponent({ ecosystem: 'pub', name: 'sdk-only', license: 'MIT', scope: 'excluded' }),
  ]);
  const result = assessLicenseDocuments([
    { filename: 'flutter-mobile.cdx.json', expectedEcosystem: 'pub', document },
  ]);
  assert.ok(result.findings.some((finding) => finding.code === 'NO_SHIPPED_COMPONENTS'));
});

test('license inventory content is deterministic and derived from the SBOM components', () => {
  const document = buildFixtureDocument([
    fixtureComponent({ name: 'mit-library', license: 'MIT' }),
    fixtureComponent({ name: 'apache-library', license: 'Apache-2.0' }),
  ]);
  const documents = [{ filename: 'fixture.cdx.json', document }];
  const result = assessLicenseDocuments(documents);
  const first = renderThirdPartyLicenseReport(documents, result);
  const second = renderThirdPartyLicenseReport(documents, result);
  assert.equal(first, second);
  assert.ok(first.endsWith('\n'));
  assert.equal(first.endsWith('\n\n'), false);
  assert.match(first, /### Apache-2\.0/);
  assert.match(first, /### MIT/);
  assert.match(first, /mit-library/);
  assert.match(first, /Shipped package versions reviewed: 2/);
});

test('CLI reads all four SBOMs, writes the report, and verifies it in check mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'license-gate-test-'));
  const sbomDirectory = join(root, 'docs', 'sbom');
  const allowlistPath = join(root, 'docs', 'sale', 'LICENSE_ALLOWLIST.md');
  const reportPath = join(root, 'docs', 'THIRD_PARTY_LICENSES.md');
  const components = [
    fixtureComponent({ ecosystem: 'npm', name: 'npm-fixture', license: 'MIT' }),
    fixtureComponent({ ecosystem: 'pypi', name: 'python-fixture', license: 'BSD-3-Clause' }),
    fixtureComponent({ ecosystem: 'cargo', name: 'rust-fixture', license: 'Apache-2.0' }),
    fixtureComponent({ ecosystem: 'pub', name: 'flutter-fixture', license: 'ISC' }),
  ];
  try {
    mkdirSync(sbomDirectory, { recursive: true });
    mkdirSync(dirname(allowlistPath), { recursive: true });
    writeFileSync(allowlistPath, allowlistText());
    const documents = buildCycloneDxDocuments({ components, created: '2026-10-08T00:00:00Z' });
    for (const [filename, document] of Object.entries(documents)) {
      writeFileSync(join(sbomDirectory, filename), `${JSON.stringify(document, null, 2)}\n`);
      assert.ok(Object.values(CYCLONEDX_FILENAMES).includes(filename));
    }

    const args = [
      GATE_SCRIPT,
      '--sbom-dir', sbomDirectory,
      '--allowlist', allowlistPath,
      '--report', reportPath,
    ];
    const output = execFileSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.match(output, /License gate reviewed 4 shipped package versions/);
    assert.ok(readFileSync(reportPath, 'utf8').includes('npm-fixture'));

    const checked = execFileSync(process.execPath, [...args, '--check-report'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.match(checked, /Verified third-party license report/);

    writeFileSync(reportPath, `${readFileSync(reportPath, 'utf8')}\nStale change.\n`);
    const stale = spawnSync(process.execPath, [...args, '--check-report'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /REPORT_STALE/);

    writeFileSync(join(sbomDirectory, 'unexpected.cdx.json'), '{}');
    const unexpected = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(unexpected.status, 1);
    assert.match(unexpected.stderr, /SBOM set differs from the four required ecosystems/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
