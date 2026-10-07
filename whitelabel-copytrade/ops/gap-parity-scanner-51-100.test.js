// # Responsibility: proves the GAP-51–GAP-100 parity scanner derives evidence from source and assertions instead of trusting names or fixed PASS values.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GAP_CHECKS,
  calculateProductionCriticalEvidencePct,
  calculateWeightedCommercialParity,
  evaluateGap,
  evaluateProbe,
  runGapParityScan,
  validateManifest,
} = require('./gap-parity-scanner-51-100');

function withTempRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-parity-51-100-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, 'utf8');
}

function minimalGap(criteria) {
  return {
    id: 'GAP-51',
    title: 'Scanner fixture behavior',
    commercialWeight: 5,
    criteria,
  };
}

assert.equal(validateManifest(GAP_CHECKS), true, 'the production manifest must define exactly one evidence rubric for every gap');
assert.equal(GAP_CHECKS.length, 50);
assert.deepEqual(GAP_CHECKS.map((gap) => gap.id).sort(), Array.from({ length: 50 }, (_, index) => `GAP-${index + 51}`).sort());
assert.ok(GAP_CHECKS.every((gap) => !Object.prototype.hasOwnProperty.call(gap, 'status')), 'the manifest must not store hard-coded statuses');
assert.ok(GAP_CHECKS.every((gap) => gap.criteria.length >= 3), 'each gap must require multiple independent evidence criteria');

withTempRoot((root) => {
  write(root, 'apps/api/service.ts', 'export class PresentButEmptyFeature { value = true; }');
  const result = evaluateGap(minimalGap([
    { key: 'real-domain-method', evidence: [{ file: 'apps/api/service.ts', patterns: ['class\\s+RealFeatureService', 'async\\s+evaluate'] }] },
    { key: 'assertive-test', evidence: [{ file: 'apps/api/service.spec.ts', patterns: ['\\b(?:test|it)\\s*\\(', '\\bexpect\\s*\\(', 'persisted'] }] },
  ]), root);
  assert.equal(result.status, 'FAIL', 'a present source filename without required behavior and tests must not pass');
  assert.equal(result.satisfiedCriteria, 0);
  assert.equal(result.testExecutionVerified, false);
});

withTempRoot((root) => {
  write(root, 'src/service.ts', 'export class RealFeatureService { async evaluate() { return { persisted: true }; } }');
  write(root, 'src/service.spec.ts', "describe('persisted behavior', () => { it('persists the result', async () => { await expect(service.evaluate()).resolves.toEqual({ persisted: true }); }); });");
  const result = evaluateGap(minimalGap([
    { key: 'domain', evidence: [{ file: 'src/service.ts', patterns: ['class\\s+RealFeatureService', 'async\\s+evaluate', 'persisted'] }] },
    { key: 'test', evidence: [{ file: 'src/service.spec.ts', patterns: ['\\b(?:test|it)\\s*\\(', '\\bexpect\\s*\\(', 'persisted'] }] },
  ]), root);
  assert.equal(result.status, 'EXISTING_VERIFIED');
  assert.equal(result.satisfiedCriteria, 2);
  assert.equal(result.totalCriteria, 2);
  assert.equal(result.testExecutionVerified, false, 'static assertion presence is not represented as an executed test');
});

withTempRoot((root) => {
  write(root, 'src/service.spec.ts', "describe('persisted behavior', () => { it('mentions persisted', () => { const value = 'persisted'; }); });");
  const result = evaluateProbe(root, {
    file: 'src/service.spec.ts',
    patterns: ['\\b(?:test|it)\\s*\\(', '\\bexpect\\s*\\(', 'persisted'],
  });
  assert.equal(result.matched, false, 'test names without an assertion are not test evidence');
  assert.ok(result.missingPatterns.includes('\\bexpect\\s*\\('));
});

withTempRoot((root) => {
  write(root, 'src/service.ts', 'export class RealFeatureService { async evaluate() { return true; } }');
  const probeResult = evaluateProbe(root, { file: '../outside.ts', patterns: ['class'] });
  assert.equal(probeResult.matched, false, 'evidence paths must not escape the scan root');
  assert.match(probeResult.reason, /escapes repository root/);
});

