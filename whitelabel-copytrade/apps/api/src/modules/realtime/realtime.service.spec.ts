// # Tests tenant-scoped Redis publishing and best-effort failure behavior.
import { RealtimeEvent, tenantRoom, userRoom } from '@wlct/shared-types';
import { RealtimeService } from './realtime.service';
import { REALTIME_DISPATCH_CHANNEL } from './realtime.constants';

describe('RealtimeService', () => {
  it('publishes tenant and user messages on the shared cross-node dispatch channel', async () => {
    const publish = jest.fn().mockResolvedValue(1);
    const service = new RealtimeService(
      { publisher: { publish } } as never,
      { warn: jest.fn() } as never,
    );
    await service.emitToUser('tenant-a', 'user-a', RealtimeEvent.NOTIFICATION_CREATED, {
      id: 'notification-a',
    });
    await service.emitToTenant('tenant-a', RealtimeEvent.FEATURE_FLAG_UPDATED, {
      key: 'copy-trading',
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(
      1,
      REALTIME_DISPATCH_CHANNEL,
      expect.stringContaining(userRoom('tenant-a', 'user-a')),
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      REALTIME_DISPATCH_CHANNEL,
      expect.stringContaining(tenantRoom('tenant-a')),
    );
  });

  it('does not fail the source operation when realtime transport is unavailable', async () => {
    const service = new RealtimeService(
      { publisher: { publish: jest.fn().mockRejectedValue(new Error('redis down')) } } as never,
      { warn: jest.fn() } as never,
    );
    await expect(
      service.emitToTenant('tenant-a', RealtimeEvent.SECURITY_ALERT, {}),
    ).resolves.toBeUndefined();
  });
});
