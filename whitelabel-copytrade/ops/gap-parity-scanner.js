#!/usr/bin/env node
// # NEW — Scans repository to verify all 50 gaps (files, routes, tests, contracts, safety gates) remain closed
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const GAP_CHECKS = [
  { id: 'GAP-01', title: 'Trader Performance History & Equity/Drawdown Chart', files: ['apps/web/src/app/traders/[id]/performance/page.tsx', 'apps/web/src/features/trading/trader-performance-page.tsx', 'apps/web/src/features/trading/trader-performance-chart.tsx', 'apps/web/src/tests/trader-performance-page.test.tsx'] },
  { id: 'GAP-02', title: 'Side-by-Side Trader Comparison Matrix', files: ['apps/web/src/app/traders/compare/page.tsx', 'apps/web/src/features/trading/trader-comparison-page.tsx', 'apps/web/src/tests/trader-comparison-page.test.tsx'] },
  { id: 'GAP-03', title: 'Trader Verification Badges & Metric Definitions', files: ['apps/web/src/features/trading/trader-metric-definitions.ts', 'apps/web/src/features/trading/traders-page.tsx', 'apps/web/src/features/trading/trader-detail-page.tsx', 'apps/web/src/features/trading/leaderboard-page.tsx', 'apps/web/src/tests/traders-page.test.tsx'] },
  { id: 'GAP-04', title: 'Strategy Marketplace Filters & Sorting', files: ['apps/web/src/features/trading/strategies-page.tsx', 'apps/web/src/api/trading-api.ts'] },
  { id: 'GAP-05', title: 'Strategy Detail Backtest & Risk Disclosure View', files: ['apps/web/src/features/trading/strategy-detail-page.tsx', 'apps/web/src/tests/strategy-detail-page.test.tsx'] },
  { id: 'GAP-06', title: 'Follow Trader & Copy Allocation Setup Wizard', files: ['apps/web/src/features/trading/copy-settings-page.tsx', 'apps/web/src/tests/copy-settings-page.test.tsx'] },
  { id: 'GAP-07', title: 'Copy Allocation Sizing Modes', files: ['apps/api/src/modules/copy-trading/copy-order-mapper.service.ts', 'apps/api/src/modules/copy-trading/copy-trading.types.ts', 'apps/api/src/modules/copy-trading/copy-trading.spec.ts'] },
  { id: 'GAP-08', title: 'Copy Subscription Lifecycle Controls', files: ['apps/api/src/modules/copy-trading/follower-subscription.service.ts', 'apps/api/src/modules/copy-trading/copy-trading.controller.ts', 'apps/web/src/features/trading/copy-subscription-detail-page.tsx', 'apps/web/src/tests/copy-subscription-detail-page.test.tsx'] },
  { id: 'GAP-09', title: 'Stop-Copying Position Close Policy', files: ['apps/web/src/features/trading/copy-subscription-detail-page.tsx', 'apps/web/src/api/trading-api.ts', 'apps/web/src/tests/copy-stop-policy.test.ts'] },
  { id: 'GAP-10', title: 'Copied Positions Dedicated View & Manual Close', files: ['apps/web/src/app/copy-trading/positions/page.tsx', 'apps/web/src/features/trading/copied-positions-page.tsx', 'apps/web/src/tests/copied-positions-page.test.tsx'] },
  { id: 'GAP-11', title: 'Copied Orders History & Filter View', files: ['apps/web/src/app/copy-trading/orders/page.tsx', 'apps/web/src/features/trading/copied-orders-page.tsx', 'apps/web/src/tests/copied-orders-page.test.tsx'] },
  { id: 'GAP-12', title: 'Copy Execution Audit Log & Slippage/Fee Breakdown', files: ['apps/web/src/features/trading/copy-execution-detail.tsx', 'apps/web/src/tests/copy-execution-detail.test.tsx'] },
  { id: 'GAP-13', title: 'Follower Risk Guardrails UI', files: ['apps/web/src/features/trading/copy-risk-guardrails.tsx', 'apps/web/src/tests/copy-risk-guardrails.test.tsx'] },
  { id: 'GAP-14', title: 'Copy Reconciliation Status & Mismatch Banner', files: ['apps/web/src/features/trading/copy-reconciliation-status.tsx', 'apps/web/src/tests/copy-reconciliation-status.test.tsx'] },
  { id: 'GAP-15', title: 'Leader Signal Ingestion & Idempotent Fanout', files: ['apps/api/src/modules/copy-trading/leader-event-ingestion.service.ts', 'apps/api/src/modules/copy-trading/copy-execution.service.ts', 'apps/api/src/modules/copy-trading/copy-trading.contract.spec.ts'] },
  { id: 'GAP-16', title: 'Follower Pre-Trade Risk & Drawdown Enforcement', files: ['apps/api/src/modules/copy-trading/follower-risk.service.ts', 'apps/api/src/modules/copy-trading/copy-policy.service.ts', 'apps/api/src/modules/copy-trading/copy-trading-safety.spec.ts'] },
  { id: 'GAP-17', title: 'Real-Time Copy Execution WebSocket Push', files: ['apps/api/src/modules/copy-trading/copy-execution.service.ts', 'apps/web/src/api/realtime-api.ts', 'apps/web/src/features/trading/use-copy-execution-events.ts', 'apps/web/src/tests/use-copy-execution-events.test.ts'] },
  { id: 'GAP-18', title: 'OMS Order Intent to Execution Engine Dispatch', files: ['apps/api/src/modules/oms/order-routing.service.ts', 'apps/api/src/modules/oms/order-submission.payload.ts', 'apps/api/src/modules/oms/order-submission.spec.ts'] },
  { id: 'GAP-19', title: 'OMS Fill Ingestion, Partial Fill Accounting & Fee Attribution', files: ['apps/api/src/modules/oms/fill-management.service.ts', 'apps/api/src/modules/oms/trade-lifecycle.service.ts', 'apps/api/src/modules/oms/order-reconciliation.service.ts', 'apps/api/src/modules/oms/fill-reconciliation.service.ts', 'apps/api/src/modules/oms/position-reconciliation.service.ts'] },
  { id: 'GAP-20', title: 'Customer Web Trading API Client Full Endpoint Parity', files: ['apps/web/src/api/trading-api.ts', 'apps/web/src/tests/trading-api.test.ts'] },
  { id: 'GAP-21', title: 'Exchange Venue Capability Matrix', files: ['apps/api/src/modules/exchanges/exchange.types.ts', 'apps/api/src/modules/exchanges/exchange-provider.interface.ts', 'apps/web/src/features/exchanges/exchange-capabilities.tsx', 'apps/web/src/app/exchanges/[id]/page.tsx', 'apps/web/src/tests/exchange-capabilities.test.tsx'] },
  { id: 'GAP-22', title: 'Live Exchange Adapter Parity across 5 Venues', files: ['apps/api/src/modules/exchanges/base-exchange-provider.ts', 'apps/api/src/modules/exchanges/providers/bybit.provider.ts', 'apps/api/src/modules/exchanges/providers/okx.provider.ts', 'apps/api/src/modules/exchanges/providers/kraken.provider.ts', 'apps/api/src/modules/exchanges/providers/coinbase.provider.ts', 'apps/api/src/modules/exchanges/exchange-provider.factory.ts', 'apps/api/src/modules/exchanges/venue-providers.spec.ts'] },
  { id: 'GAP-23', title: 'Execution Gateway Service between NestJS API and Python Execution Engine', files: ['apps/api/src/modules/execution/execution-orders.service.ts', 'apps/api/src/modules/execution/execution-commands.service.ts', 'apps/api/src/modules/execution/execution.module.ts', 'services/execution-engine/app/orders/placement.py', 'services/execution-engine/app/orders/submission.py', 'services/execution-engine/tests/test_execution_engine.py'] },
  { id: 'GAP-24', title: 'Pre-Trade Balance, Margin, Min-Notional & Step-Size Validation', files: ['apps/api/src/modules/risk/risk.service.ts', 'apps/api/src/modules/orders/order-intent.service.ts', 'apps/api/src/modules/oms/order-intent.service.ts'] },
  { id: 'GAP-25', title: 'Unified Kill-Switch Enforcement Across Manual & Copy Paths', files: ['apps/api/src/modules/execution/execution-safety.service.ts', 'apps/api/src/modules/maintenance/maintenance-trading-gate.spec.ts', 'apps/api/src/modules/execution/execution-safety.spec.ts'] },
  { id: 'GAP-26', title: 'Admin Kill-Switch & Execution Incident Console Wiring', files: ['apps/admin-web/src/app/(console)/risk/page.tsx', 'apps/admin-web/src/modules/risk/kill-switch-controls.tsx', 'apps/admin-web/src/app/(console)/execution-incidents/page.tsx', 'apps/admin-web/src/features/execution/execution-incident-table.tsx', 'apps/api/src/modules/execution/execution-admin.controller.ts', 'apps/api/src/modules/execution/execution-incidents.service.ts', 'apps/admin-web/src/tests/execution-incidents-page.test.tsx'] },
  { id: 'GAP-27', title: 'Funding Deposit Address Generation & Confirmation Tracking', files: ['apps/api/src/modules/funding/funding-request.service.ts', 'apps/api/src/modules/custody/deposit-address.service.ts', 'apps/api/src/modules/custody/deposit-monitoring.service.ts', 'apps/api/src/modules/providers/provider-webhook.service.ts', 'apps/api/src/modules/providers/adapters/payment.adapter.ts', 'apps/api/src/modules/funding/funding-amount-validation.spec.ts'] },
  { id: 'GAP-28', title: 'Withdrawal Multi-Gate Approval, Velocity Limits & Hold Windows', files: ['apps/api/src/modules/custody/withdrawal-orchestration.service.ts', 'apps/api/src/modules/custody/withdrawal-policy.service.ts', 'apps/api/src/modules/custody/custody.controller.ts', 'apps/api/src/modules/custody/dto/withdrawal-action.dto.ts'] },
  { id: 'GAP-29', title: 'Custody Adapter Fail-Closed & Signer Verification', files: ['apps/api/src/modules/providers/adapters/custody.adapter.ts', 'apps/api/src/modules/custody/custody-adapter.contract.spec.ts', 'apps/api/src/modules/custody/custody-fail-closed.spec.ts'] },
  { id: 'GAP-30', title: 'Funding & Custody Reconciliation Service & Admin View', files: ['apps/api/src/modules/custody/custody-reconciliation.service.ts', 'apps/api/src/modules/funding/funding-reconciliation.service.ts', 'apps/admin-web/src/app/(console)/funding-reconciliation/page.tsx', 'apps/admin-web/src/features/funding/funding-reconciliation-table.tsx'] },
  { id: 'GAP-31', title: 'Compliance Case Management Admin Console', files: ['apps/admin-web/src/app/(console)/compliance/page.tsx', 'apps/admin-web/src/app/(console)/compliance/[caseId]/page.tsx', 'apps/admin-web/src/features/compliance/compliance-case-queue.tsx', 'apps/admin-web/src/features/compliance/compliance-case-detail.tsx', 'apps/admin-web/src/tests/compliance-case-queue.test.tsx'] },
  { id: 'GAP-32', title: 'Compliance Case Backend Workflow & Persistence', files: ['apps/api/src/modules/compliance/compliance.controller.ts', 'apps/api/src/modules/compliance/compliance-case.service.ts', 'apps/api/src/modules/compliance/compliance-case.repository.ts', 'apps/api/src/modules/compliance/dto/compliance-review.dto.ts'] },
  { id: 'GAP-33', title: 'AML/Sanctions Screening & Transaction Monitoring Triggers', files: ['apps/api/src/modules/compliance/aml-screening.service.ts', 'apps/api/src/modules/compliance/transaction-monitoring.service.ts', 'apps/admin-web/src/features/compliance/aml-screening-panel.tsx'] },
  { id: 'GAP-34', title: 'Compliance Audit Trail & Regulatory Export', files: ['apps/api/src/modules/compliance/compliance-audit.service.ts', 'apps/admin-web/src/features/compliance/compliance-audit-timeline.tsx', 'apps/admin-web/src/tests/compliance-audit-timeline.test.tsx'] },
  { id: 'GAP-35', title: 'Partner / IB Dashboard & Referral Link Management UI', files: ['apps/web/src/app/partner/page.tsx', 'apps/web/src/app/partner/referrals/page.tsx', 'apps/web/src/features/partner/partner-dashboard.tsx', 'apps/web/src/features/partner/referral-manager.tsx', 'apps/web/src/api/partner-api.ts', 'apps/web/src/tests/partner-dashboard.test.tsx'] },
  { id: 'GAP-36', title: 'Partner Commission Ledger & Tiered Rebate Calculation UI', files: ['apps/web/src/app/partner/commissions/page.tsx', 'apps/web/src/features/partner/commission-ledger.tsx', 'apps/api/src/modules/partner/partner-commission-ledger.service.ts'] },
  { id: 'GAP-37', title: 'Partner Payout Request & Settlement Tracking UI', files: ['apps/web/src/app/partner/payouts/page.tsx', 'apps/web/src/features/partner/partner-payouts.tsx', 'apps/api/src/modules/partner/partner-payout.service.ts', 'apps/web/src/tests/partner-payouts.test.tsx'] },
  { id: 'GAP-38', title: 'Partner API Module Registration & Route Exposure', files: ['apps/api/src/modules/partner/partner.module.ts', 'apps/api/src/modules/partner/partner.controller.ts', 'apps/api/src/modules/partner/dto/partner-campaign.dto.ts', 'apps/web/src/config/feature-config.ts'] },
  { id: 'GAP-39', title: 'Admin Partner & Affiliate Management Console', files: ['apps/admin-web/src/app/(console)/partners/page.tsx', 'apps/admin-web/src/app/(console)/partners/[partnerId]/page.tsx', 'apps/admin-web/src/features/partners/partner-admin-table.tsx', 'apps/api/src/modules/partner/partner-reconciliation.service.ts'] },
  { id: 'GAP-40', title: 'Customer Support / Helpdesk Ticket UI', files: ['apps/web/src/app/support/page.tsx', 'apps/web/src/features/support/support-page.tsx', 'apps/web/src/config/routes.tsx'] },
  { id: 'GAP-41', title: 'Copy-Trading Event Notification Templates & Dispatch', files: ['apps/api/src/modules/notifications/processors/copy-trading-notification.processor.ts', 'apps/api/src/modules/notifications/notifications.module.ts', 'apps/web/src/features/notifications/copy-trading-notifications.tsx', 'apps/web/src/app/notifications/page.tsx'] },
  { id: 'GAP-42', title: 'Customer Activity & Audit Log View', files: ['apps/web/src/app/activity/page.tsx', 'apps/web/src/features/activity/customer-activity-page.tsx', 'apps/web/src/api/activity-api.ts', 'apps/api/src/modules/audit/audit.controller.ts', 'apps/web/src/tests/customer-activity-page.test.tsx'] },
  { id: 'GAP-43', title: 'Unified Loading, Empty, Error & Degraded-Mode States', files: ['apps/web/src/components/trading-state.tsx'] },
  { id: 'GAP-44', title: 'Vault / AWS Secrets Manager Workload Identity Credential Fetcher', files: ['services/execution-engine/app/security/secret_fetcher.py', 'services/execution-engine/app/exchanges/credentials.py', 'services/execution-engine/app/config.py', 'services/execution-engine/tests/test_part19_vault_fetcher.py'] },
  // Paths are relative to the git repository root, one level above this monorepo: GitHub only reads
  // `.github/workflows` there, so the workflows moved up and these entries moved with them.
  { id: 'GAP-45', title: 'GitHub Actions CI/CD Workflows', files: ['../.github/workflows/ci.yml', '../.github/workflows/security.yml', '../.github/workflows/release.yml', '../.github/workflows/codeql.yml'] },
  { id: 'GAP-46', title: 'Production Preflight & Environment Validation Hardening', files: ['scripts/preflight-production.ts', 'scripts/preflight-production.py', 'packages/config/src/index.ts'] },
  { id: 'GAP-47', title: 'Database Migration & Schema Drift Verification Gate', files: ['scripts/verify-schema-consistency.js', 'infrastructure/database/README.md', 'scripts/verify-schema-consistency.test.js'] },
  // Two layers, and the list names both because they are not interchangeable: `smoke/` renders a page to
  // static markup in jest (no browser), `browser/` drives chromium against the running apps and a stub
  // upstream through playwright.
  { id: 'GAP-48', title: 'End-to-End Integration & Browser Smoke Test Suite', files: ['tests/e2e/smoke/copy-trading-lifecycle.spec.ts', 'tests/e2e/smoke/trader-discovery.spec.ts', 'tests/e2e/smoke/funding-compliance.spec.ts', 'tests/e2e/smoke/admin-operations.spec.ts', 'tests/e2e/browser/copy-trading-lifecycle.spec.ts', 'tests/e2e/browser/trader-discovery.spec.ts', 'tests/e2e/browser/admin-operations.spec.ts', 'tests/e2e/browser/support/stub-api.mjs', 'playwright.config.ts'] },
  { id: 'GAP-49', title: 'Release Manifest & Handover Report Generator Sync', files: ['scripts/generate-release-manifest.ts', 'scripts/gen_part22_handover.py', 'apps/api/src/modules/ops/production/release-manifest.service.ts', 'docs/FINAL_RELEASE_HANDOVER.md'] },
  { id: 'GAP-50', title: 'Automated 50-Gap Parity Scanner & Regression Gate', files: ['ops/gap-parity-scanner.js', 'ops/gap-parity-scanner.test.js', 'ops/production-validation-50-checks.js', 'ops/governance-validation-50-checks.js', 'ops/partner-validation-60-checks.js'] },
];

