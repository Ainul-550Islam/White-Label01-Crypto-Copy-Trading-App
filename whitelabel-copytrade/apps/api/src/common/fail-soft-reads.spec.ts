import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Prisma } from '@prisma/client';

import { isRecordNotFound } from './errors/prisma-not-found';
import { PaymentRepository } from '../modules/billing/payments/payment.repository';
import { AccountRestrictionService } from '../modules/client-lifecycle/account-restriction.service';
import { AccountingPeriodService } from '../modules/portfolio-accounting/accounting-period.service';
import { SessionSecurityService } from '../modules/security/session-security.service';
import { SsoProviderFactory } from '../modules/security/sso-provider.factory';
import { CopySubscriptionRepository } from '../modules/copy-trading/copy-subscription.repository';
import { DependencyHealthService } from '../modules/operations/dependency-health.service';
import { OperationalMetricsService } from '../modules/operations/operational-metrics.service';
import { CostBasisService } from '../modules/portfolio-accounting/cost-basis.service';
import { ReconciliationOrchestratorService } from '../modules/operations/reconciliation-orchestrator.service';

/**
 * Fail-soft reads (round 8).
 *
 * A database read that fails is an error, not "no rows". Before this change
 * about 300 data-access methods caught every storage error and answered an
 * empty list, null, 0 or false, so an outage looked like "nothing there" -
 * and four of those answers failed OPEN: a restriction check said "not
 * restricted", a closed-period check said "open", a session-revocation check
 * said "not revoked" and an SSO-enforcement check said "not enforced".
 *
 * The methods now let the error propagate (the global PrismaExceptionFilter
 * maps it to a status without leaking the driver message); update/delete
 * methods keep `null`/`false` only for Prisma P2025 (record not found).
 *
 * The last block is a guard: it scans every non-spec module file for the
 * catch-everything-and-answer-empty shape and compares the result with an
 * explicit allowlist, so a new fail-soft read cannot be added silently.
 */

const STORAGE_DOWN = new Error('connection terminated unexpectedly');

describe('isRecordNotFound', () => {
  it('recognises Prisma P2025 as "not found"', () => {
    const known = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: 'test',
    });
    expect(isRecordNotFound(known)).toBe(true);
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
  });

  it('treats every other failure as an error', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(isRecordNotFound(unique)).toBe(false);
    expect(isRecordNotFound(STORAGE_DOWN)).toBe(false);
    expect(isRecordNotFound({ code: '57014' })).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
    expect(isRecordNotFound(undefined)).toBe(false);
    expect(isRecordNotFound('P2025')).toBe(false);
  });
});