withTempRoot((root) => {
  write(root, 'src/service.ts', `export class RealFeatureService { async evaluate() { return true; } } ${['Rest of the code', 'here'].join(' ')}`);
  const result = evaluateProbe(root, { file: 'src/service.ts', patterns: ['RealFeatureService'] });
  assert.equal(result.matched, false, 'known omission placeholders invalidate otherwise matching source');
  assert.match(result.reason, /forbidden placeholder/);
});

assert.throws(
  () => validateManifest(GAP_CHECKS.slice(0, 49)),
  /exactly 50/,
  'missing gap rubrics must be rejected',
);
assert.throws(
  () => validateManifest([...GAP_CHECKS.slice(0, 49), { ...GAP_CHECKS[0], id: 'GAP-99' }]),
  /GAP-51 exactly once|GAP-99 exactly once|GAP-100 exactly once/,
  'duplicate or missing identifiers must be rejected',
);
assert.throws(
  () => validateManifest([{ ...minimalGap([{ key: 'x', evidence: [] }]), commercialWeight: 0 }, ...GAP_CHECKS.slice(1)]),
  /commercialWeight/,
  'invalid weighting must be rejected',
);

withTempRoot((root) => {
  write(root, 'src/api.ts', 'export class ApiFeature { evaluate() { return true; } }');
  const result = evaluateGap(minimalGap([
    {
      key: 'api-and-ui-required-together',
      mode: 'all',
      evidence: [
        { file: 'src/api.ts', patterns: ['ApiFeature', 'evaluate'] },
        { file: 'src/ui.tsx', patterns: ['FeaturePage', 'button'] },
      ],
    },
  ]), root);
  assert.equal(result.status, 'FAIL', 'a multi-layer criterion in all mode must require every layer');
  assert.equal(result.criteria[0].mode, 'all');
});

const weighted = calculateWeightedCommercialParity([
  { commercialWeight: 5, evidenceCoverage: 1 },
  { commercialWeight: 1, evidenceCoverage: 0 },
]);
assert.equal(weighted, 83.33, 'weighted evidence score must use declared weights and observed criteria');
assert.equal(calculateProductionCriticalEvidencePct([
  { id: 'GAP-55', evidenceCoverage: 1 },
  { id: 'GAP-57', evidenceCoverage: 0.5 },
  { id: 'GAP-51', evidenceCoverage: 0 },
]), 75, 'production evidence is averaged only over the declared production-critical set');

const repositoryScan = runGapParityScan();
assert.equal(repositoryScan.total, 50);
assert.equal(repositoryScan.results.length, 50);
assert.equal(repositoryScan.staticEvidenceOnly, true);
assert.equal(repositoryScan.testExecutionVerifiedByScanner, false);
assert.ok(repositoryScan.weightedCommercialParityPct >= 0 && repositoryScan.weightedCommercialParityPct <= 100);
assert.ok(repositoryScan.productionCriticalEvidencePct >= 0 && repositoryScan.productionCriticalEvidencePct <= 100);
assert.ok(repositoryScan.cumulativeProductCompletenessPct >= 50 && repositoryScan.cumulativeProductCompletenessPct <= 100);
assert.ok(repositoryScan.cumulativeProductionReadinessPct >= 50 && repositoryScan.cumulativeProductionReadinessPct <= 100);
assert.ok(repositoryScan.cumulativeCommercialReadinessPct >= 50 && repositoryScan.cumulativeCommercialReadinessPct <= 100);
assert.ok(repositoryScan.results.some((gap) => gap.status === 'PARTIAL' || gap.status === 'FAIL'), 'the current repository contains acknowledged unresolved gaps; the scanner must not fabricate batch completion');
assert.ok(repositoryScan.results.some((gap) => gap.criteria.some((item) => !item.satisfied)), 'at least one unresolved evidence criterion must remain visible');

console.log(`PASS ops/gap-parity-scanner-51-100.test.js (${repositoryScan.total} gaps scanned; ${repositoryScan.evidenceCriteriaSatisfied}/${repositoryScan.evidenceCriteriaTotal} static evidence criteria present; weighted score ${repositoryScan.weightedCommercialParityPct}%)`);
