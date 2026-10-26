// # Responsibility: verifies the permissions controller delegates catalogue reads to its provider.
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

describe('PermissionsController', () => {
  it('returns the permission catalogue from the service', async () => {
    const catalogue = [{ key: 'user:read', resource: 'user', action: 'read' }];
    const service = { listCatalogue: jest.fn().mockResolvedValue(catalogue) } as unknown as PermissionsService;
    const controller = new PermissionsController(service);

    await expect(controller.list()).resolves.toBe(catalogue);
    expect(service.listCatalogue).toHaveBeenCalledTimes(1);
  });
});
