// # Responsibility: verifies tenant boundaries, immutable system roles, and assigned-role deletion safety.
import { RolesService } from './roles.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PermissionsService } from './permissions.service';
import { AuditService } from '../audit/audit.service';

describe('RolesService tenant and lifecycle safeguards', () => {
  const tenantId = 'tenant-a';
  const actorId = 'operator-a';
  const context = { ipHash: 'ip-hash', requestId: 'request-1' };

  function setup() {
    const prisma = {
      role: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const permissions = { invalidateRoleMembers: jest.fn() } as unknown as PermissionsService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    return { service: new RolesService(prisma, permissions, audit), prisma, permissions, audit };
  }

  it('resolves only tenant-visible and platform template roles', async () => {
    const { service, prisma } = setup();
    const rows = [{ id: 'role-a', key: 'ANALYST' }];
    jest.mocked(prisma.role.findMany).mockResolvedValue(rows as never);

    await expect(service.findByKeys(tenantId, ['ANALYST'])).resolves.toEqual(rows);
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['ANALYST'] }, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, key: true },
    });
  });

  it('does not query for an empty requested role-key set', async () => {
    const { service, prisma } = setup();
    await expect(service.findByKeys(tenantId, [])).resolves.toEqual([]);
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('refuses to update a system role before opening a write transaction', async () => {
    const { service, prisma, audit } = setup();
    jest.mocked(prisma.role.findFirst).mockResolvedValue({
      id: 'system-role', tenantId: null, key: 'ADMIN', name: 'Admin', description: null,
      isSystem: true, permissions: [],
    } as never);

    await expect(service.update(tenantId, actorId, 'system-role', { name: 'Changed' }, context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to delete a custom role while it still has members', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.role.findFirst).mockResolvedValue({
      id: 'role-a', tenantId, key: 'ANALYST', name: 'Analyst', isSystem: false,
      _count: { users: 1 },
    } as never);

    await expect(service.remove(tenantId, actorId, 'role-a', context)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('invalidates every assigned member after custom-role permissions change', async () => {
    const { service, prisma, permissions, audit } = setup();
    const now = new Date('2026-10-01T00:00:00.000Z');
    const role = {
      id: 'role-a', tenantId, key: 'ANALYST', name: 'Analyst', description: null,
      scope: 'TENANT', isSystem: false, isDefault: false, priority: 10,
      createdAt: now, updatedAt: now,
      permissions: [{ permission: { key: 'user:read' } }],
      _count: { users: 2 },
    };
    const updated = { ...role, name: 'Senior Analyst', updatedAt: new Date('2026-10-02T00:00:00.000Z') };
    jest.mocked(prisma.role.findFirst).mockResolvedValue(role as never);
    const tx = { role: { update: jest.fn().mockResolvedValue(updated) } };
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (callback: unknown) =>
      (callback as (transaction: typeof tx) => Promise<typeof updated>)(tx),
    );

    await service.update(tenantId, actorId, 'role-a', { name: 'Senior Analyst' }, context);
    expect(permissions.invalidateRoleMembers).toHaveBeenCalledWith('role-a');
    expect(audit.record).toHaveBeenCalled();
  });

  it('does not reveal a role owned by another tenant', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.role.findFirst).mockResolvedValue(null);

    await expect(service.findById(tenantId, 'foreign-role')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'foreign-role', deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
    }));
  });

  it('refuses to delete a system-role template', async () => {
    const { service, prisma, audit } = setup();
    jest.mocked(prisma.role.findFirst).mockResolvedValue({
      id: 'system-role', tenantId: null, key: 'TENANT_ADMIN', name: 'Tenant Admin',
      isSystem: true, _count: { users: 1 },
    } as never);

    await expect(service.remove(tenantId, actorId, 'system-role', context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

});
