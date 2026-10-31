// # Reads the configured copy budget and fails closed when live exposure or atomic reservations cannot be verified.
import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Decimal, DecimalError, maxDecimal } from '../../common/decimal-string';
import { assertNoActiveCopyIntents } from './copy-budget-admission';

/**
 * Subscription allocation values are not verified live exposure: they can use
 * different units and omit positions or pending orders. There is also no atomic
 * reservation with the downstream order intent. Consequently configured budgets
 * must not issue a production ALLOW or REDUCE until those sources and a shared
 * reservation lifecycle are available. The pure decimal calculation below is an
 * estimate only; evaluate() enforces this safety gate for the execution path.
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
  BLOCKED_EXPOSURE_UNVERIFIED = 'BLOCKED_EXPOSURE_UNVERIFIED',
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
  /** Explicitly configured quote asset; null when no currency is configured. */
  currency: string | null;
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
  /** Null when live exposure and remaining budget have not been verified. */
  committed: string | null;
  remaining: string | null;
  requestedNotional: string | null;
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
  currency: string | null;
  maxActiveExposure: string | null;
  perTraderCap: string | null;
  tenantCeiling: string | null;
  effectiveCap: string | null;
  /** Allocation values, not a live position or verified exposure measure. */
  committed: string | null;
  exposureStatus: 'ALLOCATION_ESTIMATE' | 'UNAVAILABLE';
  remaining: string | null;
  utilisationBps: number | null;
  updatedAt: string | null;
}

/** The tenant ceiling as an operator sees it, including why it may be unusable. */
export interface TenantDefaultCapsView {
  /** The configured ceiling, or null when none is usable. */
  maxActiveExposure: string | null;
  currency: string | null;
  updatedAt: string | null;
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'CONFIGURATION_UNREADABLE';
}

/** One follower's position against their effective cap, for the operator console. */
export interface OverCapUserRow {
  userId: string;
  /** The follower's email, or null when the account is deleted or unreadable. */
  label: string | null;
  currency: string | null;
  maxActiveExposure: string;
  perTraderCap: string | null;
  tenantCeiling: string | null;
  effectiveCap: string;
  /** Null when the follower's subscriptions mix allocation units and cannot be summed. */
  committed: string | null;
  utilisationBps: number | null;
  state: 'OVER' | 'NEAR' | 'UNMEASURABLE';
}

/** Page ceiling for the over-cap list: it is evaluated in memory, not by the database. */
export const MAX_OVER_CAP_LIMIT = 200;

/** "Near" means at or above 90% of the effective cap unless the caller says otherwise. */
export const DEFAULT_NEAR_THRESHOLD_BPS = 9_000;

