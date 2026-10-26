// # Responsibility: reduces a stored exchange account into a per-capability health matrix an operator or customer can act on.
//
// WHY THIS IS NOT `healthState`
// -----------------------------
// `ExchangeAccount.healthState` answers "is this key working?". It cannot answer
// "what is this key allowed to do, and is that what we asked for?" - and those
// are different questions with different consequences. A key that authenticates
// perfectly and can withdraw funds is HEALTHY by any latency measure and is still
// the single worst thing that can be connected to a copy-trading platform.
//
// The matrix therefore has one row per capability (READ, TRADE, WITHDRAW, MARGIN)
// and each row carries its own verdict, because the truthful answer is often
// mixed: reads are fine, trading is refused by the venue, withdrawals are
// possible. Collapsing that into one word is how a screen ends up showing a green
// tick for an account that cannot place an order.
//
// THE FOUR RULES THAT MAKE THIS FAIL CLOSED
// -----------------------------------------
//   1. Never verified is UNKNOWN, not absent. A capability nobody has checked is
//      not a capability that is off; it is an unanswered question, and the UI must
//      be able to say so.
//   2. A withdraw-capable key is RISK, whatever else is true about it. The venue
//      gate already refuses such keys at connect time, so seeing one here means
//      either a key gained permission after verification or a storage path exists
//      that skipped the gate - both are incidents, not states to display calmly.
//   3. A failed check does not downgrade known-good permissions to healthy. The
//      last verified answer is reported with its age, and the overall verdict is
//      UNKNOWN once the evidence is older than the staleness bound, because a
//      week-old permission list is not evidence about today.
//   4. Account-level terminal states win over capability-level detail. A revoked
//      or errored account cannot trade whatever its stored permission flags say.
import { Injectable } from '@nestjs/common';

import { ExchangeAccountState, ExchangeHealthState } from './exchange.types';

/** Which permission a row is about. */
export type CapabilityKind = 'READ' | 'TRADE' | 'WITHDRAW' | 'MARGIN';

/** The verdict for one capability. `RISK` is worse than `DEGRADED`: it is a hazard, not a limitation. */
export type CapabilityState = 'OK' | 'DEGRADED' | 'RISK' | 'UNKNOWN' | 'UNHEALTHY';

/** The overall verdict, ordered by severity in `OVERALL_SEVERITY`. */
export type AccountCapabilityOverall = 'HEALTHY' | 'DEGRADED' | 'RISK' | 'UNHEALTHY' | 'UNKNOWN';

/** Stable, greppable reason codes. The UI maps these to sentences; it never shows a raw venue string. */
export type CapabilityReason =
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_ABSENT'
  | 'PERMISSION_NEVER_VERIFIED'
  | 'PERMISSION_VERIFICATION_STALE'
  | 'WITHDRAWAL_ENABLED'
  | 'KEY_IS_READ_ONLY'
  | 'ACCOUNT_REVOKED'
  | 'ACCOUNT_ERROR'
  | 'ACCOUNT_DISABLED'
  | 'CREDENTIAL_EXPIRED'
  | 'REPEATED_CHECK_FAILURES'
  | 'VENUE_UNHEALTHY';

export interface CapabilityRow {
  capability: CapabilityKind;
  state: CapabilityState;
  reason: CapabilityReason;
  /** Whether the last successful verification said this capability exists. */
  granted: boolean;
  /** Plain sentence for the UI. Never contains venue response text. */
  detail: string;
  /**
   * Whether this row may drag the overall verdict down. Capabilities a venue
   * simply does not offer (margin on a spot-only key) are reported but do not
   * make an otherwise healthy account unhealthy - an OPTIONAL row is
   * information, not a fault.
   */
  countsTowardOverall: boolean;
}

export interface AccountCapabilityHealth {
  tenantId: string;
  accountId: string;
  venue: string;
  environment: string;
  overall: AccountCapabilityOverall;
  capabilities: CapabilityRow[];
  /** When the permissions were last read from the venue; null when never. */
  verifiedAt: string | null;
  /** Age of the evidence in milliseconds; null when there is none. */
  evidenceAgeMs: number | null;
  /** Actions a human must take. Empty when nothing is wrong. */
  requiresAction: Array<'ROTATE_KEY_WITHOUT_WITHDRAWAL' | 'RECONNECT_KEY' | 'VERIFY_PERMISSIONS'>;
  checkedAt: string;
}