const FORBIDDEN_PLACEHOLDERS = [
  'Rest of the code here',
  'existing code omitted',
  'same as before',
];

/**
 * A re-export shim: a file whose entire body is import/export statements, aliasing a canonical
 * implementation that lives somewhere else. F4 and F5 in the round-5 audit were this - four Python
 * "modules" of 33-35 lines that re-exported code living at another path, and a dozen TypeScript
 * files doing the same - and the scanner counted those gaps satisfied, because the files existed,
 * were non-empty, and contained none of the three forbidden placeholder strings.
 *
 * Barrel files are excluded on purpose: an `index.ts` that re-exports a package's surface is a real
 * pattern, not a substitute for an implementation. A file that *declares* something - a class, a
 * function, an interface, a type, an enum, a const - is not a shim either, however short it is.
 */
const DECLARATION_PATTERN =
  /^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(class|function|async function|interface|type|enum|const|let|var|namespace|module)\b/;

function looksLikeReExportShim(rel, text) {
  if (!/\.(ts|tsx|js|mjs|cjs|py)$/.test(rel)) return false;
  const base = rel.split('/').pop();
  if (/^index\.(ts|tsx|js|mjs|cjs)$/.test(base)) return false;
  if (/\.d\.ts$/.test(base)) return false;
  if (/(\.spec|\.test)\./.test(base)) return false;

  const docstrings = ['"""', "'''"];
  const code = text
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('//') &&
        !line.startsWith('#') &&
        !line.startsWith('/*') &&
        !line.startsWith('*') &&
        !docstrings.includes(line) &&
        !/^["']{3}/.test(line),
    );

  if (code.length === 0) return false;
  if (code.some((line) => DECLARATION_PATTERN.test(line))) return false;

  const onlyReExports = code.every(
    (line) =>
      /^import\b/.test(line) ||
      /^from\b.+import\b/.test(line) ||
      /^export\s*\{[^}]*\}\s*(from\s+['"][^'"]+['"])?;?$/.test(line) ||
      /^export\s*\{/.test(line) ||
      /^export\s*\*\s*from\s+['"][^'"]+['"];?$/.test(line) ||
      /^export\s+\{?[^}]*\}?\s+from\s+['"][^'"]+['"];?$/.test(line) ||
      /^__all__\s*=/.test(line) ||
      /^[A-Za-z_$][\w.$]*(\s+as\s+[A-Za-z_$][\w.$]*)?,?$/.test(line) ||
      /^export\s+default\s+[A-Za-z_$][\w.$]*;?$/.test(line) ||
      /^};?$/.test(line) ||
      /^\)$/.test(line) ||
      /^\)\]$/.test(line) ||
      /^\]$/.test(line) ||
      /^['"][^'"]*['"],?$/.test(line),
  );
  return (
    onlyReExports && code.some((line) => /^export\s*\{|^export\s*\*|^__all__|^from\b/.test(line))
  );
}

