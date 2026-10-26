// # Responsibility: classifies an exchange key by what the venue says it may do, and refuses a key it cannot classify or that can withdraw.
//
// WHY A CLASSIFIER AND NOT A BOOLEAN
// ----------------------------------
// The platform asks three different questions about the same key and they must
// not be answered by one flag:
//
//   "May this key place orders?"        - decides whether copy trading can run.
//   "Can this key move funds off the venue?" - decides whether the key is
//                                       acceptable at all. The answer is always
//                                       no: a withdrawal-capable key is refused
//                                       here, before it reaches a venue call.
//   "Does what the key reports match what it actually did?" - decides whether the
//                                       reported permissions can be believed.
//
// A key that claims to be read-only and then has an order accepted is the
// dangerous case, and it is invisible to any check that only reads permissions.
// That is why `verify` takes BOTH the reported permissions and the outcome of a
// probe, and refuses when the two disagree in the permissive direction. Trusting
// the report when the venue disagrees is how a "read-only" key trades.
//
// Unknown is refused rather than assumed. A venue that returns no capability
// metadata gives us nothing to reason from, and "we could not tell" is not
// permission to place an order.
import { Injectable } from '@nestjs/common';

/** What an API key is, as far as this platform is concerned. */
export type KeyClass = 'READ_ONLY' | 'TRADE' | 'WITHDRAW_ENABLED' | 'UNKNOWN';

/** What the venue reported. Every field nullable: a venue may omit any of them. */
export interface ReportedPermissions {
  canReadData?: boolean | null;
  canTrade?: boolean | null;
  canWithdraw?: boolean | null;
  /** Raw permission labels the venue returned, if any. Normalised for storage. */
  permissions?: string[] | null;
}

/**
 * What a probe actually observed. `null` means the probe did not run or could not
 * conclude - which is not the same as "no".
 */
export interface PermissionProbe {
  orderPlacementAccepted: boolean | null;
}

export type VerificationCode =
  | 'ACCEPTED_TRADE'
  | 'ACCEPTED_READ_ONLY'
  | 'REFUSED_WITHDRAWAL'
  | 'REFUSED_CLAIM_MISMATCH'
  | 'REFUSED_UNVERIFIED'
  | 'REFUSED_NO_TRADE';

export interface PermissionVerdict {
  /** Whether this key may be used for the purpose it was offered for. */
  accepted: boolean;
  keyClass: KeyClass;
  code: VerificationCode;
  message: string;
  /** Sorted, de-duplicated, upper-cased labels safe to persist and display. */
  normalisedPermissions: string[];
  /** True when the venue's behaviour contradicted its own report. */
  claimMismatch: boolean;
}

export interface VerifyInput {
  reported: ReportedPermissions;
  probe: PermissionProbe;
  /** True when the account exists to trade (copy trading, live enabled). */
  requireTrade: boolean;
  /** The class the caller expected, when it has one. Used to catch drift. */
  claimed?: KeyClass | null;
}

const WITHDRAW_LABELS = ['WITHDRAW', 'WITHDRAWALS', 'WITHDRAWAL', 'TRANSFER', 'WALLET_TRANSFER'];

/**
 * Normalises the venue's raw permission labels: trimmed, upper-cased, de-duped,
 * sorted. Sorted so two reads of the same key produce byte-identical rows and a
 * "permissions changed" alert does not fire on ordering.
 */
export function normalisePermissions(permissions: readonly string[] | null | undefined): string[] {
  if (!permissions) return [];
  const seen = new Set<string>();
  for (const permission of permissions) {
    const normalised = String(permission ?? '').trim().toUpperCase();
    if (normalised) seen.add(normalised);
  }
  return [...seen].sort();
}

@Injectable()
export class PermissionVerificationService {
  /**
   * The class of a key from what the venue reported alone.
   *
   * Withdrawal wins over everything: a key that can withdraw is WITHDRAW_ENABLED
   * even if it also trades, because the label is meant to be read as "this is the
   * most dangerous thing this key can do".
   */
  classify(reported: ReportedPermissions): KeyClass {
    const labels = normalisePermissions(reported.permissions);
    const withdrawByLabel = labels.some((label) => WITHDRAW_LABELS.includes(label));
    if (reported.canWithdraw === true || withdrawByLabel) return 'WITHDRAW_ENABLED';
    if (reported.canTrade === true) return 'TRADE';
    if (reported.canReadData === true) return 'READ_ONLY';
    // Everything false, or everything absent. A key that can do nothing usable is
    // not a read-only key - it is an unknown one.
    return 'UNKNOWN';
  }

