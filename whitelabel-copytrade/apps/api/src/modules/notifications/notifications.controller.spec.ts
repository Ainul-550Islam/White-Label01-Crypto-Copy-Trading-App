// # Verifies inbox controller passes JWT tenant and user identities to every inbox query.
import { NotificationsController } from './notifications.controller';

describe('NotificationsController tenant scope', () => {
  it('passes authenticated tenant and user to inbox reads', async () => {
    const notifications = { list: jest.fn().mockResolvedValue({ items: [], pagination: {} }) };
    const controller = new NotificationsController(notifications as never);
    const actor = { userId: 'user-b', tenantId: 'tenant-b' } as never;
    await controller.list({} as never, 'tenant-b', actor);
    expect(notifications.list).toHaveBeenCalledWith('tenant-b', 'user-b', {});
  });
});