/**
 * The second half of F2: a unit that exists, compiles and is even tested, but that no production
 * file imports. Two performance services existed in the API; only one was reachable from a
 * controller, and nothing in the tree said which. The same shape turned up again in the OMS module,
 * where four "services" were re-export shims nobody imported.
 *
 * The check is deliberately narrow - only files whose name marks them as an implementation unit
 * (`.service.ts`, `.repository.ts`, `.adapter.ts`, `.guard.ts`, `.interceptor.ts`, `.strategy.ts`)
 * and only against other *production* files, because a spec importing a module proves the module
 * works and says nothing about whether anything runs it. Framework entry points (NestJS modules,
 * controllers, Next.js pages and route handlers) are never flagged: the framework imports them.
 */
const WIRING_REQUIRED_PATTERN = /\.(service|repository|adapter|guard|interceptor|strategy)\.(ts|py)$/;

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'test-results',
  'playwright-report',
  '.pytest_cache',
]);

/** Every module specifier any production file imports, walked once per scan. */
function collectImportSpecifiers(rootDir) {
  const specifiers = new Set();

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|py)$/.test(entry.name)) continue;
      if (/(\.spec|\.test)\./.test(entry.name)) continue;
      if (entry.name.endsWith('_test.py') || entry.name.startsWith('test_')) continue;

      let text;
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }

      for (const match of text.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)) {
        specifiers.add(path.posix.basename(match[1]));
      }
      for (const match of text.matchAll(/^from\s+([\w.]+)\s+import\b/gm)) {
        specifiers.add(match[1].split('.').pop());
      }
      for (const match of text.matchAll(/^import\s+([\w.]+)/gm)) {
        specifiers.add(match[1].split('.').pop());
      }
    }
  };

  walk(rootDir);
  return specifiers;
}

