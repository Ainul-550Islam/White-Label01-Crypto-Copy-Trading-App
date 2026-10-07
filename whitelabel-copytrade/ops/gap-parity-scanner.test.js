// # NEW — Jest/Node test wrapper for the 50-gap parity scanner
'use strict';

const assert = require('assert');
const { runGapParityScan } = require('./gap-parity-scanner');

function runParityScannerTest() {
  const report = runGapParityScan();
  assert.strictEqual(report.total, 50, 'Expected 50 total gap checks');
  assert.strictEqual(
    report.passed,
    50,
    `Expected 50/50 gaps to pass, failed: ${report.results
      .filter((r) => !r.ok)
      .map((r) => `${r.id} (${r.missingFiles.join(', ')})`)
      .join('; ')}`,
  );
  assert.strictEqual(report.ok, true);
  console.log('PASS ops/gap-parity-scanner.test.js (50/50 gaps verified)');
}

if (typeof describe === 'function' && typeof test === 'function') {
  describe('50-Gap Parity Scanner (GAP-50)', () => {
    test('verifies all 50 gaps (GAP-01..GAP-50) are implemented without placeholders', () => {
      runParityScannerTest();
    });
  });
} else if (require.main === module) {
  runParityScannerTest();
}

module.exports = { runParityScannerTest };
