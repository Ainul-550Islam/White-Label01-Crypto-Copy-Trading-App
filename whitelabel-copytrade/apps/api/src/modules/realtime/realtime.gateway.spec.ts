// # Regresses room derivation from authenticated actors and rejects client-selected cross-tenant rooms.
import { RealtimeChannel, tenantRoom, userRoom } from '@wlct/shared-types';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway room isolation', () => {
  it('joins only the authenticated tenant room even when the client supplies another tenant id', async () => {
    const gateway = new RealtimeGateway(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn() } as never,
    );
    const join = jest.fn().mockResolvedValue(undefined);
    const emit = jest.fn();
    const actor = { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' };
    const socket = { data: { actor, subscriptions: new Set<string>() }, join, emit } as never;
    const result = await gateway.handleSubscribe(socket, {
      channel: RealtimeChannel.TENANT,
      target: 'tenant-b',
    } as never);
    expect(result).toEqual({ subscribed: true, channel: tenantRoom('tenant-a') });
    expect(join).toHaveBeenCalledWith(tenantRoom('tenant-a'));
    expect(join).not.toHaveBeenCalledWith(tenantRoom('tenant-b'));
  });

  it('validates trader IDs and derives trader room tenant from the authenticated actor', async () => {
    const gateway = new RealtimeGateway(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn() } as never,
    );
    const join = jest.fn().mockResolvedValue(undefined);
    const socket = {
      data: { actor: { userId: 'user-a', tenantId: 'tenant-a' }, subscriptions: new Set<string>() },
      join,
      emit: jest.fn(),
    } as never;
    const invalid = await gateway.handleSubscribe(socket, {
      channel: RealtimeChannel.TRADER,
      target: '../tenant-b',
    } as never);
    expect(invalid.subscribed).toBe(false);
    expect(join).not.toHaveBeenCalled();
    expect(userRoom('tenant-a', 'user-a')).toBe('tenant:tenant-a:user:user-a');
  });
});
