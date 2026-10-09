// # NEW — Jest/Node test wrapper for the 50-gap parity scanner, including the shim and unwired-module analysers the round-5 audit asked for
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GAP_CHECKS,
  isUnwiredImplementation,
  looksLikeReExportShim,
  runGapParityScan,
} = require('./gap-parity-scanner');

function runParityScannerTest() {
  const report = runGapParityScan();
  assert.strictEqual(report.total, 50, 'Expected 50 total gap checks');
  assert.strictEqual(
    report.passed,
    50,
    `Expected 50/50 gaps to pass, failed: ${report.results
      .filter((r) => !r.ok)
      .map((r) => `${r.id} (${r.missingFiles.concat(r.shimFiles ?? [], r.unwiredFiles ?? []).join(', ')})`)
      .join('; ')}`,
  );
  assert.strictEqual(report.ok, true);
  console.log('PASS ops/gap-parity-scanner.test.js (50/50 gaps verified)');
}

/**
 * Why the analysers have their own tests.
 *
 * The scanner's first three rules - file exists, file is non-empty, file contains none of three
 * placeholder strings - are what F3 described: they cannot tell a wired implementation from a
 * re-export shim with a dataclass bolted on, which is why F4's four Python modules and the
 * TypeScript files beside them passed for two rounds. The two rules added here are the ones that
 * catch that class, so they are pinned individually: each positive case is a shape found in this
 * repository, and each negative case is a shape that must NOT be flagged (a barrel, a file that
 * declares something, a service that is genuinely imported).
 */
function runAnalyserTests() {
  const cases = [];

  const check = (name, fn) => {
    try {
      fn();
      cases.push({ name, ok: true });
    } catch (error) {
      cases.push({ name, ok: false, error });
    }
  };

  check('a TypeScript re-export shim is detected (the OMS shape)', () => {
    const text = [
      '// # Bridges OMS order intents to execution service',
      "import { OrderRoutingService } from './order-routing.service';",
      'export {',
      '  OrderRoutingService,',
      '  OrderRoutingService as ExecutionHandoffService,',
      '};',
      'export default OrderRoutingService;',
    ].join('\n');
    assert.strictEqual(looksLikeReExportShim('apps/api/src/modules/oms/execution-handoff.service.ts', text), true);
  });

  check('a Python re-export shim is detected (the F4 shape)', () => {
    const text = [
      '# Validates and executes order placement against venue adapter',
      '"""Orders placement module re-exporting canonical placement review and execution wiring."""',
      'from __future__ import annotations',
      'from dataclasses import dataclass',
      'from app.orders_canonical import (',
      '    PlacementWiring,',
      '    build_placement_reviewer,',
      ')',
      '__all__ = ["PlacementWiring", "build_placement_reviewer"]',
    ].join('\n');
    assert.strictEqual(looksLikeReExportShim('services/execution-engine/app/orders/placement.py', text), true);
  });

  check('a barrel index is not a shim', () => {
    const text = "export * from './thing';\nexport { other } from './other';\n";
    assert.strictEqual(looksLikeReExportShim('apps/api/src/modules/providers/index.ts', text), false);
  });

  check('a file that declares something is not a shim', () => {
    const text = [
      "import { OrderRoutingService } from './order-routing.service';",
      'export { OrderRoutingService };',
      'export function resolveExecutionDispatchTarget(params: { liveTradingEnabled: boolean }): string {',
      "  return params.liveTradingEnabled ? 'LIVE_ENGINE' : 'PAPER_SIMULATOR';",
      '}',
    ].join('\n');
    assert.strictEqual(looksLikeReExportShim('apps/api/src/modules/oms/execution-handoff.service.ts', text), false);
  });

  check('a spec is never considered a shim', () => {
    const text = "import x from './x';\nexport {};\n";
    assert.strictEqual(looksLikeReExportShim('apps/api/src/modules/oms/thing.spec.ts', text), false);
  });

  check('an implementation unit nobody imports is reported as unwired', () => {
    const specifiers = new Set(['order.service', 'order']);
    assert.strictEqual(
      isUnwiredImplementation('apps/api/src/modules/oms/fill-processing.service.ts', specifiers),
      true,
    );
  });

  check('an implementation unit with an importer is not reported', () => {
    const specifiers = new Set(['fill-processing.service']);
    assert.strictEqual(
      isUnwiredImplementation('apps/api/src/modules/oms/fill-processing.service.ts', specifiers),
      false,
    );
  });

  check('an implementation unit imported by its bare stem is not reported', () => {
    const specifiers = new Set(['fill-processing']);
    assert.strictEqual(
      isUnwiredImplementation('apps/api/src/modules/oms/fill-processing.service.ts', specifiers),
      false,
    );
  });

  check('non-implementation files are never checked for wiring', () => {
    const specifiers = new Set();
    assert.strictEqual(isUnwiredImplementation('apps/web/src/app/page.tsx', specifiers), false);
    assert.strictEqual(isUnwiredImplementation('apps/api/src/modules/oms/oms.module.ts', specifiers), false);
    assert.strictEqual(isUnwiredImplementation('apps/api/src/modules/oms/oms.types.ts', specifiers), false);
  });

  check('the scanner flags a planted shim and unwired service in a temporary tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-parity-'));
    try {
      const moduleDir = path.join(root, 'apps', 'api', 'src', 'modules', 'demo');
      fs.mkdirSync(moduleDir, { recursive: true });
      fs.writeFileSync(
        path.join(moduleDir, 'demo.service.ts'),
        '// # Demo\nimport { RealService } from \'./real.service\';\nexport { RealService as DemoService };\n',
      );
      fs.writeFileSync(
        path.join(moduleDir, 'orphan.service.ts'),
        '// # Orphan\nexport class OrphanService {\n  run(): string {\n    return \'ok\';\n  }\n}\n',
      );

      // A one-gap check list over the temporary tree, using the same code path the real scan uses.
      const rel = 'apps/api/src/modules/demo/demo.service.ts';
      const relOrphan = 'apps/api/src/modules/demo/orphan.service.ts';
      const original = GAP_CHECKS.splice(0, GAP_CHECKS.length, {
        id: 'GAP-TEST',
        title: 'Plant',
        files: [rel, relOrphan],
      });
      const report = runGapParityScan(root);
      GAP_CHECKS.push(...original);

      assert.strictEqual(report.ok, false, 'the planted gap must not pass');
      assert.deepStrictEqual(report.results[0].shimFiles, [rel]);
      // The shim is unwired too, and reporting only one of the two would hide half the defect.
      assert.deepStrictEqual(
        report.results[0].unwiredFiles.sort(),
        [rel, relOrphan].sort(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const item of cases) {
    if (item.ok) {
      console.log(`PASS  ${item.name}`);
    } else {
      console.error(`FAIL  ${item.name}\n      ${item.error && item.error.message}`);
    }
  }
  const failed = cases.filter((item) => !item.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} analyser test(s) failed`);
  }
}

if (typeof describe === 'function' && typeof test === 'function') {
  describe('50-Gap Parity Scanner (GAP-50)', () => {
    test('verifies all 50 gaps (GAP-01..GAP-50) are implemented without placeholders', () => {
      runParityScannerTest();
    });

    test('detects re-export shims and unwired implementation units', () => {
      runAnalyserTests();
    });
  });
} else if (require.main === module) {
  runParityScannerTest();
  runAnalyserTests();
}

module.exports = { runParityScannerTest, runAnalyserTests };
