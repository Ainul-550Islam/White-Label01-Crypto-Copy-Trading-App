/** A successful HTTP status alone is not proof of the requested action. */
export function assertStepUpProof(value: unknown, action: string, method: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid verification response');
  const proof = value as Record<string, unknown>;
  if (typeof proof.proofId !== 'string' || !proof.proofId || proof.action !== action || proof.method !== method || typeof proof.expiresAt !== 'string' || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) {
    throw new Error('Invalid verification response');
  }
}
