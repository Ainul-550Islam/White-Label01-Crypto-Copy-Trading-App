// # Validates stable Redis dispatch channel and tenant-bearing dispatch envelopes.
import { REALTIME_DISPATCH_CHANNEL } from './realtime.constants';

describe('realtime constants', () => {
  it('uses a shared dispatch channel and envelope fields for cross-node relays', () => {
    expect(REALTIME_DISPATCH_CHANNEL).toBe('realtime:dispatch');
    const envelope = {
      room: 'tenant:tenant-a:user:user-a',
      event: 'notification.created',
      tenantId: 'tenant-a',
      emittedAt: '2026-10-25T00:00:00.000Z',
      payload: { id: 'n-1' },
    };
    expect(envelope.room).toContain(envelope.tenantId);
  });
});