  /**
   * Decide whether a key may be used, from its report and from what a probe saw.
   *
   * The order of the checks is the order of the consequences: withdrawal first
   * (hazard), then whether anything could be verified (no evidence), then the
   * claim/behaviour mismatch (a lie), then whether trade is actually possible.
   */
  verify(input: VerifyInput): PermissionVerdict {
    const labels = normalisePermissions(input.reported.permissions);
    const reportedClass = this.classify(input.reported);

    if (reportedClass === 'WITHDRAW_ENABLED') {
      return {
        accepted: false,
        keyClass: 'WITHDRAW_ENABLED',
        code: 'REFUSED_WITHDRAWAL',
        message:
          'This key can withdraw funds. Create a key with withdrawals disabled and connect that one instead; a withdrawal-capable key is never used to trade.',
        normalisedPermissions: labels,
        claimMismatch: false,
      };
    }

    const anyEvidence =
      input.reported.canTrade !== null && input.reported.canTrade !== undefined ||
      input.reported.canReadData !== null && input.reported.canReadData !== undefined;
    if (!anyEvidence || reportedClass === 'UNKNOWN' || input.probe.orderPlacementAccepted === null) {
      return {
        accepted: false,
        keyClass: 'UNKNOWN',
        code: 'REFUSED_UNVERIFIED',
        message:
          'The venue did not report usable permissions, or the probe could not confirm them. This key cannot be used until its permissions can be read.',
        normalisedPermissions: labels,
        claimMismatch: false,
      };
    }

    const observedTrade = input.probe.orderPlacementAccepted === true;
    if (!observedTrade && reportedClass === 'TRADE') {
      // The report said it could trade; the probe was refused. Believe the probe.
      return {
        accepted: false,
        keyClass: 'READ_ONLY',
        code: 'REFUSED_NO_TRADE',
        message:
          'The venue refused a test order from this key, so it cannot place copy orders. Connect a key with trading enabled.',
        normalisedPermissions: labels,
        claimMismatch: true,
      };
    }

    if (observedTrade && reportedClass === 'READ_ONLY') {
      // It said read-only and then accepted an order. Whatever else is true, its
      // permission report cannot be relied on for any decision.
      return {
        accepted: false,
        keyClass: 'TRADE',
        code: 'REFUSED_CLAIM_MISMATCH',
        message:
          'This key reported read-only permissions but the venue accepted an order from it. Its permission report cannot be trusted; replace the key.',
        normalisedPermissions: labels,
        claimMismatch: true,
      };
    }

    if (input.claimed && input.claimed !== reportedClass) {
      return {
        accepted: false,
        keyClass: reportedClass,
        code: 'REFUSED_CLAIM_MISMATCH',
        message: `This key was recorded as ${input.claimed} but the venue now reports ${reportedClass}. Confirm the change before trading.`,
        normalisedPermissions: labels,
        claimMismatch: true,
      };
    }

    if (input.requireTrade && reportedClass !== 'TRADE') {
      return {
        accepted: false,
        keyClass: 'READ_ONLY',
        code: 'REFUSED_NO_TRADE',
        message: 'This account is set up to trade, and the key is read-only.',
        normalisedPermissions: labels,
        claimMismatch: false,
      };
    }

    if (reportedClass === 'READ_ONLY') {
      return {
        accepted: true,
        keyClass: 'READ_ONLY',
        code: 'ACCEPTED_READ_ONLY',
        message: 'Read-only key: balances and history sync, and no order will be placed with it.',
        normalisedPermissions: labels,
        claimMismatch: false,
      };
    }

    return {
      accepted: true,
      keyClass: 'TRADE',
      code: 'ACCEPTED_TRADE',
      message: 'Trading key without withdrawal permission, which is what copy trading requires.',
      normalisedPermissions: labels,
      claimMismatch: false,
    };
  }

  /**
   * The refusal a stored permission set would produce without a probe, used when
   * rendering an account that was verified before the probe existed. Fail-closed
   * by construction: it can only say yes to a key that reports trade and cannot
   * withdraw.
   */
  static shouldRefuseCopyAccount(reported: ReportedPermissions): boolean {
    const labels = normalisePermissions(reported.permissions);
    if (reported.canWithdraw === true) return true;
    if (labels.some((label) => WITHDRAW_LABELS.includes(label))) return true;
    return reported.canTrade !== true;
  }
}
