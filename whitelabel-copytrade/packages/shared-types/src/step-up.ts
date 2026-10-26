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
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];
export type StepUpMethod = "TOTP" | "PASSWORD" | "RECOVERY_CODE";

export interface StepUpStatus {
  fresh: boolean;
  action: StepUpAction | null;
  expiresAt: string | null;
}
