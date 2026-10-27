import { newIdempotencyKey } from '@/lib/idempotency-key';

/**
 * Persist a retry key before submission in this tab. The storage key is a
 * digest, not the owner's identity or amount. Sign-out clears sessionStorage.
 */
export async function copyBudgetRetryKey(
  owner: { tenantId: string; userId: string },
  input: { maxActiveExposure: string; currency: string },
  storage: Storage,
  cryptoApi: Crypto,
): Promise<{ key: string; slot: string }> {
  if (!cryptoApi.subtle) throw new Error('Secure retry storage unavailable');
  const fingerprint = JSON.stringify([owner.tenantId, owner.userId, input.currency, input.maxActiveExposure]);
  const hash = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const slot = `copy-budget:${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')}`;
  const existing = storage.getItem(slot);
  if (existing !== null) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(existing)) throw new Error('Invalid retry state');
    return { key: existing, slot };
  }
  const key = newIdempotencyKey('copy-budget');
  storage.setItem(slot, key);
  return { key, slot };
}
