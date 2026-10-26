// # Evaluates every copy intent against the follower's global active-copy budget and the tenant ceiling, returning ALLOW, REDUCE or BLOCK with a stable reason code and exact decimals.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Decimal, DecimalError, maxDecimal } from '../../common/decimal-string';

/**
 * The global active-copy budget.
 *
 * Until now a follower's exposure cap lived per subscription (`maxAllocation`
 * on one `CopySubscription`), so ten subscriptions of 10 000 each were ten
 * separate "max 10 000" decisions and 100 000 of exposure. Nothing in the
 * platform could say "this person may have at most 25 000 of live copy
 * exposure in total", which is the number a follower actually cares about and
 * the only number a risk officer can reason about.
 *
 * This service owns that number. Every copy order is evaluated BEFORE its
 * intent is created, and the answer is one of three things:
 *
 *   ALLOW   - the full notional fits under the remaining budget.
 *   REDUCE  - the order is cut down to exactly the remaining budget, with the
 *             follower quantity floored (never rounded up: rounding a size up
 *             is how a budget is exceeded by a rounding error).
 *   BLOCK   - nothing is left, or the inputs the decision depends on are not
 *             trustworthy (stale equity, unknown FX, unreadable budget).
 *
 * FAIL-CLOSED, IN ORDER OF HOW THE ANSWER IS USED
 * ----------------------------------------------
 * The engine cannot tell the difference between "no cap configured" and "the
 * cap could not be read", so it must not guess. Every read that fails, every
 * equity snapshot that is older than the freshness window, and every currency
 * that is not the budget currency produces BLOCK with a reason code that names
 * which of those it was. A wrong ALLOW spends real money; a wrong BLOCK costs
 * one copy and tells support exactly why.
 *
 * Exact decimals only: `Decimal` (Layer 2 of common/decimal-string) parses
 * strings into unscaled bigints, addition and multiplication are exact, and the
 * only lossy operation - the REDUCE division - states its scale and rounds
 * DOWN. A thousand evaluations of the same inputs produce byte-identical
 * output, which is what `copy-budget.spec.ts` pins.
 */

/** Why a copy was allowed, reduced or blocked. Stable: support quotes these. */
export enum CopyBudgetReasonCode {
  ALLOW_WITHIN_BUDGET = 'ALLOW_WITHIN_BUDGET',
  ALLOW_NO_BUDGET_CONFIGURED = 'ALLOW_NO_BUDGET_CONFIGURED',
  REDUCED_TO_REMAINING_BUDGET = 'REDUCED_TO_REMAINING_BUDGET',
  BLOCKED_BUDGET_EXHAUSTED = 'BLOCKED_BUDGET_EXHAUSTED',
  BLOCKED_EQUITY_UNKNOWN = 'BLOCKED_EQUITY_UNKNOWN',
  BLOCKED_EQUITY_STALE = 'BLOCKED_EQUITY_STALE',
  BLOCKED_CURRENCY_MISMATCH = 'BLOCKED_CURRENCY_MISMATCH',
  BLOCKED_INTENT_INVALID = 'BLOCKED_INTENT_INVALID',
  BLOCKED_BUDGET_UNREADABLE = 'BLOCKED_BUDGET_UNREADABLE',
}

export type CopyBudgetDecisionKind = 'ALLOW' | 'REDUCE' | 'BLOCK';

/** The tenant-wide ceiling lives in `tenant_settings`, not in an env var. */
export const COPY_BUDGET_TENANT_SETTING_KEY = 'copy_budget.tenant_ceiling';

/** Equity older than this is not evidence of anything. 15 minutes. */
export const COPY_BUDGET_EQUITY_MAX_AGE_MS = 15 * 60 * 1000;

/** The intent the budget is evaluated against. All money is a decimal string. */
export interface CopyBudgetIntent {
  tenantId: string;
  userId: string;
  subscriptionId: string;
  traderId: string;
  /**
   * Quote-asset notional of the proposed copy, e.g. `"2500.50"`.
   *
   * Null is allowed and is NOT treated as zero: a copy whose notional could not
   * be computed cannot be budgeted, so it blocks with BLOCKED_INTENT_INVALID
   * rather than passing as a free order.
   */
  notional: string | null;
  /** Quantity of the proposed copy, in the base asset. Null blocks, never zero. */
  quantity: string | null;
  /** Limit/mark price of the proposed copy, or null for a market order. */
  price: string | null;
  /** Quote asset of `notional`. Must equal the budget currency. */
  currency: string;
}

