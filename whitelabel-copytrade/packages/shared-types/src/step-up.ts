// # Defines the action-bound step-up authentication contract shared by API clients and the backend.
export const STEP_UP_ACTIONS = [
  "EXCHANGE_KEY_ROTATE",
  "EXCHANGE_KEY_REVOKE",
  "EXCHANGE_ACCOUNT_DISABLE",
  "TWO_FACTOR_DISABLE",
  "RECOVERY_CODES_REGENERATE",
  "API_KEY_CREATE",
  "API_KEY_REVOKE",
  "PAYOUT_CREATE",
  "PAYOUT_APPROVE",
  "CUSTODY_ADDRESS_ISSUE",
  "CUSTODY_SWEEP",
  "VENUE_STATUS_OVERRIDE",
  "ORDER_RECOVERY",
  // Declared now, used by Batch 04's routes: both branches must agree on the union
  // or one of them can issue a proof the other refuses. An action that no route
  // uses yet is listed as RESERVED_FOR_BATCH_04 in scripts/check-step-up-paths.mjs.
  "AUDIT_EXPORT",
  "DATA_DELETION_REQUEST",
  "FEE_SCHEDULE_PUBLISH",
  "FEATURE_FLAG_LIVE_TOGGLE",
  "STATEMENT_REGENERATE",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];
export type StepUpMethod = "TOTP" | "PASSWORD" | "RECOVERY_CODE";

/** What the client posts to POST /v1/auth/step-up. One action, one method, the
 *  credential for that method. */
export interface StepUpChallengeInput {
  action: StepUpAction;
  method: StepUpMethod;
  /** Six-digit TOTP for TOTP. */
  code?: string;
  /** Account password for PASSWORD. */
  password?: string;
  /** One-time recovery code for RECOVERY_CODE; burned on use. */
  recoveryCode?: string;
}

/** The proof the API hands back. It is single-use and bound to the action. */
export interface StepUpProofIssued {
  proofId: string;
  action: StepUpAction;
  method: StepUpMethod;
  expiresAt: string;
  /** Seconds the proof stays valid, for the dialog's countdown. */
  ttlSeconds: number;
}

export interface StepUpStatus {
  fresh: boolean;
  action: StepUpAction | null;
  expiresAt: string | null;
}