function isUnwiredImplementation(rel, specifiers) {
  if (!WIRING_REQUIRED_PATTERN.test(rel)) return false;
  const base = rel.split('/').pop().replace(/\.(ts|py)$/, ''); // trader-risk-score.service
  const stem = base.replace(/\.(service|repository|adapter|guard|interceptor|strategy)$/, '');
  return !specifiers.has(base) && !specifiers.has(stem);
}

function runGapParityScan(rootDir = ROOT) {
  const results = [];
  let passedCount = 0;

  // Collected once for the whole tree: every import specifier any production file uses.
  const specifiers = collectImportSpecifiers(rootDir);

  for (const gap of GAP_CHECKS) {
    const missingFiles = [];
    const placeholderFiles = [];
    const shimFiles = [];
    const unwiredFiles = [];

    for (const rel of gap.files) {
      const abs = path.join(rootDir, rel);
      if (!fs.existsSync(abs)) {
        missingFiles.push(rel);
        continue;
      }
      const stat = fs.statSync(abs);
      if (stat.size === 0) {
        missingFiles.push(`${rel} (empty)`);
        continue;
      }
      if (rel !== 'ops/gap-parity-scanner.js') {
        const text = fs.readFileSync(abs, 'utf8');
        for (const forbidden of FORBIDDEN_PLACEHOLDERS) {
          if (text.includes(forbidden)) {
            placeholderFiles.push(`${rel} (contains "${forbidden}")`);
          }
        }
        if (looksLikeReExportShim(rel, text)) {
          shimFiles.push(rel);
        }
        if (isUnwiredImplementation(rel, specifiers)) {
          unwiredFiles.push(rel);
        }
      }
    }

    const ok =
      missingFiles.length === 0 &&
      placeholderFiles.length === 0 &&
      shimFiles.length === 0 &&
      unwiredFiles.length === 0;
    if (ok) passedCount++;
    results.push({
      id: gap.id,
      title: gap.title,
      ok,
      missingFiles,
      placeholderFiles,
      shimFiles,
      unwiredFiles,
    });
  }

  return {
    total: GAP_CHECKS.length,
    passed: passedCount,
    failed: GAP_CHECKS.length - passedCount,
    ok: passedCount === GAP_CHECKS.length,
    results,
  };
}

if (require.main === module) {
  const report = runGapParityScan();
  for (const item of report.results) {
    const icon = item.ok ? '✅' : '❌';
    console.log(`${icon} ${item.id}: ${item.title}`);
    for (const m of item.missingFiles) {
      console.error(`   missing: ${m}`);
    }
    for (const p of item.placeholderFiles) {
      console.error(`   placeholder: ${p}`);
    }
    for (const shim of item.shimFiles) {
      console.error(`   re-export shim (the implementation belongs at this path, not beside it): ${shim}`);
    }
    for (const unwired of item.unwiredFiles) {
      console.error(`   not wired: no production file imports ${unwired}`);
    }
  }
  console.log(`\n50-Gap Parity Scanner Result: ${report.passed}/${report.total} passed, ${report.failed} failed`);
  process.exit(report.ok ? 0 : 1);
}

module.exports = { GAP_CHECKS, runGapParityScan, looksLikeReExportShim, isUnwiredImplementation };
