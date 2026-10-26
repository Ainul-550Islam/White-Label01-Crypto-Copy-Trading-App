// # Verifies disabled Redis Socket.IO adapter does not allocate duplicate connections.
import { RedisIoAdapter } from './redis-io.adapter';

describe('RedisIoAdapter', () => {
  it('does not duplicate Redis clients when the adapter is disabled', async () => {
    const duplicate = jest.fn();
    const adapter = Object.create(RedisIoAdapter.prototype) as RedisIoAdapter;
    Object.assign(adapter, {
      config: { wsRedisAdapterEnabled: false },
      redis: { duplicate },
    });
    await adapter.connectToRedis();
    expect(duplicate).not.toHaveBeenCalled();
  });
});
