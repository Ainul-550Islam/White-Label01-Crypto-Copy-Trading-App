import { Injectable, Logger, ForbiddenException, BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EffectiveRiskPolicy, RiskPolicyScope, RiskPolicyThresholds } from './risk-management.types';

/**
 * Institutional risk policy resolver with precedence:
 * PLATFORM -> TENANT -> TRADER -> STRATEGY -> FOLLOWER
 *
 * Lower scope NEVER weakens mandatory higher-level safety rule.
 * Structured config only — no executable expressions.
 *
 * Reuses existing RiskConfiguration per account as fallback, but authoritative
 * for institutional thresholds is InstitutionalRiskPolicy table plus platform
 * env ceilings.
 *
 * Decimal-safe: thresholds are decimal strings, validated, never floats.
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const MAX_POLICY_SIZE_BYTES = 64 * 1024;

function isValidDecimalString(v: string): boolean {
  if (typeof v !== 'string') return false;
  if (v.length > 64) return false;
  if (!DECIMAL_PATTERN.test(v)) return false;
  // No leading zeros abuse except "0.x"
  if (v.startsWith('00')) return false;
  if (v.includes('.') && v.split('.')[1].length > 12) return false;
  return true;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalJson(value: unknown): string {
  // Deterministic JSON: sort keys recursively, no whitespace.
  const sort = (x: any): any => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      const out: any = {};
      Object.keys(x).sort().forEach((k) => (out[k] = sort(x[k])));
      return out;
    }
    return x;
  };
  return JSON.stringify(sort(value));
}

function defaultThresholds(): RiskPolicyThresholds {
  return {
    notionalCurrency: null,
    maxGrossExposure: null,
    maxNetExposure: null,
    maxSymbolExposure: null,
    maxVenueExposure: null,
    maxAccountExposure: null,
    maxStrategyExposure: null,
    maxTraderExposure: null,
    maxFollowerExposure: null,
    maxPositionNotional: null,
    maxOrderNotional: null,
    maxOpenOrders: null,
    maxLeverageGross: process.env.RISK_MAX_LEVERAGE_GROSS || '5',
    maxLeverageNet: process.env.RISK_MAX_LEVERAGE_NET || '5',
    maxLeverageSymbol: process.env.RISK_MAX_LEVERAGE_SYMBOL || '5',
    maxLeverageAccount: process.env.RISK_MAX_LEVERAGE_ACCOUNT || '5',
    marginWarningUtilization: '80',
    marginCriticalUtilization: '90',
    liquidationWarningDistance: '10', // %
    liquidationCriticalDistance: '5',
    maxConcentrationAssetPercent: '40',
    maxConcentrationSymbolPercent: '30',
    maxConcentrationVenuePercent: '60',
    maxConcentrationAccountPercent: '50',
    maxConcentrationStrategyPercent: '50',
    maxConcentrationTraderPercent: '50',
    maxConcentrationFollowerPercent: '50',
    maxDrawdownPercent: process.env.RISK_MAX_DRAWDOWN_PCT || '20',
    maxIntradayDrawdownPercent: process.env.RISK_MAX_INTRADAY_DRAWDOWN_PCT || '10',
    maxDailyLoss: process.env.RISK_MAX_DAILY_LOSS || '10000',
    dailyLossIncludesUnrealized: false,
    maxCorrelation: '0.8',
    correlationLookbackDays: 30,
    correlationMinObservations: 30,
    varConfidence: '95',
    varHorizonDays: 1,
    varWindowDays: 90,
    varMinObservations: 30,
    varThreshold: null,
    stressLossThreshold: null,
    marketDataMaxAgeMs: 30_000,
    exchangeHealthMaxAgeMs: 60_000,
    executionFailureBurstThreshold: 10,
    executionFailureWindowMs: 60_000,
    circuitBreakerLossThreshold: null,
    circuitBreakerDrawdownThreshold: null,
    circuitBreakerEnabled: true,
    killSwitchEnabled: true,
    allowRiskReducingOrders: true,
  };
}

function mergeThresholds(base: RiskPolicyThresholds, override: Partial<RiskPolicyThresholds>, isPlatform: boolean): RiskPolicyThresholds {
  const merged = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    const key = k as keyof RiskPolicyThresholds;
    // Lower scopes may tighten inherited limits, but cannot disable or weaken
    // a protection or silently reinterpret monetary caps in a new currency.
    if (!isPlatform) {
      const parent = base[key];
      let weaker = false;
      if (key === 'notionalCurrency' && parent != null) weaker = v !== parent;
      if ((key === 'killSwitchEnabled' || key === 'circuitBreakerEnabled' || key === 'dailyLossIncludesUnrealized') && parent === true) weaker = v !== true;
      if (key === 'allowRiskReducingOrders' && parent === false) weaker = v !== false;
      if (typeof v === 'number' && typeof parent === 'number') {
        if (['maxOpenOrders', 'marketDataMaxAgeMs', 'exchangeHealthMaxAgeMs', 'executionFailureBurstThreshold'].includes(String(key))) weaker = v > parent;
        if (key === 'executionFailureWindowMs') weaker = v < parent;
      }
      if (typeof v === 'string' && typeof parent === 'string' && isValidDecimalString(parent) && isValidDecimalString(v)) {
        const comparison = compareDecimalStrings(v, parent);
        if (String(key).startsWith('max') || String(key).includes('Concentration') || String(key).includes('Leverage') || String(key).includes('margin') || String(key).includes('Utilization') || ['varThreshold', 'stressLossThreshold', 'circuitBreakerLossThreshold', 'circuitBreakerDrawdownThreshold'].includes(String(key))) weaker = comparison > 0;
        if (['liquidationWarningDistance', 'liquidationCriticalDistance', 'varConfidence'].includes(String(key))) weaker = comparison < 0;
      }
      if (weaker) throw new ForbiddenException(`Policy scope attempted to weaken higher-level limit ${key}.`);
    }
    (merged as any)[key] = v;
  }
  return merged;
}

function compareDecimalStrings(a: string, b: string): number {
  // Parse as scaled BigInt with 12 decimals for comparison
  const parse = (s: string): bigint => {
    const [intPart, fracPart = ''] = s.replace('-', '').split('.');
    const sign = s.startsWith('-') ? -1n : 1n;
    const fracPadded = (fracPart + '000000000000').slice(0, 12);
    const scaled = BigInt(intPart) * 1_000_000_000_000n + BigInt(fracPadded || '0');
    return sign * scaled;
  };
  const av = parse(a);
  const bv = parse(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function validateThresholds(thresholds: Partial<RiskPolicyThresholds>): void {
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
    throw new BadRequestException('Risk thresholds must be an object');
  }
  const defaults = defaultThresholds() as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(thresholds)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key) || value === undefined) {
      throw new BadRequestException(`Unsupported risk threshold: ${key}`);
    }
    if (value === null) continue; // null inherits the higher scope, never clears it
    const defaultValue = defaults[key];
    if (key === 'notionalCurrency') {
      if (typeof value !== 'string' || !/^[A-Z0-9]{2,16}$/.test(value)) {
        throw new BadRequestException('Invalid notional currency');
      }
    } else if (typeof defaultValue === 'boolean') {
      if (typeof value !== 'boolean') throw new BadRequestException(`Invalid boolean for ${key}`);
    } else if (typeof defaultValue === 'number' || key === 'maxOpenOrders') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'maxOpenOrders' ? 0 : 1)) {
        throw new BadRequestException(`Invalid integer for ${key}`);
      }
    } else if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d{1,12})?$/.test(value) || !isValidDecimalString(value)) {
      throw new BadRequestException(`Invalid nonnegative decimal string for ${key}`);
    }
  }
}

@Injectable()
export class InstitutionalRiskPolicyService {
  private readonly logger = new Logger(InstitutionalRiskPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve effective policy for a given scope chain.
   * Precedence: PLATFORM -> TENANT -> TRADER -> STRATEGY -> FOLLOWER
   * Lower never weakens higher.
   */
  async resolveEffectivePolicy(params: {
    tenantId?: string | null;
    traderId?: string | null;
    strategyId?: string | null;
    followerId?: string | null;
  }, transaction?: Prisma.TransactionClient): Promise<EffectiveRiskPolicy> {
    const { tenantId, traderId, strategyId, followerId } = params;
    const chain: Array<{ scope: RiskPolicyScope; scopeId: string | null }> = [
      { scope: RiskPolicyScope.PLATFORM, scopeId: null },
      ...(tenantId ? [{ scope: RiskPolicyScope.TENANT, scopeId: tenantId }] : []),
      ...(traderId ? [{ scope: RiskPolicyScope.TRADER, scopeId: traderId }] : []),
      ...(strategyId ? [{ scope: RiskPolicyScope.STRATEGY, scopeId: strategyId }] : []),
      ...(followerId ? [{ scope: RiskPolicyScope.FOLLOWER, scopeId: followerId }] : []),
    ];

    // Platform rules are global; every other scope must also belong to this
    // tenant. Scope IDs alone are not a tenant boundary. Run tenant reads in a
    // scoped transaction so forced RLS cannot silently erase configured rules.
    const where = {
      isActive: true,
      OR: chain.map((c) => c.scope === RiskPolicyScope.PLATFORM
        ? { scope: c.scope as any, scopeId: null, tenantId: null }
        : { scope: c.scope as any, scopeId: c.scopeId, tenantId: tenantId! }),
    };
    const queryPolicies = (tx: Prisma.TransactionClient) => tx.institutionalRiskPolicy.findMany({
      where, orderBy: [{ scope: 'asc' }, { version: 'desc' }],
    });
    const dbPolicies = transaction
      ? await queryPolicies(transaction)
      : tenantId ? await this.prisma.withTenantRls(tenantId, queryPolicies)
        : await queryPolicies(this.prisma);

    // Build map latest per scope
    const latestByScope = new Map<string, (typeof dbPolicies)[number]>();
    for (const p of dbPolicies) {
      const key = `${p.scope}:${p.scopeId ?? ''}`;
      if (!latestByScope.has(key)) latestByScope.set(key, p);
    }

    let effective = defaultThresholds();
    const sourcePolicies: EffectiveRiskPolicy['sourcePolicies'] = [];
    const scopeChain: EffectiveRiskPolicy['scopeChain'] = [];

    // Platform defaults first (from env + defaultThresholds)
    const platformDigest = sha256Hex(canonicalJson(defaultThresholds()));
    scopeChain.push({ scope: RiskPolicyScope.PLATFORM, scopeId: null, version: 0, digest: platformDigest });

    // Apply in precedence order
    for (const step of chain) {
      const key = `${step.scope}:${step.scopeId ?? ''}`;
      const dbPol = latestByScope.get(key);
      if (!dbPol) continue;
      const policyJson = dbPol.policyJson as Partial<RiskPolicyThresholds>;
      validateThresholds(policyJson);
      const jsonStr = canonicalJson(policyJson);
      if (Buffer.byteLength(jsonStr, 'utf8') > MAX_POLICY_SIZE_BYTES) {
        throw new BadRequestException(`Policy too large for scope ${step.scope}`);
      }
      // Check no executable
      if (/__proto__|constructor|process|require|eval/.test(jsonStr)) {
        throw new BadRequestException(`Policy contains disallowed pattern for scope ${step.scope}`);
      }
      const isPlatform = step.scope === RiskPolicyScope.PLATFORM;
      effective = mergeThresholds(effective, policyJson, isPlatform);
      scopeChain.push({ scope: step.scope, scopeId: step.scopeId, version: dbPol.version, digest: dbPol.digest });
      sourcePolicies.push({
        scope: step.scope,
        scopeId: step.scopeId,
        version: dbPol.version,
        digest: dbPol.digest,
        thresholds: policyJson,
      });
    }

    // Also incorporate existing RiskConfiguration per account if tenantId provided? For institutional we keep separate but note.
    const effectiveDigest = sha256Hex(canonicalJson(effective));
    const effectiveVersion = sha256Hex(scopeChain.map((s) => `${s.scope}:${s.scopeId}:${s.version}:${s.digest}`).join('|')).slice(0, 16);

    const ruleIds = Array.from(
      new Set([
        'MAX_GROSS_EXPOSURE',
        'MAX_NET_EXPOSURE',
        'MAX_SYMBOL_EXPOSURE',
        'MAX_VENUE_EXPOSURE',
        'MAX_ACCOUNT_EXPOSURE',
        'MAX_STRATEGY_EXPOSURE',
        'MAX_TRADER_EXPOSURE',
        'MAX_FOLLOWER_EXPOSURE',
        'MAX_POSITION_NOTIONAL',
        'MAX_ORDER_NOTIONAL',
        'MAX_OPEN_ORDERS',
        'MAX_LEVERAGE_GROSS',
        'MAX_LEVERAGE_NET',
        'MARGIN_UTILIZATION',
        'LIQUIDATION_DISTANCE',
        'MAX_CONCENTRATION_ASSET',
        'MAX_CONCENTRATION_SYMBOL',
        'MAX_CONCENTRATION_VENUE',
        'MAX_DRAWDOWN',
        'MAX_INTRADAY_DRAWDOWN',
        'DAILY_LOSS_LIMIT',
        'MAX_CORRELATION',
        'VAR_LIMIT',
        'STRESS_LOSS_LIMIT',
        'MARKET_DATA_STALE',
        'EXCHANGE_HEALTH_DEGRADED',
        'EXECUTION_FAILURE_BURST',
        'CIRCUIT_BREAKER_LOSS',
        'COMPLIANCE_BLOCK',
        'SECURITY_BLOCK',
      ]),
    );

    return {
      tenantId: tenantId ?? null,
      scopeChain,
      effectiveVersion,
      effectiveDigest,
      thresholds: effective,
      ruleIds,
      precedence: [RiskPolicyScope.PLATFORM, RiskPolicyScope.TENANT, RiskPolicyScope.TRADER, RiskPolicyScope.STRATEGY, RiskPolicyScope.FOLLOWER],
      resolvedAt: new Date().toISOString(),
      sourcePolicies,
    };
  }

  async upsertPolicy(params: {
    scope: RiskPolicyScope;
    scopeId?: string | null;
    tenantId?: string | null;
    thresholds: Partial<RiskPolicyThresholds>;
    changeReason: string;
    changedByUserId: string;
    actorTenantId: string;
    expectedVersion: number | null;
    idempotencyKey: string;
  }): Promise<{ id: string; version: number; digest: string }> {
    const { scope, scopeId, tenantId, thresholds, changeReason, changedByUserId, actorTenantId, expectedVersion, idempotencyKey } = params;
    if (!actorTenantId || !changedByUserId || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey ?? '') ||
        (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) {
      throw new BadRequestException('A valid retry key and observed policy version are required.');
    }
    if (!changeReason || changeReason.trim().length < 10) {
      throw new BadRequestException('changeReason must be at least 10 characters');
    }
    validateThresholds(thresholds);
    const canonical = canonicalJson(thresholds);
    if (Buffer.byteLength(canonical, 'utf8') > MAX_POLICY_SIZE_BYTES) {
      throw new BadRequestException('Policy payload too large');
    }
    if (/__proto__|constructor|process|require|eval/.test(canonical)) {
      throw new BadRequestException('Policy contains disallowed executable pattern');
    }
    const digest = sha256Hex(canonical);

    if (!Object.values(RiskPolicyScope).includes(scope)) throw new BadRequestException('Invalid policy scope');
    const platform = scope === RiskPolicyScope.PLATFORM;
    const targetTenant = tenantId ?? null;
    const targetScopeId = platform ? null : scope === RiskPolicyScope.TENANT ? (scopeId ?? targetTenant) : (scopeId ?? null);
    if (platform && (targetTenant !== null || scopeId != null)) {
      throw new BadRequestException('PLATFORM scope must not name a tenant or scope id');
    }
    if (!platform && (!targetTenant || !targetScopeId || targetScopeId.length > 128 ||
        (scope === RiskPolicyScope.TENANT && targetScopeId !== targetTenant))) {
      throw new BadRequestException('Policy scope must belong to its tenant');
    }
    if (!platform && scope !== RiskPolicyScope.TENANT && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetScopeId!)) {
      throw new BadRequestException('A valid policy scope identifier is required');
    }
    const retryTenant = targetTenant ?? actorTenantId;
    const keyHash = sha256Hex(idempotencyKey);
    const intentHash = sha256Hex(canonicalJson({ actorTenantId, changedByUserId, scope, targetTenant, targetScopeId,
      thresholds, changeReason, expectedVersion }));
    const where = { scope: scope as any, scopeId: targetScopeId, tenantId: targetTenant };
    const replay = async (tx: Prisma.TransactionClient) => {
      const [record] = await tx.$queryRaw<Array<{ intent_hash: string; policy_id: string }>>`
        SELECT intent_hash, policy_id::text FROM institutional_risk_policy_update_intents
        WHERE tenant_id=${retryTenant}::uuid AND user_id=${changedByUserId}::uuid AND key_hash=${keyHash}`;
      if (!record) return null;
      if (record.intent_hash !== intentHash) throw new ConflictException('Retry key belongs to a different policy update.');
      const saved = await tx.institutionalRiskPolicy.findFirst({ where: { ...where, id: record.policy_id } });
      if (!saved) throw new ServiceUnavailableException('The saved policy revision is unavailable.');
      return { id: saved.id, version: saved.version, digest: saved.digest };
    };
    // A completed retry returns its immutable revision even if the parent
    // policy has since changed. In-flight duplicate requests recheck under the
    // same transaction lock below.
    const previous = await this.prisma.withTenantRls(retryTenant, replay);
    if (previous) return previous;
    const retryLock = JSON.stringify(['institutional-risk-policy-retry', retryTenant, changedByUserId, keyHash]);
    const lockKey = JSON.stringify(['institutional-risk-policy', targetTenant, scope, targetScopeId]);
    const write = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${retryLock}, 0))::text`;
      const existingRetry = await replay(tx);
      if (existingRetry) return existingRetry;
      // Serialize policy writers in a hierarchy: a platform update excludes
      // all tenant writers, while tenant updates also serialize per tenant.
      // Parent validation runs on this very transaction after those locks.
      const hierarchy = 'institutional-risk-policy-hierarchy';
      if (platform) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hierarchy}, 0))::text`;
      else {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${hierarchy}, 0))::text`;
        const tenantLock = JSON.stringify(['institutional-risk-policy-tenant', targetTenant]);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantLock}, 0))::text`;
        const parent = await this.resolveEffectivePolicy({ tenantId: scope === RiskPolicyScope.TENANT ? null : targetTenant }, tx);
        mergeThresholds(parent.thresholds, thresholds, false);
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      if (!platform && scope !== RiskPolicyScope.TENANT) {
        const entityWhere = { id: targetScopeId!, tenantId: targetTenant!, deletedAt: null };
        const exists = scope === RiskPolicyScope.TRADER
          ? await tx.traderProfile.findFirst({ where: entityWhere, select: { id: true } })
          : scope === RiskPolicyScope.FOLLOWER
            ? await tx.user.findFirst({ where: entityWhere, select: { id: true } })
            : await tx.strategy.findFirst({ where: entityWhere, select: { id: true } }) ||
              await tx.traderStrategy.findFirst({ where: entityWhere, select: { id: true } });
        if (!exists) throw new BadRequestException('Policy scope was not found in the target tenant.');
      }
      const existing = await tx.institutionalRiskPolicy.findFirst({ where, orderBy: { version: 'desc' } });
      if ((existing?.version ?? null) !== expectedVersion) throw new ConflictException('Policy changed; reload before updating.');
      const nextVersion = (existing?.version ?? 0) + 1;
      // The partial unique index allows only one active revision. Temporarily
      // deactivate the old one inside this transaction; a later failure rolls
      // it back together with the new revision, retry record and audit.
      await tx.institutionalRiskPolicy.updateMany({ where: { ...where, isActive: true }, data: { isActive: false } });
      const created = await tx.institutionalRiskPolicy.create({
        data: {
          ...where, version: nextVersion, digest, policyJson: thresholds as any,
          ruleIds: Object.keys(thresholds).map((k) => k.toUpperCase()), changeReason, changedByUserId, isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: targetTenant, actorId: changedByUserId, actorType: 'USER', action: 'RISK_POLICY_UPSERT',
          resourceType: 'INSTITUTIONAL_RISK_POLICY', resourceId: created.id,
          description: `Upsert ${scope} ${targetScopeId ?? ''} v${nextVersion} digest ${digest}`,
          changes: { before: existing?.policyJson ?? null, after: thresholds } as any,
        },
      });
      await tx.$executeRaw`
        INSERT INTO institutional_risk_policy_update_intents (tenant_id, user_id, key_hash, intent_hash, policy_id)
        VALUES (${retryTenant}::uuid, ${changedByUserId}::uuid, ${keyHash}, ${intentHash}, ${created.id}::uuid)`;
      return { id: created.id, version: nextVersion, digest };
    };
    // The version, active revision and audit must commit together. A database
    // without permission to write a global policy fails rather than silently
    // creating a tenant policy or omitting the audit.
    const saved = targetTenant ? await this.prisma.withTenantRls(targetTenant, write) : await this.prisma.$transaction(write);
    this.logger.log(`Risk policy upsert ${scope} ${targetScopeId ?? ''} v${saved.version} digest ${digest}`);
    return saved;
  }

  async getPolicyHistory(params: { scope: RiskPolicyScope; scopeId?: string | null; tenantId?: string | null }): Promise<any[]> {
    const platform = params.scope === RiskPolicyScope.PLATFORM;
    if (!platform && !params.tenantId) throw new BadRequestException('Tenant context is required for policy history');
    const query = {
      where: { scope: params.scope as any, scopeId: platform ? null : params.scopeId ?? undefined,
        tenantId: platform ? null : params.tenantId! },
      orderBy: { version: 'desc' as const },
      take: 50,
    };
    return params.tenantId
      ? this.prisma.withTenantRls(params.tenantId, (tx) => tx.institutionalRiskPolicy.findMany(query))
      : this.prisma.institutionalRiskPolicy.findMany(query);
  }
}
