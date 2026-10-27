import type { SealedPayload } from '@wlct/utils';

/** A dedicated queue prevents another mail consumer from acknowledging recovery jobs. */
export const RECOVERY_QUEUE = 'account-recovery-delivery';
export const RECOVERY_JOB = 'deliver-account-recovery';
export const RECOVERY_READY_KEY = 'account-recovery:delivery-ready';
export const RECOVERY_TTL_MS = 30 * 60 * 1000;

export interface RecoveryDeliveryJob {
  tenantId: string;
  tokenId: string;
  emailFingerprint: string;
  emailCiphertext: SealedPayload | null;
  requestedAt: number;
  completed?: true;
}

export function emailAad(tenantId: string, tokenId: string): string {
  return `account-recovery-email:${tenantId}:${tokenId}`;
}

export function tokenAad(tenantId: string, tokenId: string): string {
  return `account-recovery-token:${tenantId}:${tokenId}`;
}