describe('fail-open checks now fail closed (the error propagates)', () => {
  it('AccountRestrictionService.hasRestriction: a failed read is not "no restriction"', async () => {
    const prisma = { accountRestriction: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new AccountRestrictionService(prisma as any, {} as any);
    await expect(
      service.hasRestriction({ tenantId: 't1', accountId: 'a1', restrictionType: 'TRADING_BLOCK' as any }),
    ).rejects.toBe(STORAGE_DOWN);
  });

  it('AccountRestrictionService.hasRestriction still answers true/false from a successful read', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce(null);
    const service = new AccountRestrictionService({ accountRestriction: { findFirst } } as any, {} as any);
    const params = { tenantId: 't1', accountId: 'a1', restrictionType: 'TRADING_BLOCK' as any };
    await expect(service.hasRestriction(params)).resolves.toBe(true);
    await expect(service.hasRestriction(params)).resolves.toBe(false);
  });

  it('AccountingPeriodService.isPeriodClosed: a failed read is not "period open"', async () => {
    const prisma = { portfolioAccountingPeriod: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new AccountingPeriodService(prisma as any, {} as any);
    await expect(service.isPeriodClosed({ tenantId: 't1', profileId: 'p1', at: new Date() })).rejects.toBe(STORAGE_DOWN);
  });

  it('SessionSecurityService.isSessionRevoked: a failed read is not "not revoked"', async () => {
    const prisma = { userSession: { findUnique: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const cache = { get: jest.fn().mockResolvedValue(null) };
    const service = new SessionSecurityService(prisma as any, {} as any, {} as any, {} as any, cache as any);
    await expect(service.isSessionRevoked('s1')).rejects.toBe(STORAGE_DOWN);
  });

  it('SessionSecurityService.isSessionRevoked still honours the cache and the stored revokedAt', async () => {
    const findUnique = jest.fn().mockResolvedValue({ revokedAt: new Date() });
    const cache = { get: jest.fn().mockResolvedValueOnce({ reason: 'x' }).mockResolvedValueOnce(null) };
    const service = new SessionSecurityService({ userSession: { findUnique } } as any, {} as any, {} as any, {} as any, cache as any);
    await expect(service.isSessionRevoked('s1')).resolves.toBe(true);
    await expect(service.isSessionRevoked('s1')).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('SessionSecurityService.revokeAllSessions: a failed read is not "0 sessions revoked"', async () => {
    const prisma = { userSession: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new SessionSecurityService(prisma as any, {} as any, {} as any, {} as any, { set: jest.fn() } as any);
    await expect(service.revokeAllSessions({ userId: 'u1', tenantId: 't1', reason: 'password_changed' })).rejects.toBe(
      STORAGE_DOWN,
    );
  });

  it('SsoProviderFactory.isSsoEnforced / listTenantProviders: a failed read is not "SSO not enforced"', async () => {
    const prisma = {
      ssoConfiguration: {
        findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN),
        findMany: jest.fn().mockRejectedValue(STORAGE_DOWN),
      },
    };
    const factory = new SsoProviderFactory(prisma as any, {} as any, {} as any);
    await expect(factory.isSsoEnforced('t1')).rejects.toBe(STORAGE_DOWN);
    await expect(factory.listTenantProviders('t1')).rejects.toBe(STORAGE_DOWN);
  });
});

describe('fail-soft reads now propagate', () => {
  it('PaymentRepository lookups used by webhooks and idempotent retries do not report "no such payment" on failure', async () => {
    const prisma = { payment: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN), findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const repository = new PaymentRepository(prisma as any);
    await expect(repository.findByIdempotencyKey('idem-1', 't1')).rejects.toBe(STORAGE_DOWN);
    await expect(repository.findByProviderPaymentId('pi_1', 'STRIPE' as any)).rejects.toBe(STORAGE_DOWN);
    await expect(repository.list({ tenantId: 't1' } as any)).rejects.toBe(STORAGE_DOWN);
  });

  it('PaymentRepository still answers null for a payment that is really absent', async () => {
    const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new PaymentRepository(prisma as any).findByIdempotencyKey('idem-1', 't1')).resolves.toBeNull();
  });

  it('CostBasisService does not compute FIFO cost basis against an unread lot list', async () => {
    const prisma = { portfolioPositionLot: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const policy = { resolvePolicy: jest.fn().mockResolvedValue({}) };
    const service = new CostBasisService(prisma as any, {} as any, policy as any);
    await expect(
      service.calculateCostBasisForFill({
        tenantId: 't1',
        profileId: 'p1',
        fill: {},
        symbol: 'BTCUSDT',
        quantity: '1',
        price: '100',
        side: 'SELL',
        occurredAt: new Date(),
        accountingEventId: 'e1',
      }),
    ).rejects.toBe(STORAGE_DOWN);
  });

  it('OperationalMetricsService does not publish zeros as measured observations', async () => {
    const prisma = { operationalIncident: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new OperationalMetricsService(prisma as any);
    await expect(service.calculateMetrics({ tenantId: 't1', from: new Date(Date.now() - 3600_000), to: new Date() })).rejects.toBe(
      STORAGE_DOWN,
    );
  });
});

describe('update methods keep "not found" only for P2025', () => {
  it('CopySubscriptionRepository.updateState answers null for a missing row', async () => {
    const prisma = { copySubscription: { update: jest.fn().mockRejectedValue({ code: 'P2025' }) } };
    await expect(new CopySubscriptionRepository(prisma as any).updateState('s1', 't1', 'PAUSED' as any)).resolves.toBeNull();
  });

  it('CopySubscriptionRepository.updateState propagates any other failure', async () => {
    const prisma = { copySubscription: { update: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    await expect(new CopySubscriptionRepository(prisma as any).updateState('s1', 't1', 'PAUSED' as any)).rejects.toBe(
      STORAGE_DOWN,
    );
  });
});

describe('health and reconciliation report a failed read as a failure, not as clean', () => {
  it('DependencyHealthService.checkRisk is UNKNOWN (not HEALTHY with 0 policies) when the read fails', async () => {
    const prisma = { institutionalRiskPolicy: { count: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new DependencyHealthService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const result = await service.checkRisk('t1');
    expect(result.state).toBe('UNKNOWN');
    expect(result.errorCode).toBe('RISK_CHECK_FAILED');
  });

  it('DependencyHealthService.checkRisk is HEALTHY with the real count when the read succeeds', async () => {
    const prisma = { institutionalRiskPolicy: { count: jest.fn().mockResolvedValue(3) } };
    const service = new DependencyHealthService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const result = await service.checkRisk('t1');
    expect(result.state).toBe('HEALTHY');
    expect(result.evidence).toEqual(expect.objectContaining({ policyCount: 3 }));
  });

  it('ReconciliationOrchestratorService: an unreadable OMS order table is FAILED, not SUCCEEDED with 0 mismatches', async () => {
    const prisma = { omsOrderIntent: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new ReconciliationOrchestratorService(prisma as any, {} as any, {} as any, {} as any);
    const result = await (service as any).reconcileOmsOrder('t1');
    expect(result.status).toBe('FAILED');
    expect(result.itemsChecked).toBe(0);
  });

  it('ReconciliationOrchestratorService: a readable table still reconciles', async () => {
    const prisma = { omsOrderIntent: { findMany: jest.fn().mockResolvedValue([{ id: 'o1' }]) } };
    const service = new ReconciliationOrchestratorService(prisma as any, {} as any, {} as any, {} as any);
    const result = await (service as any).reconcileOmsOrder('t1');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.mismatchesFound).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guard: the catch-everything-and-answer-empty shape, per module file.
// ---------------------------------------------------------------------------

const MODULES_ROOT = join(__dirname, '..', 'modules');

/**
 * Every remaining `try { ... } catch { [log;] return <empty>; }` in a module
 * file, with the reason it is not a fail-soft storage read. Counts are exact:
 * adding a site fails this spec, and so does removing one without updating
 * the list (so the list cannot drift from the code).
 */
const ALLOWED_TRY_CATCH_EMPTY: Record<string, { count: number; reason: string }> = {
  'billing/analytics/analytics-cache.service.ts': { count: 4, reason: 'cache get/invalidate; a cache miss or failure falls back to computing the value' },
  'billing/analytics/revenue-cohort.service.ts': { count: 1, reason: 'cohort key derivation from a date (pure computation)' },
  'billing/entitlements/entitlement.resolver.ts': { count: 3, reason: 'EntitlementResolver is exported but not registered in any Nest module (no route reaches it)' },
  'billing/fees/fee-analytics.service.ts': { count: 1, reason: 'parsing a decimal string into minor units' },
  'billing/fees/payout-provider.factory.ts': { count: 1, reason: 'provider availability probe; unavailable is the fail-closed answer' },
  'billing/finance/invoice-number.service.ts': { count: 2, reason: 'Redis sequence readers with no callers (numbers are allocated elsewhere)' },
  'billing/limits/limit.resolver.ts': { count: 3, reason: 'LimitResolver is exported but not registered in any Nest module (no route reaches it)' },
  'billing/notifications/notification-worker.service.ts': { count: 1, reason: 'worker loop: logs the (now propagated) repository error and retries on the next tick' },
  'billing/notifications/push-notification.service.ts': { count: 1, reason: 'optional firebase-admin module import' },
  'billing/payments/payment-provider.factory.ts': { count: 1, reason: 'provider enabled flag from config; disabled is the fail-closed answer' },
  'billing/payments/webhook.signature.ts': { count: 2, reason: 'reading id/type fields from an already-parsed provider event' },
  'oms/allocation.service.ts': { count: 1, reason: 'multi-step write flow that logs its failure (write side, not a read)' },
  'oms/execution-latency.service.ts': { count: 1, reason: 'parsing a microsecond string' },
  'oms/execution-quality.service.ts': { count: 1, reason: 'parsing a scaled decimal' },
  'oms/order-submission-result.service.ts': { count: 1, reason: 'JSON.parse of a queue return value' },
  'compliance/compliance-case.repository.ts': { count: 1, reason: 'reviewer assignment write flow that logs its failure (write side)' },
  'compliance/transaction-monitoring.service.ts': { count: 1, reason: 'signal acknowledgement updateMany that logs its failure (write side)' },
  'copy-trading/copy-execution.repository.ts': { count: 1, reason: 'status-transition write that logs its failure (write side)' },
  'copy-trading/copy-execution.service.ts': { count: 5, reason: 'fail-closed pre-trade guards: a failed lookup BLOCKS the leader event and logs it' },
  'custody/custody-audit.service.ts': { count: 1, reason: 'audit record create that logs its failure (write side)' },
  'exchanges/exchange-rate-limit.service.ts': { count: 1, reason: 'rate-limit state from the cache (status read, not storage)' },
  'exchanges/exchange-symbol.service.ts': { count: 1, reason: 'symbol string parsing' },
  'exchanges/secret-store.ts': { count: 1, reason: 'reading VAULT_TOKEN_FILE; a missing token then fails closed with NOT_CONFIGURED' },
  'governance/compliance-report-template.service.ts': { count: 1, reason: 'in-memory template lookup' },
  'health/trading-readiness.service.ts': { count: 1, reason: 'queue-depth samples from Redis for a metrics sampler' },
  'mobile-release/mobile-artifact-verification.service.ts': { count: 1, reason: 'timingSafeEqual on hex digests of different length' },
  'mobile-release/mobile-build-validation.service.ts': { count: 1, reason: 'file existence check on the build host' },
  'observability/observability.mapper.ts': { count: 3, reason: 'JSON.parse of stored evidence text' },
  'observability/observability.service.ts': { count: 1, reason: 'queue-depth samples from Redis for a dashboard' },
  'operations/incident-escalation.service.ts': { count: 2, reason: 'escalation sweep and transition: cron-driven, logged, retried on the next run' },
  'portfolio-accounting/attribution.service.ts': { count: 1, reason: 'derived attribution record create that logs its failure (write side)' },
  'portfolio-accounting/performance.service.ts': { count: 1, reason: 'derived performance record create that logs its failure (write side)' },
  'portfolio-accounting/valuation.service.ts': { count: 1, reason: 'derived valuation record create that logs its failure (write side)' },
  'providers/provider-webhook.service.ts': { count: 4, reason: 'webhook signature verification (false = reject) and body parsing' },
  'research/market-data-service.ts': { count: 1, reason: 'market-data provider availability probe (gated provider)' },
  'research/research-repository.ts': { count: 1, reason: 'research audit-log create (write side)' },
  'risk/risk-state.service.ts': { count: 1, reason: 'parsing a stored policy document' },
  'security/sso-flow.types.ts': { count: 1, reason: 'URL parsing' },
};

/**
 * Every remaining promise-style `.catch(() => <empty>)` in a module file.
 * None of them swallows a read the caller then treats as data.
 */
const ALLOWED_PROMISE_CATCH_EMPTY: Record<string, { count: number; reason: string }> = {
  'billing/finance/vies-vat.client.ts': { count: 1, reason: 'parsing a provider response body' },
  'billing/notifications/email-notification.provider.ts': { count: 1, reason: 'optional nodemailer module import' },
  'billing/notifications/push-notification.service.ts': { count: 1, reason: 'optional firebase-admin module import' },
  'billing/notifications/twilio-sms.provider.ts': { count: 1, reason: 'parsing a provider response body' },
  'billing/payments/checkout.service.ts': { count: 1, reason: 'secondary mark-failed write inside an error path that then reports the failure' },
  'billing/saas-admin/tenant-feature-access.service.ts': { count: 1, reason: 'best-effort audit of a read-only feature check' },
  'datasets/dataset-ingestion.service.ts': { count: 2, reason: 'secondary writes inside an error path that then throws ServiceUnavailable' },
  'developer-platform/developer.module.ts': { count: 1, reason: 'draining a webhook test response body' },
  'exchanges/secret-store.ts': { count: 2, reason: 'parsing a Vault response body' },
  'oms/fill-management.service.ts': { count: 1, reason: 'canonical-order fallback path (round 7 item B), not the primary read' },
  'oms/order-submission-result.service.ts': { count: 3, reason: 'queue-events close on shutdown and BullMQ job lookups (a removed job is absent)' },
  'operations/dependency-health.service.ts': { count: 1, reason: 'checkOms: a failed count is reported as MISCONFIGURED, not as healthy' },
  'operations/job-health.service.ts': { count: 1, reason: 'queue-depth metadata (unused by the evaluation)' },
  'operations/reconciliation-orchestrator.service.ts': { count: 1, reason: 'lock acquisition: no lock means the run is skipped and logged' },
  'operations/reconciliation-schedule.service.ts': { count: 1, reason: 'lock acquisition: no lock means the run is skipped and logged' },
  'operations/recovery-plan.service.ts': { count: 2, reason: 'lock acquisition, and a Redis health probe that reports ok:false' },
  'partners/partner-settlement.service.ts': { count: 1, reason: 'in-memory ledger fallback path after a failed transaction' },
  'providers/provider-health.service.ts': { count: 1, reason: 'buyer-gated payment-provider HTTP probe' },
  'queue/processors/maintenance.processor.ts': { count: 2, reason: 'best-effort SLO sample counters' },
  'queue/queue.service.ts': { count: 1, reason: 'best-effort tracing sidecar capture' },
  'worker/trade-execution.processor.ts': { count: 2, reason: 'best-effort SLO sample counters' },
};

function listModuleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listModuleFiles(full));
    } else if (name.endsWith('.ts') && !name.includes('.spec.') && !name.includes('fixture')) {
      out.push(full);
    }
  }
  return out;
}

function skipString(s: string, i: number): number {
  const quote = s[i];
  i += 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && c === '$' && s[i + 1] === '{') {
      i = matchBrace(s, i + 1) + 1;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Index of the `}` matching the `{` at `open` (strings, template literals and comments skipped). */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(s, i);
      continue;
    }
    if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

const EMPTY_RETURN =
  /^return\s*(\[\]|null|undefined|0|false|\{\s*\}|\{[^{}]*:\s*\[\][^{}]*\}|\{\s*(data|items)\s*:\s*\[\][^{}]*\})\s*;?$/;

function stripComments(code: string): string {
  return code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function countTryCatchEmpty(source: string): number {
  let count = 0;
  const tryRe = /\btry\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = tryRe.exec(source)) !== null) {
    const tryOpen = m.index + m[0].length - 1;
    const tryClose = matchBrace(source, tryOpen);
    if (tryClose < 0) continue;
    const catchHead = /^\s*catch\s*(\(\s*(\w+)[^)]*\))?\s*\{/.exec(source.slice(tryClose + 1));
    if (!catchHead) continue;
    const catchOpen = tryClose + 1 + catchHead[0].length - 1;
    const catchClose = matchBrace(source, catchOpen);
    const body = stripComments(source.slice(catchOpen + 1, catchClose)).trim();
    const statements = body
      .split(/;\s*\n|\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    const rest = statements.filter((x) => !x.startsWith('this.logger') && !x.startsWith('logger'));
    if (rest.length === 1 && EMPTY_RETURN.test(rest.join(' '))) count += 1;
  }
  return count;
}

const PROMISE_CATCH_EMPTY = /\.catch\(\s*(\([^)]*\))?\s*=>\s*(\[\]|null|0|false|undefined|'0'|\(\{|\{\s*\}|null as any)/g;

function scan(counter: (source: string) => number): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of listModuleFiles(MODULES_ROOT)) {
    const n = counter(readFileSync(file, 'utf8'));
    if (n > 0) found[relative(MODULES_ROOT, file).split('\\').join('/')] = n;
  }
  return found;
}

function expectedCounts(list: Record<string, { count: number; reason: string }>): Record<string, number> {
  return Object.fromEntries(Object.entries(list).map(([file, entry]) => [file, entry.count]));
}

describe('guard: no new fail-soft reads in module code', () => {
  it('every try/catch that answers an empty value is on the reviewed allowlist (exact counts)', () => {
    expect(scan(countTryCatchEmpty)).toEqual(expectedCounts(ALLOWED_TRY_CATCH_EMPTY));
  });

  it('every promise .catch that answers an empty value is on the reviewed allowlist (exact counts)', () => {
    expect(scan((source) => (source.match(PROMISE_CATCH_EMPTY) ?? []).length)).toEqual(
      expectedCounts(ALLOWED_PROMISE_CATCH_EMPTY),
    );
  });

  it('every allowlist entry states a reason', () => {
    for (const entry of [...Object.values(ALLOWED_TRY_CATCH_EMPTY), ...Object.values(ALLOWED_PROMISE_CATCH_EMPTY)]) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('the scanner sees the shape it guards against (self-test)', () => {
    const failSoft = "async f() {\n  try {\n    return await this.prisma.x.findMany();\n  } catch {\n    return [];\n  }\n}\n";
    const logged = "async f() {\n  try {\n    return await this.prisma.x.findFirst();\n  } catch (e) {\n    this.logger.warn(`x ${e}`);\n    return null;\n  }\n}\n";
    const rethrow = "async f() {\n  try {\n    return await this.prisma.x.findMany();\n  } catch (e) {\n    this.logger.warn('x');\n    throw e;\n  }\n}\n";
    const braceInString = "async f() {\n  try {\n    const s = `{${'}'}`;\n    return s;\n  } catch {\n    return { data: [], total: 0 };\n  }\n}\n";
    expect(countTryCatchEmpty(failSoft)).toBe(1);
    expect(countTryCatchEmpty(logged)).toBe(1);
    expect(countTryCatchEmpty(rethrow)).toBe(0);
    expect(countTryCatchEmpty(braceInString)).toBe(1);
    expect('await this.prisma.x.findMany().catch(() => []);'.match(PROMISE_CATCH_EMPTY)?.length).toBe(1);
  });
});
