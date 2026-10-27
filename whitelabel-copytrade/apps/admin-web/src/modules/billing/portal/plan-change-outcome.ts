/** Validate backend acknowledgements before reporting a plan change or navigating. */
export function isAcknowledgedPlanChange(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.action === 'CHANGE_PLAN' && row.requiresCheckout === false &&
    typeof row.subscriptionId === 'string' && row.subscriptionId.length > 0 &&
    typeof row.status === 'string' && row.status.length > 0 && row.status !== 'PENDING_CHECKOUT' &&
    typeof row.effectiveAt === 'string' && Number.isFinite(Date.parse(row.effectiveAt));
}

export function checkoutDestination(value: unknown, planId: string): string {
  if (!value || typeof value !== 'object') throw new Error('Invalid checkout response');
  const row = value as Record<string, unknown>;
  if (row.planId !== planId || typeof row.checkoutId !== 'string' || !row.checkoutId ||
      typeof row.checkoutUrl !== 'string') throw new Error('Invalid checkout response');
  let url: URL;
  try { url = new URL(row.checkoutUrl); } catch { throw new Error('Invalid checkout response'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Invalid checkout response');
  return url.href;
}
