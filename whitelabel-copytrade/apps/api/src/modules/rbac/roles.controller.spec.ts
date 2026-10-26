// # Responsibility: verifies tenant context is forwarded to role reads by the controller.
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

describe('RolesController', () => {
  it('passes the caller tenant to role detail lookup', async () => {
    const role = { id: 'role-a', tenantId: 'tenant-a', key: 'ANALYST' };
    const service = { findById: jest.fn().mockResolvedValue(role) } as unknown as RolesService;
    const controller = new RolesController(service);

    await expect(controller.findOne('role-a', 'tenant-a')).resolves.toBe(role);
    expect(service.findById).toHaveBeenCalledWith('tenant-a', 'role-a');
  });
});
