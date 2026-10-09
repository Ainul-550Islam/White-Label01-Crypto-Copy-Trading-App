// # Responsibility: reject unresolved or GPL, AGPL, and SSPL licenses in shipped SBOM dependencies unless the exact package and license have a reviewed reason in docs/sale/LICENSE_ALLOWLIST.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CYCLONEDX_FILENAMES,
  normalizeSpdxExpression,
  validateCycloneDxDocument,
} from './generate-sbom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ALLOWLIST_HEADER = [
  'Package URL (PURL)',
  'SPDX license expression',
  'Reason',
  'Approved by',
  'Review date',
];
const FORBIDDEN_LICENSE = /^(?:GPL|AGPL|SSPL)-/;
const ECOSYSTEM_PROPERTY = 'wlct:ecosystem';
const SOURCE_MANIFEST_PROPERTY = 'wlct:source-manifest';
const LICENSE_SOURCE_PROPERTY = 'wlct:license-source';

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function validReviewDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function allowlistKey(purl, licenseExpression) {
  return `${purl}\n${licenseExpression}`;
}

/** Parse the reviewed Markdown table; malformed or incomplete exception rows are fatal. */
export function parseLicenseAllowlist(markdown) {
  if (typeof markdown !== 'string') throw new Error('license allowlist must be Markdown text');
  const lines = markdown.split(/\r?\n/);
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = tableCells(lines[index]);
    if (cells && cells.length === ALLOWLIST_HEADER.length && cells.every((cell, column) => cell === ALLOWLIST_HEADER[column])) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex === -1) throw new Error('license allowlist is missing the required five-column Markdown table');
  const separator = tableCells(lines[headerIndex + 1] ?? '');
  if (!separator || separator.length !== ALLOWLIST_HEADER.length || !isTableSeparator(separator)) {
    throw new Error('license allowlist table must have a valid Markdown separator row');
  }

  const entries = new Map();
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith('|')) break;
    const cells = tableCells(trimmed);
    if (!cells || cells.length !== ALLOWLIST_HEADER.length) {
      throw new Error(`license allowlist row ${index + 1} must contain exactly five cells`);
    }
    if (cells.every((cell) => cell === '')) continue;
    const [purl, rawExpression, reason, approvedBy, reviewDate] = cells;
    if (!/^pkg:(?:npm|pypi|cargo|pub)\/[^\s|]+@[^\s|]+$/.test(purl)) {
      throw new Error(`license allowlist row ${index + 1} has an invalid exact package URL`);
    }
    const expression = normalizeSpdxExpression(rawExpression);
    if (!expression || expression !== rawExpression) {
      throw new Error(`license allowlist row ${index + 1} must use a canonical SPDX license expression`);
    }
    if (!reason || reason.length < 20) {
      throw new Error(`license allowlist row ${index + 1} must give a specific reason of at least 20 characters`);
    }
    if (!approvedBy || approvedBy.length < 2) {
      throw new Error(`license allowlist row ${index + 1} must name the approver`);
    }
    if (!validReviewDate(reviewDate)) {
      throw new Error(`license allowlist row ${index + 1} must use a valid YYYY-MM-DD review date`);
    }
    const key = allowlistKey(purl, expression);
    if (entries.has(key)) throw new Error(`duplicate license allowlist entry for ${purl} (${expression})`);
    entries.set(key, { purl, licenseExpression: expression, reason, approvedBy, reviewDate });
  }
  return entries;
}

function propertyValue(component, propertyName) {
  const property = component?.properties?.find((entry) => entry.name === propertyName);
  return typeof property?.value === 'string' ? property.value : null;
}

function extractLicenseExpression(component) {
  if (!Array.isArray(component?.licenses) || component.licenses.length === 0) return null;
  const choices = [];
  for (const choice of component.licenses) {
    let value = null;
    if (typeof choice?.expression === 'string') value = normalizeSpdxExpression(choice.expression);
    else if (typeof choice?.license?.id === 'string') value = normalizeSpdxExpression(choice.license.id);
    else if (typeof choice?.license?.name === 'string') value = normalizeSpdxExpression(choice.license.name);
    if (!value) return null;
    choices.push(value);
  }
  const unique = [...new Set(choices)].sort();
  if (unique.length === 1) return unique[0];
  return normalizeSpdxExpression(unique.map((choice) => `(${choice})`).join(' OR '));
}