/**
 * The stored facts this service is allowed to reason from. Deliberately a
 * structural type rather than a Prisma row: the same matrix is computed for a
 * freshly fetched record and for a cached snapshot, and neither should drag the
 * database types into the view layer.
 */
export interface CapabilityHealthInput {
  tenantId: string;
  accountId: string;
  venue: string;
  environment: string;
  accountState: ExchangeAccountState | string;
  healthState: ExchangeHealthState | string | null;
  /** Null means "never verified" - distinct from false. */
  canReadData: boolean | null;
  canTrade: boolean | null;
  canWithdraw: boolean | null;
  /** Null means "never verified". An empty array means verified and empty. */
  verifiedPermissions: string[] | null;
  lastVerifiedAt: Date | string | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  credentialExpiresAt?: Date | string | null;
}

export interface CapabilityHealthOptions {
  /** How long a permission reading stays usable. Default 24 h. */
  maxEvidenceAgeMs?: number;
  /** Consecutive failures at which the account is treated as unhealthy. Default 3. */
  failureThreshold?: number;
  /** Clock, injectable so the staleness boundary can be tested exactly. */
  now?: () => Date;
}

const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_FAILURE_THRESHOLD = 3;

/** Severity order for picking an overall verdict. `RISK` outranks `DEGRADED`. */
const OVERALL_SEVERITY: Record<AccountCapabilityOverall, number> = {
  HEALTHY: 0,
  UNKNOWN: 1,
  DEGRADED: 2,
  RISK: 3,
  UNHEALTHY: 4,
};

