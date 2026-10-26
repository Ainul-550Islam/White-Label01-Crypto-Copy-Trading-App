// # Responsibility: verifies user creation uses the tenant resolved by the request rather than body data.
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController tenant binding', () => {
  it('forwards the resolved tenant and ignores a client-supplied tenantId field', async () => {
    const created = { id: 'user-a', tenantId: 'tenant-a' };
    const service = { create: jest.fn().mockResolvedValue(created) } as unknown as UsersService;
    const controller = new UsersController(service);
    const body = { email: 'member@example.test', tenantId: 'tenant-b' } as never;
    const actor = { userId: 'operator-a', tenantId: 'tenant-a' } as never;
    const meta = {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      ipHash: 'ip-hash',
      ip: '127.0.0.1',
      userAgent: 'users-controller-spec',
      locale: 'en',
      method: 'POST',
      path: '/v1/users',
    };

    await expect(controller.create(body, 'tenant-a', actor, meta)).resolves.toBe(created);
    expect(service.create).toHaveBeenCalledWith('tenant-a', body, {
      actorId: 'operator-a',
      ipHash: 'ip-hash',
      requestId: 'request-1',
    });
  });
});