/** Configured limits for one follower. `null` means "no such limit". */
export interface CopyBudgetLimits {
  /** The follower's own cap across all subscriptions. */
  maxActiveExposure: string | null;
  /** Optional per-trader cap inside the global cap. */
  perTraderCap: string | null;
  /** Optional tenant ceiling; the effective cap is the tighter of the two. */
  tenantCeiling: string | null;
  /** Budget currency (quote asset). */
  currency: string;
}

/** One active subscription's committed capital. */
export interface CopyBudgetExposureRow {
  subscriptionId: string;
  traderId: string;
  allocationAmount: string;
}

export interface CopyBudgetDecision {
  decision: CopyBudgetDecisionKind;
  reasonCode: CopyBudgetReasonCode;
  /** Human sentence for the execution row's failureReason. Never a secret. */
  message: string;
  currency: string;
  /** The limit actually applied (min of user cap and tenant ceiling), or null. */
  effectiveCap: string | null;
  committed: string;
  remaining: string;
  requestedNotional: string;
  /** Notional the copy may use: the request on ALLOW, `remaining` on REDUCE. */
  allowedNotional: string;
  /** Quantity to use instead of the requested one on REDUCE, else null. */
  reducedQuantity: string | null;
  /** Age of the equity evidence the decision used, in ms. */
  equityAgeMs: number | null;
  evaluatedAt: string;
}

export interface CopyBudgetView {
  tenantId: string;
  userId: string;
  currency: string;
  maxActiveExposure: string | null;
  perTraderCap: string | null;
  tenantCeiling: string | null;
  effectiveCap: string | null;
  committed: string;
  remaining: string | null;
  utilisationBps: number | null;
  updatedAt: string | null;
}

/** Inputs of the pure evaluation, separated from I/O so the spec can drive it. */
export interface CopyBudgetEvaluationInput {
  intent: CopyBudgetIntent;
  limits: CopyBudgetLimits;
  activeExposures: CopyBudgetExposureRow[];
  /** Timestamp of the newest equity snapshot for this follower, or null. */
  equityObservedAt: Date | null;
  now: Date;
  /** Freshness window; defaults to {@link COPY_BUDGET_EQUITY_MAX_AGE_MS}. */
  equityMaxAgeMs?: number;
}

const DECIMAL_LIKE = /^\d{1,40}(?:\.\d{1,18})?$/;

function isNonNegativeDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_LIKE.test(value.trim())) return false;
  try {
    return !Decimal.parse(value.trim()).isNegative();
  } catch {
    return false;
  }
}

/**
 * Sum of every active subscription's committed capital, exact.
 * An unparseable row is an error, not a zero: silently skipping it would
 * understate exposure and hand out budget that is already spent.
 */
export function sumActiveExposure(rows: readonly CopyBudgetExposureRow[]): Decimal {
  let total = Decimal.ZERO;
  for (const row of rows) {
    if (!isNonNegativeDecimal(row.allocationAmount)) {
      throw new DecimalError(`Active exposure for subscription ${row.subscriptionId} is not an exact decimal string`);
    }
    total = total.add(Decimal.parse(row.allocationAmount.trim()));
  }
  return total;
}