function licenseIdentifiers(expression) {
  return (expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? []).filter((token) => !['AND', 'OR', 'WITH'].includes(token));
}

function packageRecord(component, filename, expression) {
  const purl = component.purl;
  const purlVersion = /@([^@]+)$/.exec(purl)?.[1] ?? null;
  return {
    name: component.name,
    version: typeof component.version === 'string' ? component.version : purlVersion,
    purl,
    scope: component.scope,
    licenseExpression: expression,
    sourceManifest: propertyValue(component, SOURCE_MANIFEST_PROPERTY) ?? filename,
    licenseEvidence: propertyValue(component, LICENSE_SOURCE_PROPERTY) ?? 'UNRECORDED',
    ecosystem: propertyValue(component, ECOSYSTEM_PROPERTY),
    bomRef: component['bom-ref'],
  };
}

/** Validate and evaluate SBOM documents without fetching metadata or relaxing unknown licenses. */
export function assessLicenseDocuments(documents, allowlist = new Map()) {
  if (!(allowlist instanceof Map)) throw new Error('allowlist must be the Map returned by parseLicenseAllowlist');
  const findings = [];
  const findingKeys = new Set();
  const records = new Map();
  const matchedAllowlist = new Set();
  function addFinding(finding) {
    const key = `${finding.code}|${finding.purl ?? ''}|${finding.message}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(finding);
  }

  const timestamps = new Set(documents.map((item) => item.document?.metadata?.timestamp).filter((value) => typeof value === 'string'));
  if (timestamps.size > 1) {
    addFinding({ code: 'TIMESTAMP_MISMATCH', purl: null, message: 'CycloneDX SBOMs do not share one release creation timestamp' });
  }

  for (const item of documents) {
    const document = item.document;
    const filename = item.filename ?? 'CycloneDX document';
    for (const failure of validateCycloneDxDocument(document)) {
      addFinding({ code: 'INVALID_SBOM', purl: null, message: `${filename}: ${failure}` });
    }
    const expectedEcosystem = item.expectedEcosystem ?? null;
    for (const component of document?.components ?? []) {
      const purl = component.purl;
      const ecosystem = propertyValue(component, ECOSYSTEM_PROPERTY);
      const purlEcosystem = /^pkg:([^/]+)\//.exec(purl ?? '')?.[1] ?? null;
      if (ecosystem && purlEcosystem && purlEcosystem !== ecosystem) {
        addFinding({
          code: 'PURL_ECOSYSTEM_MISMATCH',
          purl: purl ?? null,
          message: `${filename}: ${component.name ?? 'component'} declares ecosystem ${ecosystem} but its package URL uses ${purlEcosystem}`,
        });
      }
      if (expectedEcosystem && ecosystem !== expectedEcosystem) {
        addFinding({
          code: 'ECOSYSTEM_MISMATCH',
          purl: purl ?? null,
          message: `${filename}: ${component.name ?? 'component'} declares ecosystem ${ecosystem ?? 'UNKNOWN'}, expected ${expectedEcosystem}`,
        });
      }
      if (!['required', 'optional', 'excluded'].includes(component.scope)) {
        addFinding({
          code: 'SCOPE_UNKNOWN',
          purl: purl ?? null,
          message: `${filename}: ${component.name ?? 'component'} has no recognized dependency scope`,
        });
        continue;
      }
      if (!purl) continue;

      const expression = extractLicenseExpression(component);
      const record = packageRecord(component, filename, expression);
      const existing = records.get(purl);
      if (!existing) {
        records.set(purl, {
          ...record,
          scopes: new Set(component.scope === 'excluded' ? [] : [component.scope]),
          excludedCount: component.scope === 'excluded' ? 1 : 0,
          filenames: new Set([filename]),
        });
      } else {
        existing.filenames.add(filename);
        if (component.scope === 'excluded') {
          existing.excludedCount += 1;
        } else {
          if (existing.scopes.size > 0 && existing.licenseExpression !== expression) {
            addFinding({
              code: 'LICENSE_CONFLICT',
              purl,
              message: `${purl} has inconsistent license expressions across shipped SBOM components`,
            });
          }
          if (existing.scopes.size === 0) {
            Object.assign(existing, record);
          }
          existing.scopes.add(component.scope);
        }
      }

      if (component.scope === 'excluded') continue;
      if (typeof component.version !== 'string' || component.version.trim() === '') {
        addFinding({
          code: 'VERSION_UNKNOWN',
          purl,
          message: `${purl} is shipped but has no exact version in the CycloneDX component`,
        });
      }
      if (!expression) {
        addFinding({
          code: 'LICENSE_UNKNOWN',
          purl,
          message: `${purl} is ${component.scope} but has no unambiguous SPDX license in the SBOM`,
        });
        continue;
      }

      const forbidden = [...new Set(licenseIdentifiers(expression).filter((identifier) => FORBIDDEN_LICENSE.test(identifier)))].sort();
      if (forbidden.length > 0) {
        const key = allowlistKey(purl, expression);
        if (!allowlist.has(key)) {
          addFinding({
            code: 'COPYLEFT_DENIED',
            purl,
            message: `${purl} declares ${expression}, including denied ${forbidden.join(', ')}; add an exact package, exact expression, and reason only after review`,
          });
        } else {
          matchedAllowlist.add(key);
        }
      }
    }
    if (expectedEcosystem && Array.isArray(document?.components) && !document.components.some((component) => component.scope !== 'excluded')) {
      addFinding({
        code: 'NO_SHIPPED_COMPONENTS',
        purl: null,
        message: `${filename} contains no required or optional shipped components for ${expectedEcosystem}`,
      });
    }
  }

  for (const [key, entry] of allowlist) {
    if (!matchedAllowlist.has(key)) {
      addFinding({
        code: 'ALLOWLIST_STALE',
        purl: entry.purl,
        message: `${entry.purl} (${entry.licenseExpression}) is allowlisted but is not a shipped copyleft component in the current SBOMs`,
      });
    }
  }

  const allRecords = [...records.values()];
  const components = allRecords
    .filter((record) => record.scopes.size > 0)
    .map((record) => ({ ...record, scope: [...record.scopes].sort().join(', ') }))
    .sort((left, right) => left.purl.localeCompare(right.purl));
  const excludedCount = allRecords.filter((record) => record.scopes.size === 0 && record.excludedCount > 0).length;
  const allowlistedCount = matchedAllowlist.size;
  return {
    findings,
    components,
    shippedCount: components.length,
    excludedCount,
    allowlistedCount,
    unresolvedCount: components.filter((record) => !record.licenseExpression).length,
  };
}

export function renderThirdPartyLicenseReport(documents, assessment) {
  const generatedAt = documents
    .map((item) => item.document?.metadata?.timestamp)
    .filter((value) => typeof value === 'string')
    .sort()[0] ?? 'UNKNOWN';
  const grouped = new Map();
  for (const component of assessment.components) {
    const expression = component.licenseExpression ?? 'UNRESOLVED';
    if (!grouped.has(expression)) grouped.set(expression, []);
    grouped.get(expression).push(component);
  }
  const lines = [
    '# Third-Party Licenses',
    '',
    'This inventory is generated from the committed CycloneDX 1.5 SBOMs in `docs/sbom/`. It covers required and optional shipped dependencies; development-only, SDK, and other excluded components are not treated as shipped dependencies by the release license gate.',
    '',
    `SBOM timestamp: ${generatedAt}`,
    '',
    '## Review summary',
    '',
    `- Shipped package versions reviewed: ${assessment.shippedCount}`,
    `- Excluded components omitted from this shipped-dependency inventory: ${assessment.excludedCount}`,
    `- Unresolved shipped license entries: ${assessment.unresolvedCount}`,
    `- Reviewed GPL, AGPL, or SSPL exceptions: ${assessment.allowlistedCount}`,
    '',
    '## Dependency inventory',
    '',
  ];

  for (const expression of [...grouped.keys()].sort((left, right) => left.localeCompare(right))) {
    lines.push(`### ${expression}`, '', '| Package | Version | Scope | Package URL | Source manifest | License evidence |', '| --- | --- | --- | --- | --- | --- |');
    for (const component of grouped.get(expression).sort((left, right) => left.purl.localeCompare(right.purl))) {
      const cells = [
        component.name,
        component.version ?? 'UNKNOWN',
        component.scope,
        component.purl,
        component.sourceManifest,
        component.licenseEvidence,
      ];
      lines.push(`| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push(
    '## License policy',
    '',
    'The release license gate fails closed when a required or optional component has unknown license metadata. GPL, AGPL, and SSPL expressions are denied unless the exact package URL and exact SPDX expression have a reviewed reason in `docs/sale/LICENSE_ALLOWLIST.md`. An allowlist entry is not legal advice or a substitute for counsel review.',
  );
  return `${lines.join('\n')}\n`;
}

export function loadCycloneDxDocuments(sbomDirectory) {
  const expected = Object.values(CYCLONEDX_FILENAMES).sort();
  const actual = readdirSync(sbomDirectory).filter((filename) => filename.endsWith('.cdx.json')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`CycloneDX SBOM set differs from the four required ecosystems: missing=${expected.filter((filename) => !actual.includes(filename)).join(',') || 'none'}; unexpected=${actual.filter((filename) => !expected.includes(filename)).join(',') || 'none'}`);
  }
  return Object.entries(CYCLONEDX_FILENAMES).map(([ecosystem, filename]) => {
    const path = join(sbomDirectory, filename);
    if (!existsSync(path)) throw new Error(`required ${ecosystem} SBOM is missing: ${path}`);
    const document = JSON.parse(readFileSync(path, 'utf8'));
    return { filename, expectedEcosystem: ecosystem, document };
  });
}

function parseArgs(argv) {
  const options = {
    sbomDirectory: 'docs/sbom',
    allowlistPath: 'docs/sale/LICENSE_ALLOWLIST.md',
    reportPath: 'docs/THIRD_PARTY_LICENSES.md',
    checkReport: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sbom-dir') options.sbomDirectory = argv[++index];
    else if (arg === '--allowlist') options.allowlistPath = argv[++index];
    else if (arg === '--report') options.reportPath = argv[++index];
    else if (arg === '--check-report') options.checkReport = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function runLicenseGate({
  root = REPO_ROOT,
  sbomDirectory = join(root, 'docs/sbom'),
  allowlistPath = join(root, 'docs/sale/LICENSE_ALLOWLIST.md'),
  reportPath = join(root, 'docs/THIRD_PARTY_LICENSES.md'),
  checkReport = false,
} = {}) {
  const documents = loadCycloneDxDocuments(sbomDirectory);
  const allowlist = parseLicenseAllowlist(readFileSync(allowlistPath, 'utf8'));
  const assessment = assessLicenseDocuments(documents, allowlist);
  const report = renderThirdPartyLicenseReport(documents, assessment);
  if (checkReport) {
    if (!existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== report) {
      assessment.findings.push({
        code: 'REPORT_STALE',
        purl: null,
        message: `${reportPath} does not match the supplied SBOMs; regenerate it with scripts/license-gate.mjs`,
      });
    }
  } else {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report, 'utf8');
  }
  return { ...assessment, report };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/license-gate.mjs [--sbom-dir docs/sbom] [--allowlist docs/sale/LICENSE_ALLOWLIST.md] [--report docs/THIRD_PARTY_LICENSES.md] [--check-report]\n',
    );
    return 0;
  }
  const root = REPO_ROOT;
  const result = runLicenseGate({
    root,
    sbomDirectory: resolve(root, options.sbomDirectory),
    allowlistPath: resolve(root, options.allowlistPath),
    reportPath: resolve(root, options.reportPath),
    checkReport: options.checkReport,
  });
  process.stdout.write(
    `License gate reviewed ${result.shippedCount} shipped package versions; ${result.excludedCount} excluded components are outside the gate; ${result.allowlistedCount} reviewed copyleft exceptions.\n`,
  );
  if (result.findings.length > 0) {
    process.stderr.write(
      `License gate failed with ${result.findings.length} finding(s):\n${result.findings.map((finding) => `  - ${finding.code}: ${finding.message}`).join('\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(`${options.checkReport ? 'Verified' : 'Wrote'} third-party license report ${options.reportPath}.\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`License gate failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
