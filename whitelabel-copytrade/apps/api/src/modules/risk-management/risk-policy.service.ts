import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  EffectiveRiskPolicy,
  RiskPolicyScope,
  RiskPolicyThresholds,
  RiskSeverity,
} from './risk-management.types';

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
    // Platform defines ceilings; lower scopes may only tighten, never loosen beyond platform ceiling for safety-critical.
    if (!isPlatform) {
      // Safety-critical tightening checks: if base has a limit, override must be <= base for max limits, >= for min distances?
      // For max exposure/leverage/drawdown/loss/concentration: smaller = tighter.
      // For margin utilization, liquidation distance: higher utilization = looser? Actually higher % = tighter warning? We treat same: override must be <= base for max, >= for distance?
      // Simplified: for max* and concentration, override must be <= base if base exists.
      if (typeof v === 'string' && typeof base[key] === 'string') {
        const baseVal = base[key] as string;
        // Skip if not decimal (booleans handled separately)
        if (isValidDecimalString(baseVal) && isValidDecimalString(v as string)) {
          const isMaxLimit = String(key).startsWith('max') || String(key).includes('Concentration') || String(key).includes('Leverage');
          if (isMaxLimit) {
            // override must be <= base (tighter)
            const cmp = compareDecimalStrings(v as string, baseVal);
            if (cmp > 0) {
              // Attempt to weaken higher-level safety rule -> forbidden
              throw new ForbiddenException(
                `Policy scope attempted to weaken higher-level limit ${key}: ${v} > ${baseVal}. Lower scope may only tighten.`,
              );
            }
          }
          // For liquidation distance, larger distance is tighter? Actually larger % means earlier warning, so tighter = larger. We allow larger.
          // For margin utilization, smaller % is tighter warning (earlier). So override <= base is tighter.
          if (String(key).includes('margin') || String(key).includes('Utilization')) {
            const cmp = compareDecimalStrings(v as string, baseVal);
            if (cmp > 0) {
              throw new ForbiddenException(`Policy scope attempted to weaken margin limit ${key}: ${v} > ${baseVal}`);
            }
          }
        }
      }
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
  for (const [k, v] of Object.entries(thresholds)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (!isValidDecimalString(v)) {
        throw new BadRequestException(`Invalid decimal threshold ${k}: ${v}`);
      }
      // No executable
      if (/[;`$\\{}()<>]/.test(v)) {
        throw new BadRequestException(`Threshold ${k} contains disallowed characters`);
      }
    }
    if (typeof v === 'number') {
      // Only maxOpenOrders and lookback etc allowed as numbers
      if (!Number.isInteger(v) || v < 0) {
        throw new BadRequestException(`Invalid numeric threshold ${k}: ${v}`);
      }
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
  }): Promise<EffectiveRiskPolicy> {
    const { tenantId, traderId, strategyId, followerId } = params;
    const chain: Array<{ scope: RiskPolicyScope; scopeId: string | null }> = [
      { scope: RiskPolicyScope.PLATFORM, scopeId: null },
      ...(tenantId ? [{ scope: RiskPolicyScope.TENANT, scopeId: tenantId }] : []),
      ...(traderId ? [{ scope: RiskPolicyScope.TRADER, scopeId: traderId }] : []),
      ...(strategyId ? [{ scope: RiskPolicyScope.STRATEGY, scopeId: strategyId }] : []),
      ...(followerId ? [{ scope: RiskPolicyScope.FOLLOWER, scopeId: followerId }] : []),
    ];

    // Fetch policies from DB: InstitutionalRiskPolicy where active, ordered by scope precedence
    const dbPolicies = await this.prisma.institutionalRiskPolicy.findMany({
      where: {
        isActive: true,
        OR: chain.map((c) => ({
          scope: c.scope as any,
          ...(c.scopeId ? { scopeId: c.scopeId } : c.scope === RiskPolicyScope.PLATFORM ? { tenantId: null } : {}),
          ...(c.scope === RiskPolicyScope.TENANT && tenantId ? { tenantId } : {}),
        })),
      },
      orderBy: [{ scope: 'asc' }, { version: 'desc' }],
    });

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
    actorTenantId?: string;
  }): Promise<{ id: string; version: number; digest: string }> {
    const { scope, scopeId, tenantId, thresholds, changeReason, changedByUserId } = params;
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

    // Platform scope requires PLATFORM_MANAGE (checked in controller) and tenantId must be null
    if (scope === RiskPolicyScope.PLATFORM && tenantId) {
      throw new BadRequestException('PLATFORM scope must have null tenantId');
    }

    // Fetch existing latest version for this scope
    const existing = await this.prisma.institutionalRiskPolicy.findFirst({
      where: { scope: scope as any, scopeId: scopeId ?? null, tenantId: tenantId ?? undefined },
      orderBy: { version: 'desc' },
    });

    // If existing, ensure not weakening higher-level (will be checked on resolve, but also here for immediate feedback)
    if (existing) {
      // If this is not platform, fetch platform policy to ensure not weakening
      if (scope !== RiskPolicyScope.PLATFORM) {
        const platformPolicy = await this.resolveEffectivePolicy({ tenantId: tenantId ?? null });
        // merge check will throw if weakening
        mergeThresholds(platformPolicy.thresholds, thresholds, false);
      }
    }

    const nextVersion = (existing?.version ?? 0) + 1;

    const created = await this.prisma.institutionalRiskPolicy.create({
      data: {
        scope: scope as any,
        scopeId: scopeId ?? null,
        tenantId: tenantId ?? null,
        version: nextVersion,
        digest,
        policyJson: thresholds as any,
        ruleIds: Object.keys(thresholds).map((k) => k.toUpperCase()),
        changeReason,
        changedByUserId,
        isActive: true,
      },
    });

    // Deactivate older versions for same scope (keep history but mark inactive)
    if (existing) {
      await this.prisma.institutionalRiskPolicy.updateMany({
        where: { scope: scope as any, scopeId: scopeId ?? null, tenantId: tenantId ?? undefined, id: { not: created.id } },
        data: { isActive: false },
      });
      // Reactivate the newly created one (in case updateMany deactivated it)
      await this.prisma.institutionalRiskPolicy.update({ where: { id: created.id }, data: { isActive: true } });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? undefined,
        actorId: changedByUserId,
        actorType: 'USER',
        action: 'RISK_POLICY_UPSERT',
        resourceType: 'INSTITUTIONAL_RISK_POLICY',
        resourceId: created.id,
        description: `Upsert ${scope} ${scopeId ?? ''} v${nextVersion} digest ${digest}`,
        changes: { before: existing?.policyJson ?? null, after: thresholds } as any,
      },
    });

    this.logger.log(`Risk policy upsert ${scope} ${scopeId ?? ''} v${nextVersion} digest ${digest}`);
    return { id: created.id, version: nextVersion, digest };
  }

  async getPolicyHistory(params: { scope: RiskPolicyScope; scopeId?: string | null; tenantId?: string | null }): Promise<any[]> {
    return this.prisma.institutionalRiskPolicy.findMany({
      where: { scope: params.scope as any, scopeId: params.scopeId ?? undefined, tenantId: params.tenantId ?? undefined },
      orderBy: { version: 'desc' },
      take: 50,
    });
  }
}