/** The tighter of the follower cap and the tenant ceiling, or null when neither exists. */
export function resolveEffectiveCap(limits: CopyBudgetLimits): Decimal | null {
  const candidates: Decimal[] = [];
  if (limits.maxActiveExposure !== null) {
    if (!isNonNegativeDecimal(limits.maxActiveExposure)) {
      throw new DecimalError('maxActiveExposure is not an exact decimal string');
    }
    candidates.push(Decimal.parse(limits.maxActiveExposure));
  }
  if (limits.tenantCeiling !== null) {
    if (!isNonNegativeDecimal(limits.tenantCeiling)) {
      throw new DecimalError('tenantCeiling is not an exact decimal string');
    }
    candidates.push(Decimal.parse(limits.tenantCeiling));
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((tightest, candidate) => (candidate.lt(tightest) ? candidate : tightest));
}

/**
 * The decision, as a pure function.
 *
 * Order matters and is deliberate: input validity, then currency, then equity
 * freshness, then the budget. A block on a stale equity snapshot explains
 * itself better than the "budget exhausted" it would otherwise be blamed on.
 */
export function evaluateCopyBudget(input: CopyBudgetEvaluationInput): CopyBudgetDecision {
  const { intent, limits } = input;
  const now = input.now;
  const maxAge = input.equityMaxAgeMs ?? COPY_BUDGET_EQUITY_MAX_AGE_MS;
  const currency = limits.currency;

  const base = (decision: CopyBudgetDecisionKind, reasonCode: CopyBudgetReasonCode, message: string, extra: Partial<CopyBudgetDecision> = {}): CopyBudgetDecision => ({
    decision,
    reasonCode,
    message,
    currency,
    effectiveCap: null,
    committed: '0',
    remaining: '0',
    requestedNotional: intent?.notional ?? '0',
    allowedNotional: '0',
    reducedQuantity: null,
    equityAgeMs: input.equityObservedAt === null ? null : Math.max(0, now.getTime() - input.equityObservedAt.getTime()),
    evaluatedAt: now.toISOString(),
    ...extra,
  });

  if (!isNonNegativeDecimal(intent?.notional) || !isNonNegativeDecimal(intent?.quantity)) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_INTENT_INVALID, 'Copy notional or quantity is not an exact decimal string');
  }
  const requestedNotional = Decimal.parse(intent.notional.trim());
  if (requestedNotional.isZero()) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_INTENT_INVALID, 'Copy notional is zero');
  }
  if (intent.currency !== currency) {
    // The whole budget is denominated in one quote asset. Without an FX rate the
    // comparison would be a guess, and a guessed FX rate is a guessed budget.
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_CURRENCY_MISMATCH, `Copy currency ${intent.currency} is not the budget currency ${currency}`);
  }

  // Equity freshness. Stale or absent equity means the follower's own risk state
  // is unknown, and a budget without equity behind it is a number, not a limit.
  const equityAgeMs = input.equityObservedAt === null ? null : now.getTime() - input.equityObservedAt.getTime();
  if (input.equityObservedAt === null || equityAgeMs === null) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_EQUITY_UNKNOWN, 'No equity snapshot is available for this follower');
  }
  if (!Number.isFinite(equityAgeMs) || equityAgeMs > maxAge) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_EQUITY_STALE, `Equity snapshot is ${Math.round((equityAgeMs ?? 0) / 1000)}s old; the budget cannot be evaluated on stale equity`);
  }

  let effectiveCap: Decimal | null;
  let committed: Decimal;
  try {
    effectiveCap = resolveEffectiveCap(limits);
    committed = sumActiveExposure(input.activeExposures);
  } catch (error) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_BUDGET_UNREADABLE, `Budget inputs are not exact: ${(error as Error).message}`);
  }

  if (effectiveCap === null) {
    const remainingWhenUnbounded = '0';
    return base('ALLOW', CopyBudgetReasonCode.ALLOW_NO_BUDGET_CONFIGURED, 'No global copy budget is configured for this follower', {
      committed: committed.toString(),
      remaining: remainingWhenUnbounded,
      allowedNotional: requestedNotional.toString(),
    });
  }

  const remaining = effectiveCap.sub(committed);
  const shared = {
    effectiveCap: effectiveCap.toString(),
    committed: committed.toString(),
    allowedNotional: requestedNotional.toString(),
  };

  if (remaining.isNegative() || remaining.isZero()) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED, 'Active copy exposure already meets or exceeds the configured budget', {
      ...shared,
      remaining: '0',
      allowedNotional: '0',
    });
  }

  // Per-trader cap is inside the global cap: the copy may use the smaller of the
  // remaining global budget and what this trader is still allowed.
  const perTraderRemaining = perTraderBudgetRemaining(limits, input.activeExposures, intent.traderId);
  const usable = perTraderRemaining !== null && perTraderRemaining.lt(remaining) ? perTraderRemaining : remaining;
  if (usable.isNegative() || usable.isZero()) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED, 'The per-trader copy cap for this follower is already fully allocated', {
      ...shared,
      remaining: '0',
      allowedNotional: '0',
    });
  }

  if (requestedNotional.lte(usable)) {
    return base('ALLOW', CopyBudgetReasonCode.ALLOW_WITHIN_BUDGET, 'Copy fits inside the remaining active-copy budget', {
      ...shared,
      remaining: usable.toString(),
    });
  }

  // REDUCE: cut the notional to what is left, then derive the quantity from the
  // ratio with the layer-2 division rounding DOWN at 18 places. Flooring can
  // only reduce exposure; rounding up is how a cap is breached by a wei.
  const requestedQuantity = Decimal.parse(intent.quantity.trim());
  const reducedQuantity = requestedQuantity.mul(usable).div(requestedNotional, 18, 'FLOOR');
  if (reducedQuantity.isZero()) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED, 'The remaining budget is smaller than the venue minimum size for this order', {
      ...shared,
      remaining: usable.toString(),
      allowedNotional: '0',
    });
  }
  return base('REDUCE', CopyBudgetReasonCode.REDUCED_TO_REMAINING_BUDGET, 'Copy reduced to the remaining active-copy budget', {
    ...shared,
    remaining: '0',
    allowedNotional: usable.toString(),
    reducedQuantity: reducedQuantity.toString(),
  });
}

