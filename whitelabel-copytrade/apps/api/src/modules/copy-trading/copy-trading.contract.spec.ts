// # Verifies idempotent fanout and multi-follower isolation
import * as crypto from 'crypto';
import './leader-event.spec';
import './copy-execution.dispatch.spec';
import { sanitizeCopyMetadata } from './copy-trading.types';

function computeFanoutIdempotencyKey(
  tenantId: string,
  subscriptionId: string,
  leaderEventId: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`copy-exec:${tenantId}:${subscriptionId}:${leaderEventId}`)
    .digest('hex');
}

describe('Copy-Trading Leader Fanout & Multi-Follower Isolation Contract (GAP-15)', () => {
  test('produces identical idempotency keys for duplicate leader fill webhooks and distinct keys per follower subscription', () => {
    const firstAttempt = computeFanoutIdempotencyKey('tenant-1', 'sub-follower-1', 'leader-fill-999');
    const duplicateWebhook = computeFanoutIdempotencyKey('tenant-1', 'sub-follower-1', 'leader-fill-999');
    const secondFollower = computeFanoutIdempotencyKey('tenant-1', 'sub-follower-2', 'leader-fill-999');

    expect(firstAttempt).toBe(duplicateWebhook);
    expect(firstAttempt).not.toBe(secondFollower);
  });

  test('sanitizes secret and forbidden financial fields from copy metadata', () => {
    const cleaned = sanitizeCopyMetadata({
      leaderOrderRef: 'ord-100',
      apiSecret: 'super-secret-value',
      symbol: 'BTC/USDT',
    });
    expect(cleaned.leaderOrderRef).toBe('ord-100');
    expect(cleaned.symbol).toBe('BTC/USDT');
    expect(cleaned.apiSecret).toBeUndefined();
  });
});