/** Percentage allocations are ratios, not amounts; adding them to money is unsafe. */
class UnverifiedAllocationUnitsError extends Error {}

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
  // With no configured budget, use the intent's quote only for this decision;
  // it is not evidence of a configured account currency.
  const currency = limits.currency ?? intent.currency;

  const base = (decision: CopyBudgetDecisionKind, reasonCode: CopyBudgetReasonCode, message: string, extra: Partial<CopyBudgetDecision> = {}): CopyBudgetDecision => ({
    decision,
    reasonCode,
    message,
    currency,
    effectiveCap: null,
    committed: null,
    remaining: null,
    requestedNotional: intent?.notional ?? null,
    allowedNotional: '0',
    reducedQuantity: null,
    equityAgeMs: input.equityObservedAt === null ? null : Math.max(0, now.getTime() - input.equityObservedAt.getTime()),
    evaluatedAt: now.toISOString(),
    ...extra,
  });

  if (!readBudgetCurrency(currency) || !isNonNegativeDecimal(intent?.notional) || !isNonNegativeDecimal(intent?.quantity)) {
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
  if (!Number.isFinite(equityAgeMs) || equityAgeMs < 0 || equityAgeMs > maxAge) {
    return base('BLOCK', CopyBudgetReasonCode.BLOCKED_EQUITY_STALE, 'Equity snapshot timing is outside the allowed freshness window; the budget cannot be evaluated');
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
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException('Copy budget user not found.');
      const budget = await tx.copyBudget.findFirst({ where: { tenantId, userId } });
      const ceilingSetting = await tx.tenantSetting.findFirst({
        where: { tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
      });
      const ceiling = readCeiling(ceilingSetting?.value);
      if (ceilingSetting && !ceiling) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      const budgetCurrency = readBudgetCurrency(budget?.currency);
      if (budget && !budgetCurrency) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      if (ceiling && budgetCurrency && ceiling.currency !== budgetCurrency) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      return {
        maxActiveExposure: budget ? String(budget.maxActiveExposure) : null,
        perTraderCap: budget?.perTraderCap === null || budget?.perTraderCap === undefined ? null : String(budget.perTraderCap),
        tenantCeiling: ceiling?.amount ?? null,
        currency: ceiling?.currency ?? budgetCurrency ?? null,
      };
    });
  }

  /**
   * The tenant ceiling as an operator sees it: the raw stored setting plus any
   * reason it cannot be used. Unlike `loadLimits` this never throws for a
   * follower who has no budget - an operator opening the console needs to know
   * "nobody has a ceiling configured", not a 404.
   *
   * A ceiling row that exists but cannot be parsed is reported as
   * `CONFIGURATION_UNREADABLE` rather than as `null`, because the two mean
   * opposite things to the person about to edit it: one is "set it", the other is
   * "somebody already set something and we cannot read it - do not overwrite it
   * blind".
   */
  async getTenantDefaultCaps(tenantId: string): Promise<TenantDefaultCapsView> {
    const { row, ceiling } = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const setting = await tx.tenantSetting.findFirst({
        where: { tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
        select: { value: true, isSecret: true, updatedAt: true },
      });
      return { row: setting, ceiling: readCeiling(setting?.value) };
    });

    if (!row) {
      return { currency: null, maxActiveExposure: null, updatedAt: null, status: 'NOT_CONFIGURED' };
    }
    if (row.isSecret || !ceiling) {
      return { currency: null, maxActiveExposure: null, updatedAt: row.updatedAt.toISOString(), status: 'CONFIGURATION_UNREADABLE' };
    }
    return {
      currency: ceiling.currency,
      maxActiveExposure: ceiling.amount,
      updatedAt: row.updatedAt.toISOString(),
      status: 'CONFIGURED',
    };
  }

  /**
   * Replaces the tenant ceiling.
   *
   * The write is the same one `upsertLimits` compares against
   * (`tenant_settings[key=copy_budget.tenant_ceiling].value = {amount, currency}`)
   * - there is deliberately no second representation of a ceiling. Two decisions
   * are made here rather than by the caller:
   *
   *   * the advisory lock is the same shared lock every follower's cap write
   *     takes on this key, so a ceiling change cannot interleave with a cap write
   *     that reads it;
   *   * a ceiling that is already configured in a different currency is refused
   *     instead of silently re-denominating every follower's cap. `CopyBudget`
   *     rows carry their own currency and `upsertLimits` rejects a cap whose
   *     currency differs from the ceiling, so re-denominating the ceiling would
   *     strand every existing cap. Moving a tenant to another quote asset is a
   *     migration, not a console edit.
   */
  async setTenantDefaultCaps(input: {
    tenantId: string;
    maxActiveExposure: string;
    perTraderCap?: string | null;
    currency: string;
    actorId: string;
  }): Promise<TenantDefaultCapsView> {
    const amount = Decimal.parse(input.maxActiveExposure).toString();
    const perTraderCap =
      input.perTraderCap === null || input.perTraderCap === undefined ? null : Decimal.parse(input.perTraderCap).toString();
    if (perTraderCap !== null && Decimal.parse(perTraderCap).gt(Decimal.parse(amount))) {
      // A per-trader cap above the tenant ceiling is not a policy anyone means to
      // set; it would be silently capped at the tenant level and mislead later.
      throw new UnprocessableEntityException('perTraderCap must not exceed maxActiveExposure');
    }

    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const ceilingLock = `copy-budget-ceiling:${input.tenantId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ceilingLock}, 0))::text`;
      const existing = await tx.tenantSetting.findFirst({
        where: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
        select: { value: true, isSecret: true },
      });
      if (existing?.isSecret) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      const current = readCeiling(existing?.value);
      if (existing && !current) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      if (current && current.currency !== input.currency) {
        throw new UnprocessableEntityException(
          `The tenant ceiling is configured in ${current.currency}; changing the quote asset is a data migration, not a setting update.`,
        );
      }
      const value = perTraderCap === null ? { amount, currency: input.currency } : { amount, perTraderCap, currency: input.currency };
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY } },
        create: {
          tenantId: input.tenantId,
          key: COPY_BUDGET_TENANT_SETTING_KEY,
          value,
          category: 'copy_trading',
          isSecret: false,
          description: 'Copy-trading tenant ceiling: the maximum active exposure any follower cap may resolve to.',
        },
        update: { value, isSecret: false },
      });
    });

    return this.getTenantDefaultCaps(input.tenantId);
  }

  /**
   * Followers at or above a share of their effective cap, or above it.
   *
   * Each row is computed with the SAME primitives the execution path uses
   * (`resolveEffectiveCap` over the follower's `CopyBudget` plus the tenant
   * ceiling, and `sumActiveExposure` over the active subscription allocations), so
   * the operator's list and the customer's "remaining" figure cannot disagree.
   *
   * `total` is the number of followers that matched before paging - it is counted
   * after evaluation, not taken from a `count()` on a filter the database cannot
   * express (the effective cap is the tighter of two numbers, one of them a JSON
   * setting). The page therefore reads every matching `CopyBudget` row for the
   * tenant; that is bounded by the number of followers with a configured budget,
   * which is the only population this list can describe.
   */
  async listOverCapUsers(input: {
    tenantId: string;
    page?: number;
    limit?: number;
    utilisationBps?: number;
    status?: 'OVER' | 'NEAR';
  }): Promise<{ data: OverCapUserRow[]; total: number }> {
    const page = input.page && input.page > 0 ? input.page : 1;
    const limit = input.limit && input.limit > 0 ? Math.min(input.limit, MAX_OVER_CAP_LIMIT) : 20;
    const thresholdBps = input.utilisationBps ?? DEFAULT_NEAR_THRESHOLD_BPS;

    const { ceiling, budgets, exposures, labels } = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const setting = await tx.tenantSetting.findFirst({
        where: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
        select: { value: true, isSecret: true },
      });
      const parsedCeiling = readCeiling(setting?.value);
      if (setting && (setting.isSecret || !parsedCeiling)) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      const rows = await tx.copyBudget.findMany({
        where: { tenantId: input.tenantId },
        select: { userId: true, maxActiveExposure: true, perTraderCap: true, currency: true },
        orderBy: { updatedAt: 'desc' },
      });
      const userIds = rows.map((row) => row.userId);
      if (userIds.length === 0) {
        return { ceiling: parsedCeiling, budgets: [], exposures: [], labels: new Map<string, string>() };
      }
      const subscriptions = await tx.copySubscription.findMany({
        where: { tenantId: input.tenantId, followerId: { in: userIds }, state: 'ACTIVE' },
        select: { followerId: true, id: true, traderId: true, allocationAmount: true, allocationMode: true },
      });
      const users = await tx.user.findMany({
        where: { tenantId: input.tenantId, id: { in: userIds }, deletedAt: null },
        select: { id: true, email: true },
      });
      return {
        ceiling: parsedCeiling,
        budgets: rows,
        exposures: subscriptions,
        labels: new Map(users.map((user) => [user.id, user.email])),
      };
    });

    const rows: OverCapUserRow[] = [];
    for (const budget of budgets) {
      const limits: CopyBudgetLimits = {
        maxActiveExposure: String(budget.maxActiveExposure),
        perTraderCap: budget.perTraderCap === null || budget.perTraderCap === undefined ? null : String(budget.perTraderCap),
        tenantCeiling: ceiling?.amount ?? null,
        currency: ceiling?.currency ?? budget.currency ?? null,
      };
      const effectiveCap = resolveEffectiveCap(limits);
      if (effectiveCap === null || effectiveCap.isZero()) continue;

      const own = exposures.filter((row) => row.followerId === budget.userId);
      // Percentage allocations cannot be summed with fixed amounts; a follower
      // whose subscriptions mix units is reported as unmeasurable rather than
      // ranked on a number that is not comparable.
      const measurable = own.every((row) => row.allocationMode === 'FIXED' || row.allocationMode === 'PROPORTIONAL');
      let committed: Decimal | null = null;
      if (measurable) {
        try {
          committed = sumActiveExposure(
            own.map((row) => ({ subscriptionId: row.id, traderId: row.traderId, allocationAmount: String(row.allocationAmount) })),
          );
        } catch (error) {
          if (!(error instanceof DecimalError)) throw error;
          committed = null;
        }
      }
      const utilisationBps =
        committed === null
          ? null
          : Number(committed.mul(10_000).div(effectiveCap, 0, 'FLOOR').toString());
      const over = committed !== null && committed.gt(effectiveCap);
      const near = committed !== null && !over && utilisationBps !== null && utilisationBps >= thresholdBps;
      if (input.status === 'OVER' && !over) continue;
      if (input.status === 'NEAR' && !near) continue;
      if (input.status === undefined && !over && !near) continue;

      rows.push({
        userId: budget.userId,
        label: labels.get(budget.userId) ?? null,
        currency: limits.currency,
        // `CopyBudget.maxActiveExposure` is non-nullable, so the row's own cap is
        // always present here; the null case can only come from a ceiling-only view.
        maxActiveExposure: String(budget.maxActiveExposure),
        perTraderCap: limits.perTraderCap,
        tenantCeiling: limits.tenantCeiling,
        effectiveCap: effectiveCap.toString(),
        committed: committed === null ? null : committed.toString(),
        utilisationBps: utilisationBps !== null && Number.isSafeInteger(utilisationBps) ? utilisationBps : null,
        state: over ? 'OVER' : near ? 'NEAR' : 'UNMEASURABLE',
      });
    }

    // Worst first: an over-cap follower needs attention before a near-cap one.
    rows.sort((left, right) => {
      const rank = (row: OverCapUserRow) => (row.state === 'OVER' ? 0 : row.state === 'NEAR' ? 1 : 2);
      if (rank(left) !== rank(right)) return rank(left) - rank(right);
      return (right.utilisationBps ?? -1) - (left.utilisationBps ?? -1);
    });

    const start = (page - 1) * limit;
    return { data: rows.slice(start, start + limit), total: rows.length };
  }

  /** Every ACTIVE subscription's committed capital for one follower, tenant-scoped. */
  async loadActiveExposure(tenantId: string, userId: string): Promise<CopyBudgetExposureRow[]> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const rows = await tx.copySubscription.findMany({
        where: { tenantId, followerId: userId, state: 'ACTIVE' },
        select: { id: true, traderId: true, allocationAmount: true, allocationMode: true },
      });
      // PERCENTAGE_BALANCE is a percentage, not quote-asset capital. Mixing it
      // with fixed amounts silently understates/overstates budget consumption.
      if (rows.some((row) => row.allocationMode !== 'FIXED' && row.allocationMode !== 'PROPORTIONAL')) {
        throw new UnverifiedAllocationUnitsError('Active allocation units cannot be compared safely');
      }
      return rows.map((row) => ({ subscriptionId: row.id, traderId: row.traderId, allocationAmount: String(row.allocationAmount) }));
    });
  }

  /** Timestamp of the newest balance snapshot across the follower's accounts. */
  async loadEquityObservedAt(tenantId: string, userId: string): Promise<Date | null> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const accounts = await tx.tradingAccount.findMany({
        where: { tenantId, userId, deletedAt: null },
        select: { id: true },
      });
      if (accounts.length === 0) return null;
      const snapshot = await tx.accountBalanceSnapshot.findFirst({
        where: { tenantId, accountId: { in: accounts.map((account) => account.id) } },
        orderBy: { observedAtMicros: 'desc' },
        select: { observedAtMicros: true },
      });
      if (!snapshot || snapshot.observedAtMicros === null || snapshot.observedAtMicros === undefined) return null;
      // The observation is an integer microsecond timestamp; never use floating
      // point arithmetic for account balances.
      return new Date(Number(BigInt(snapshot.observedAtMicros) / 1000n));
    });
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
        currency: readBudgetCurrency(intent.currency) ?? 'UNKNOWN',
        effectiveCap: null,
        committed: null,
        remaining: null,
        requestedNotional: intent.notional ?? null,
        allowedNotional: '0',
        reducedQuantity: null,
        equityAgeMs: null,
        evaluatedAt: now.toISOString(),
      };
    }
    const estimate = evaluateCopyBudget({ intent, limits, activeExposures, equityObservedAt, now });
    const hasConfiguredLimit = limits.maxActiveExposure !== null || limits.tenantCeiling !== null || limits.perTraderCap !== null;
    if (hasConfiguredLimit && (estimate.decision !== 'BLOCK' || estimate.reasonCode === CopyBudgetReasonCode.BLOCKED_BUDGET_EXHAUSTED)) {
      // A sum of allocations cannot prove the currency or amount of current
      // positions, nor reserve headroom against a concurrent copy. Never let an
      // estimate authorise a real order or imply a verified zero balance.
      return { ...estimate, decision: 'BLOCK', reasonCode: CopyBudgetReasonCode.BLOCKED_EXPOSURE_UNVERIFIED,
        message: 'Copy orders with a configured budget are blocked because live exposure and order reservations are not verified.',
        committed: null, remaining: null, allowedNotional: '0', reducedQuantity: null };
    }
    // Even an unbounded decision does not verify the displayed allocation sum.
    if (!hasConfiguredLimit) return { ...estimate, committed: null, remaining: null };
    return estimate;
  }

  /** The customer-facing view: the cap, what is committed and what is left. */
  async getView(tenantId: string, userId: string): Promise<CopyBudgetView> {
    const limits = await this.loadLimits(tenantId, userId);
    let activeExposures: CopyBudgetExposureRow[] | null;
    try {
      activeExposures = await this.loadActiveExposure(tenantId, userId);
    } catch (error) {
      if (!(error instanceof UnverifiedAllocationUnitsError)) throw error;
      activeExposures = null;
    }
    const effectiveCap = resolveEffectiveCap(limits);
    const committed = activeExposures === null ? null : sumActiveExposure(activeExposures);
    const remaining = effectiveCap === null || committed === null ? null : maxDecimal(effectiveCap.sub(committed), Decimal.ZERO);
    const rawBps = effectiveCap === null || effectiveCap.isZero() || committed === null
      ? null
      : Number(committed.mul(10_000).div(effectiveCap, 0, 'FLOOR').toString());
    const utilisationBps = rawBps !== null && Number.isSafeInteger(rawBps) ? rawBps : null;
    const budget = await this.prisma.withTenantRls(tenantId, (tx) =>
      tx.copyBudget.findFirst({ where: { tenantId, userId }, select: { updatedAt: true } }),
    );
    return {
      tenantId,
      userId,
      currency: limits.currency,
      maxActiveExposure: limits.maxActiveExposure,
      perTraderCap: limits.perTraderCap,
      tenantCeiling: limits.tenantCeiling,
      effectiveCap: effectiveCap === null ? null : effectiveCap.toString(),
      committed: committed === null ? null : committed.toString(),
      exposureStatus: committed === null ? 'UNAVAILABLE' : 'ALLOCATION_ESTIMATE',
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
    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const ceilingLock = `copy-budget-ceiling:${input.tenantId}`;
      const lockName = `copy-budget:${input.tenantId}:${input.userId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ceilingLock}, 0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))::text`;
      const user = await tx.user.findFirst({ where: { tenantId: input.tenantId, id: input.userId, deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException('Copy budget user not found.');
      const tenantCeilingRow = await tx.tenantSetting.findFirst({
        where: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY },
      });
      const ceiling = readCeiling(tenantCeilingRow?.value);
      if (tenantCeilingRow && !ceiling) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      if (ceiling && input.currency !== ceiling.currency) {
        throw new UnprocessableEntityException('Budget currency must match the tenant ceiling currency.');
      }
      if (ceiling !== null && Decimal.parse(input.maxActiveExposure).gt(Decimal.parse(ceiling.amount))) {
        // A follower cap above the ceiling would mislead the customer even
        // though the effective ceiling would remain the tighter limit.
        throw new UnprocessableEntityException(`maxActiveExposure exceeds the tenant ceiling of ${ceiling.amount} ${ceiling.currency}`);
      }
      await assertNoActiveCopyIntents(tx, input.tenantId, input.userId);
      const data = {
        maxActiveExposure: input.maxActiveExposure,
        perTraderCap: input.perTraderCap ?? null,
        currency: input.currency,
      };
      await tx.copyBudget.upsert({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        create: { tenantId: input.tenantId, userId: input.userId, ...data },
        update: data,
      });
    });
    return this.getView(input.tenantId, input.userId);
  }

  /**
   * A phone may make its owner's ceiling stricter, never wider or clear it.
   * Competing reductions serialize with the existing writer, and an old retry
   * never overwrites a newer decision. The intent and cap commit together.
   */
  async reduceLimit(input: { tenantId: string; userId: string; maxActiveExposure: string; currency: string; idempotencyKey: string }): Promise<CopyBudgetView> {
    if (!/^\d{1,16}(?:\.\d{1,12})?$/.test(input.maxActiveExposure) ||
        !readBudgetCurrency(input.currency) ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
      throw new UnprocessableEntityException('Invalid budget reduction.');
    }
    const requested = Decimal.parse(input.maxActiveExposure).toString();
    const keyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const ceilingLock = `copy-budget-ceiling:${input.tenantId}`;
      const lockName = `copy-budget:${input.tenantId}:${input.userId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ceilingLock}, 0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))::text`;
      const user = await tx.user.findFirst({ where: { tenantId: input.tenantId, id: input.userId, deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException('Copy budget user not found.');
      const previousIntent = await tx.copyBudgetReductionIntent.findUnique({
        where: { tenantId_userId_keyHash: { tenantId: input.tenantId, userId: input.userId, keyHash } },
      });
      if (previousIntent) {
        if (previousIntent.requestedExposure.toString() !== requested || previousIntent.currency !== input.currency) throw new ConflictException('Request key was used for a different budget reduction.');
        return;
      }
      const current = await tx.copyBudget.findUnique({ where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } } });
      const setting = await tx.tenantSetting.findFirst({ where: { tenantId: input.tenantId, key: COPY_BUDGET_TENANT_SETTING_KEY } });
      const ceiling = readCeiling(setting?.value);
      if (setting && !ceiling) throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      const currency = current?.currency ?? ceiling?.currency ?? null;
      if (!currency || !readBudgetCurrency(currency) || (ceiling && ceiling.currency !== currency)) {
        throw new ServiceUnavailableException('Copy budget configuration is unavailable.');
      }
      if (currency !== input.currency) throw new ConflictException('The budget currency changed; refresh before reducing it.');
      const next = Decimal.parse(requested);
      if ((current && next.gt(Decimal.parse(current.maxActiveExposure.toString()))) ||
          (ceiling && next.gt(Decimal.parse(ceiling.amount)))) {
        throw new ConflictException('A reduction cannot raise the current budget or tenant ceiling.');
      }
      await assertNoActiveCopyIntents(tx, input.tenantId, input.userId);
      await tx.copyBudget.upsert({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        create: { tenantId: input.tenantId, userId: input.userId, maxActiveExposure: requested, currency },
        update: { maxActiveExposure: requested },
      });
      await tx.copyBudgetReductionIntent.create({ data: {
        tenantId: input.tenantId, userId: input.userId, keyHash, requestedExposure: requested,
        previousExposure: current?.maxActiveExposure ?? null, currency,
      } });
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