/**
 * What is left under the per-trader cap for one trader, or null when no
 * per-trader cap is configured. Exposures for other traders are ignored, which
 * is the whole point of the cap being per trader.
 */
export function perTraderBudgetRemaining(
  limits: CopyBudgetLimits,
  rows: readonly CopyBudgetExposureRow[],
  traderId: string,
): Decimal | null {
  if (limits.perTraderCap === null) return null;
  if (!isNonNegativeDecimal(limits.perTraderCap)) {
    throw new DecimalError('perTraderCap is not an exact decimal string');
  }
  const cap = Decimal.parse(limits.perTraderCap);
  let used = Decimal.ZERO;
  for (const row of rows) {
    if (row.traderId !== traderId) continue;
    if (!isNonNegativeDecimal(row.allocationAmount)) {
      throw new DecimalError(`Active exposure for subscription ${row.subscriptionId} is not an exact decimal string`);
    }
    used = used.add(Decimal.parse(row.allocationAmount));
  }
  return cap.sub(used);
}

@Injectable()
export class CopyBudgetService {
  private readonly logger = new Logger(CopyBudgetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read the configured limits. A read failure throws; the caller blocks. */
  async loadLimits(tenantId: string, userId: string): Promise<CopyBudgetLimits> {
    const budget = await this.prisma.copyBudget.findFirst({ where: { tenantId, userId } });
    const ceilingSetting = await this.prisma.tenantSetting.findFirst({
      where: { tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
    });
    const ceiling = readCeiling(ceilingSetting?.value);
    return {
      maxActiveExposure: budget ? String(budget.maxActiveExposure) : null,
      perTraderCap: budget?.perTraderCap === null || budget?.perTraderCap === undefined ? null : String(budget.perTraderCap),
      tenantCeiling: ceiling?.amount ?? null,
      currency: ceiling?.currency ?? readBudgetCurrency(budget?.currency) ?? 'USDT',
    };
  }

  /** Every ACTIVE subscription's committed capital for one follower, tenant-scoped. */
  async loadActiveExposure(tenantId: string, userId: string): Promise<CopyBudgetExposureRow[]> {
    const rows = await this.prisma.copySubscription.findMany({
      where: { tenantId, followerId: userId, state: 'ACTIVE' },
      select: { id: true, traderId: true, allocationAmount: true },
    });
    return rows.map((row) => ({ subscriptionId: row.id, traderId: row.traderId, allocationAmount: String(row.allocationAmount) }));
  }

  /** Timestamp of the newest balance snapshot across the follower's accounts. */
  async loadEquityObservedAt(tenantId: string, userId: string): Promise<Date | null> {
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (accounts.length === 0) return null;
    const snapshot = await this.prisma.accountBalanceSnapshot.findFirst({
      where: { tenantId, accountId: { in: accounts.map((account) => account.id) } },
      orderBy: { observedAtMicros: 'desc' },
      select: { observedAtMicros: true },
    });
    if (!snapshot || snapshot.observedAtMicros === null || snapshot.observedAtMicros === undefined) return null;
    // The snapshot carries the venue observation time as integer microseconds -
    // no float, no locale, no timezone. Convert once, at the boundary.
    return new Date(Number(BigInt(snapshot.observedAtMicros) / 1000n));
  }

  /**
   * Evaluate one copy intent. Never throws for a business condition: every
   * refusal is a BLOCK with a reason code. Throws only if asked to evaluate
   * without a tenant or user, which is a programming error.
   */
  async evaluate(intent: CopyBudgetIntent, now: Date = new Date()): Promise<CopyBudgetDecision> {
    if (!intent.tenantId || !intent.userId) {
      throw new Error('CopyBudgetService.evaluate requires a tenant and a user');
    }
    let limits: CopyBudgetLimits;
    let activeExposures: CopyBudgetExposureRow[];
    let equityObservedAt: Date | null;
    try {
      [limits, activeExposures, equityObservedAt] = await Promise.all([
        this.loadLimits(intent.tenantId, intent.userId),
        this.loadActiveExposure(intent.tenantId, intent.userId),
        this.loadEquityObservedAt(intent.tenantId, intent.userId),
      ]);
    } catch (error) {
      this.logger.error(`Copy budget read failed tenant=${intent.tenantId} user=${intent.userId}: ${(error as Error)?.message ?? 'unknown error'}`);
      return {
        decision: 'BLOCK',
        reasonCode: CopyBudgetReasonCode.BLOCKED_BUDGET_UNREADABLE,
        message: 'The copy budget could not be read; the copy was refused rather than guessed at',
        currency: 'USDT',
        effectiveCap: null,
        committed: '0',
        remaining: '0',
        requestedNotional: intent.notional ?? '0',
        allowedNotional: '0',
        reducedQuantity: null,
        equityAgeMs: null,
        evaluatedAt: now.toISOString(),
      };
    }
    return evaluateCopyBudget({ intent, limits, activeExposures, equityObservedAt, now });
  }

  /** The customer-facing view: the cap, what is committed and what is left. */
  async getView(tenantId: string, userId: string): Promise<CopyBudgetView> {
    const [limits, activeExposures] = await Promise.all([
      this.loadLimits(tenantId, userId),
      this.loadActiveExposure(tenantId, userId),
    ]);
    const effectiveCap = resolveEffectiveCap(limits);
    const committed = sumActiveExposure(activeExposures);
    const remaining = effectiveCap === null ? null : maxDecimal(effectiveCap.sub(committed), Decimal.ZERO);
    const utilisationBps = effectiveCap === null || effectiveCap.isZero()
      ? null
      : Number(committed.mul(10_000).div(effectiveCap, 0, 'FLOOR').toString());
    const budget = await this.prisma.copyBudget.findFirst({ where: { tenantId, userId }, select: { updatedAt: true } });
    return {
      tenantId,
      userId,
      currency: limits.currency,
      maxActiveExposure: limits.maxActiveExposure,
      perTraderCap: limits.perTraderCap,
      tenantCeiling: limits.tenantCeiling,
      effectiveCap: effectiveCap === null ? null : effectiveCap.toString(),
      committed: committed.toString(),
      remaining: remaining === null ? null : remaining.toString(),
      utilisationBps,
      updatedAt: budget?.updatedAt ? budget.updatedAt.toISOString() : null,
    };
  }

  /** Upsert the follower's cap. The DTO has already validated the strings. */
  async upsertLimits(input: {
    tenantId: string;
    userId: string;
    maxActiveExposure: string;
    perTraderCap?: string | null;
    currency: string;
  }): Promise<CopyBudgetView> {
    const [tenantCeilingRow] = await Promise.all([
      this.prisma.tenantSetting.findFirst({ where: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY } }),
    ]);
    const ceiling = readCeiling(tenantCeilingRow?.value);
    if (ceiling !== null && Decimal.parse(input.maxActiveExposure).gt(Decimal.parse(ceiling.amount))) {
      // A follower cap above the ceiling is not harmful (the ceiling wins), but
      // storing it invites the customer to believe they can raise it themselves.
      throw new Error(`maxActiveExposure exceeds the tenant ceiling of ${ceiling.amount} ${ceiling.currency}`);
    }
    const data = {
      maxActiveExposure: input.maxActiveExposure,
      perTraderCap: input.perTraderCap ?? null,
      currency: input.currency,
    };
    await this.prisma.copyBudget.upsert({
      where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
      create: { tenantId: input.tenantId, userId: input.userId, ...data },
      update: data,
    });
    return this.getView(input.tenantId, input.userId);
  }
}

function readBudgetCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z0-9]{2,12}$/.test(value) ? value : null;
}

/** The tenant ceiling as stored in `tenant_settings.value`, or null when absent/malformed. */
export function readCeiling(value: unknown): { amount: string; currency: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const amount = record.amount ?? record.maxActiveExposure;
  const currency = record.currency;
  if (!isNonNegativeDecimal(amount)) return null;
  if (typeof currency !== 'string' || !/^[A-Z0-9]{2,12}$/.test(currency)) return null;
  return { amount: (amount as string).trim(), currency };
}