function severityOf(state: CapabilityState): number {
  switch (state) {
    case 'RISK':
      return 3;
    case 'UNHEALTHY':
      return 4;
    case 'DEGRADED':
      return 2;
    case 'UNKNOWN':
      return 1;
    case 'OK':
    default:
      return 0;
  }
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function hasPermission(permissions: string[] | null, needles: readonly string[]): boolean {
  if (!permissions) return false;
  const normalised = permissions.map((permission) => permission.trim().toUpperCase());
  return needles.some((needle) => normalised.includes(needle));
}

/**
 * Computes the capability matrix. Stateless and side-effect free, so it can run
 * on every read of the account screen without a cache to invalidate.
 */
@Injectable()
export class AccountCapabilityHealthService {
  private readonly maxEvidenceAgeMs: number;
  private readonly failureThreshold: number;
  private readonly now: () => Date;

  constructor(options: CapabilityHealthOptions = {}) {
    this.maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.now = options.now ?? (() => new Date());
    if (this.maxEvidenceAgeMs <= 0) {
      throw new Error('maxEvidenceAgeMs must be positive: zero would make every verification stale');
    }
    if (this.failureThreshold < 1) {
      throw new Error('failureThreshold must be at least 1');
    }
  }

  /**
   * The matrix for one account.
   *
   * Account-level terminal states are resolved first and returned as a whole
   * matrix of UNHEALTHY rows: reporting "reads are fine" for a revoked key would
   * be technically true and operationally useless.
   */
  evaluate(input: CapabilityHealthInput): AccountCapabilityHealth {
    const nowMs = this.now().getTime();
    const verifiedMs = toMillis(input.lastVerifiedAt);
    const evidenceAgeMs = verifiedMs === null ? null : Math.max(0, nowMs - verifiedMs);
    const expiryMs = toMillis(input.credentialExpiresAt);
    const credentialExpired = expiryMs !== null && expiryMs <= nowMs;

    const terminal = this.terminalState(input, credentialExpired);
    if (terminal) {
      return this.uniform(input, terminal.state, terminal.reason, terminal.detail, evidenceAgeMs, terminal.action);
    }

    if (input.verifiedPermissions === null || verifiedMs === null) {
      // Never verified. Every row is UNKNOWN - including READ, because a key that
      // has never been exercised may not be able to read either.
      return this.uniform(
        input,
        'UNKNOWN',
        'PERMISSION_NEVER_VERIFIED',
        'These permissions have never been verified against the venue.',
        evidenceAgeMs,
        'VERIFY_PERMISSIONS',
      );
    }

    const stale = evidenceAgeMs !== null && evidenceAgeMs > this.maxEvidenceAgeMs;
    const rows: CapabilityRow[] = [
      this.readRow(input),
      this.tradeRow(input, stale),
      this.withdrawRow(input),
      this.marginRow(input, stale),
    ];

    const actions = new Set<AccountCapabilityHealth['requiresAction'][number]>();
    if (rows.some((row) => row.reason === 'WITHDRAWAL_ENABLED')) actions.add('ROTATE_KEY_WITHOUT_WITHDRAWAL');
    if (stale) actions.add('VERIFY_PERMISSIONS');
    if (input.consecutiveFailures >= this.failureThreshold) actions.add('RECONNECT_KEY');

    const counted = rows.filter((row) => row.countsTowardOverall);
    const worstRow = counted.reduce((worst, row) => (severityOf(row.state) > severityOf(worst.state) ? row : worst));
    let overall = this.overallFor(worstRow.state);
    if (stale && overall === 'HEALTHY') overall = 'DEGRADED';
    // Any venue health state other than HEALTHY caps the verdict at DEGRADED. The
    // capability rows describe what the key MAY do; the health state describes
    // whether it is doing it, and the quieter of the two must win.
    if (input.healthState !== null && input.healthState !== ExchangeHealthState.HEALTHY && overall === 'HEALTHY') {
      overall = 'DEGRADED';
    }

    return {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      overall,
      capabilities: rows,
      verifiedAt: verifiedMs === null ? null : new Date(verifiedMs).toISOString(),
      evidenceAgeMs,
      requiresAction: [...actions],
      checkedAt: this.now().toISOString(),
    };
  }

  /**
   * The matrix for every account the caller is allowed to see.
   *
   * Rows from another tenant are dropped rather than thrown on: this is used to
   * render a list, and one stale row from a shared cache must not break the page.
   * Callers that need a hard refusal fetch a single account through
   * `evaluate` after a scoped lookup.
   */
  listForTenant(tenantId: string, inputs: readonly CapabilityHealthInput[]): AccountCapabilityHealth[] {
    return inputs
      .filter((input) => input.tenantId === tenantId)
      .map((input) => this.evaluate(input));
  }

  private terminalState(
    input: CapabilityHealthInput,
    credentialExpired: boolean,
  ): { state: CapabilityState; reason: CapabilityReason; detail: string; action?: AccountCapabilityHealth['requiresAction'][number] } | null {
    if (input.accountState === ExchangeAccountState.REVOKED) {
      return {
        state: 'UNHEALTHY',
        reason: 'ACCOUNT_REVOKED',
        detail: 'The connection was revoked. Reconnect the account to trade again.',
        action: 'RECONNECT_KEY',
      };
    }
    if (credentialExpired) {
      return {
        state: 'UNHEALTHY',
        reason: 'CREDENTIAL_EXPIRED',
        detail: 'The venue key has expired. Signed requests are refused until it is replaced.',
        action: 'RECONNECT_KEY',
      };
    }
    if (input.accountState === ExchangeAccountState.ERROR) {
      return {
        state: 'UNHEALTHY',
        reason: 'ACCOUNT_ERROR',
        detail: 'The account is in an error state after a failed venue check.',
        action: 'RECONNECT_KEY',
      };
    }
    if (input.accountState === ExchangeAccountState.DISABLED) {
      return {
        state: 'DEGRADED',
        reason: 'ACCOUNT_DISABLED',
        detail: 'Trading is disabled for this account, so no capability is in use.',
      };
    }
    if (input.consecutiveFailures >= this.failureThreshold) {
      return {
        state: 'UNHEALTHY',
        reason: 'REPEATED_CHECK_FAILURES',
        detail: `The last ${input.consecutiveFailures} checks against the venue failed.`,
        action: 'RECONNECT_KEY',
      };
    }
    return null;
  }

  private uniform(
    input: CapabilityHealthInput,
    state: CapabilityState,
    reason: CapabilityReason,
    detail: string,
    evidenceAgeMs: number | null,
    action?: AccountCapabilityHealth['requiresAction'][number],
  ): AccountCapabilityHealth {
    const capabilities: CapabilityRow[] = (['READ', 'TRADE', 'WITHDRAW', 'MARGIN'] as const).map((capability) => ({
      capability,
      state,
      reason,
      granted: false,
      detail,
      countsTowardOverall: true,
    }));
    return {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      overall: this.overallFor(state),
      capabilities,
      verifiedAt: input.lastVerifiedAt ? new Date(input.lastVerifiedAt).toISOString() : null,
      evidenceAgeMs,
      requiresAction: action ? [action] : [],
      checkedAt: this.now().toISOString(),
    };
  }

  private readRow(input: CapabilityHealthInput): CapabilityRow {
    if (input.canReadData === true) {
      return {
        capability: 'READ',
        state: 'OK',
        reason: 'PERMISSION_GRANTED',
        granted: true,
        detail: 'Balances, orders and positions can be read.',
        countsTowardOverall: true,
      };
    }
    return {
      capability: 'READ',
      state: 'DEGRADED',
      reason: 'PERMISSION_ABSENT',
      granted: false,
      detail: 'The key cannot read account data, so balances and positions will not sync.',
      countsTowardOverall: true,
    };
  }

  private tradeRow(input: CapabilityHealthInput, stale: boolean): CapabilityRow {
    const granted = input.canTrade === true;
    if (!granted) {
      return {
        capability: 'TRADE',
        state: 'DEGRADED',
        reason: 'KEY_IS_READ_ONLY',
        granted: false,
        detail: 'The key is read-only: copy orders will be refused by the venue.',
        countsTowardOverall: true,
      };
    }
    if (stale) {
      return {
        capability: 'TRADE',
        state: 'DEGRADED',
        reason: 'PERMISSION_VERIFICATION_STALE',
        granted: true,
        detail: 'Trading was permitted at the last verification, but that reading is now out of date.',
        countsTowardOverall: true,
      };
    }
    return {
      capability: 'TRADE',
      state: 'OK',
      reason: 'PERMISSION_GRANTED',
      granted: true,
      detail: 'The key can place and cancel orders.',
      countsTowardOverall: true,
    };
  }

  private withdrawRow(input: CapabilityHealthInput): CapabilityRow {
    if (input.canWithdraw === true) {
      // Not a limitation - a hazard. The platform never trades with a key that can
      // move funds off the venue, and this row is what tells an operator (or the
      // customer) that such a key is connected right now.
      return {
        capability: 'WITHDRAW',
        state: 'RISK',
        reason: 'WITHDRAWAL_ENABLED',
        granted: true,
        detail: 'This key can withdraw funds. Replace it with a key that cannot: nothing else about the account is safe to rely on until you do.',
        countsTowardOverall: true,
      };
    }
    if (input.canWithdraw === null) {
      return {
        capability: 'WITHDRAW',
        state: 'UNKNOWN',
        reason: 'PERMISSION_NEVER_VERIFIED',
        granted: false,
        detail: 'Withdrawal permission has not been verified for this key.',
        countsTowardOverall: true,
      };
    }
    return {
      capability: 'WITHDRAW',
      state: 'OK',
      reason: 'PERMISSION_ABSENT',
      granted: false,
      detail: 'Withdrawals are not permitted by this key, which is required.',
      countsTowardOverall: true,
    };
  }

  private marginRow(input: CapabilityHealthInput, stale: boolean): CapabilityRow {
    const granted = hasPermission(input.verifiedPermissions, ['MARGIN', 'FUTURES', 'MARGIN_TRADE']);
    if (!granted) {
      return {
        capability: 'MARGIN',
        state: 'UNKNOWN',
        reason: 'PERMISSION_ABSENT',
        granted: false,
        detail: 'The venue did not report a margin or futures permission for this key.',
        // A spot-only venue not offering margin is not a fault.
        countsTowardOverall: false,
      };
    }
    return {
      capability: 'MARGIN',
      state: stale ? 'DEGRADED' : 'OK',
      reason: stale ? 'PERMISSION_VERIFICATION_STALE' : 'PERMISSION_GRANTED',
      granted: true,
      detail: 'Margin trading is permitted for this key.',
      countsTowardOverall: true,
    };
  }

  private overallFor(state: CapabilityState): AccountCapabilityOverall {
    switch (state) {
      case 'RISK':
        return 'RISK';
      case 'UNHEALTHY':
        return 'UNHEALTHY';
      case 'DEGRADED':
        return 'DEGRADED';
      case 'UNKNOWN':
        return 'UNKNOWN';
      case 'OK':
      default:
        return 'HEALTHY';
    }
  }

  /** Exposed so a caller can order several matrices by severity without re-deriving the ranking. */
  static severityOf(overall: AccountCapabilityOverall): number {
    return OVERALL_SEVERITY[overall];
  }
}
