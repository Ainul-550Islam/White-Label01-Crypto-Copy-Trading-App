// # Responsibility: verifies user lifecycle operations remain tenant-scoped and prevent self-administration.
import { UsersService } from './users.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersRepository } from './users.repository';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { PermissionsService } from '../rbac/permissions.service';
import { RolesService } from '../rbac/roles.service';
import { AuditService } from '../audit/audit.service';
import { PlanLimitUsersGuard } from '../billing/enforcement/plan-limit-users.guard';

describe('UsersService tenant and lifecycle safeguards', () => {
  const tenantId = 'tenant-a';
  const actorId = 'operator-a';
  const context = { actorId, tenantId, ipHash: 'ip-hash', requestId: 'request-1' };

  function setup() {
    const prisma = {
      user: { updateMany: jest.fn(), create: jest.fn() },
      userSession: { updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      role: { findMany: jest.fn() },
      userRole: { deleteMany: jest.fn(), createMany: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(async (ops: unknown) => ops),
    } as unknown as PrismaService;
    const repository = { findById: jest.fn(), findByEmailIndex: jest.fn() } as unknown as UsersRepository;
    const permissions = { invalidateUser: jest.fn(), getEffectiveAccess: jest.fn(), getEffectiveAccessForTenant: jest.fn() } as unknown as PermissionsService;
    const crypto = { blindIndex: jest.fn(), generateToken: jest.fn() } as unknown as CryptoService;
    const passwords = { assertPolicy: jest.fn(), hash: jest.fn() } as unknown as PasswordService;
    const roles = { findByKeys: jest.fn() } as unknown as RolesService;
    const audit = { recordImmediate: jest.fn(), record: jest.fn() } as unknown as AuditService;
    const usersLimitGuard = { reserve: jest.fn(), release: jest.fn() } as unknown as PlanLimitUsersGuard;
    const service = new UsersService(
      prisma,
      repository,
      crypto,
      passwords,
      permissions,
      roles,
      audit,
      usersLimitGuard,
    );
    return { service, prisma, repository, permissions, crypto, passwords, roles, audit, usersLimitGuard };
  }

  it('does not allow an operator to suspend their own account', async () => {
    const { service, prisma, audit } = setup();
    await expect(service.suspend(tenantId, actorId, 'reason', context)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(audit.recordImmediate).not.toHaveBeenCalled();
  });

  it('looks up a user through a tenant-scoped repository projection', async () => {
    const { service, repository } = setup();
    jest.mocked(repository.findById).mockResolvedValue(null);

    await expect(service.findById(tenantId, 'user-from-another-tenant')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.findById).toHaveBeenCalledWith(tenantId, 'user-from-another-tenant');
  });

  it('rejects role IDs outside the tenant-visible role set before mutation', async () => {
    const { service, prisma, repository } = setup();
    jest.mocked(repository.findById).mockResolvedValue({ roles: [] } as never);
    jest.mocked(prisma.role.findMany).mockResolvedValue([] as never);

    await expect(service.assignRoles(tenantId, 'user-a', ['foreign-role'], context)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['foreign-role'] }, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, key: true, scope: true },
    });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userRole.createMany).not.toHaveBeenCalled();
  });

  it('refuses to suspend the only active tenant administrator', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.userRole.findFirst)
      .mockResolvedValueOnce({ userId: 'admin-a' } as never)
      .mockResolvedValueOnce(null as never);

    await expect(service.suspend(tenantId, 'admin-a', 'maintenance', {
      ...context,
      actorId: 'admin-b',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.userRole.findFirst).toHaveBeenCalledTimes(2);
  });

  it('refuses to remove TENANT_ADMIN from its last active holder', async () => {
    const { service, prisma, repository } = setup();
    jest.mocked(repository.findById).mockResolvedValue({
      roles: [{ role: { key: 'TENANT_ADMIN' } }],
    } as never);
    jest.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'follower-role', key: 'FOLLOWER', scope: 'TENANT' },
    ] as never);
    jest.mocked(prisma.userRole.findFirst)
      .mockResolvedValueOnce({ userId: 'admin-a' } as never)
      .mockResolvedValueOnce(null as never);

    await expect(service.assignRoles(tenantId, 'admin-a', ['follower-role'], {
      ...context,
      actorId: 'admin-b',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userRole.createMany).not.toHaveBeenCalled();
  });

  it('does not allow a tenant id embedded in user update data to change the caller tenant scope', async () => {
    const { service, repository } = setup();
    const update = {
      firstName: 'New name',
      tenantId: 'tenant-b',
    } as never;
    jest.mocked(repository.findById).mockResolvedValue(null);

    await expect(service.updateProfile(tenantId, 'user-a', update, context)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repository.findById).toHaveBeenCalledWith(tenantId, 'user-a');
  });

  it('never authenticates a soft-deleted user or loads permissions for that user', async () => {
    const { service, repository, permissions } = setup();
    jest.mocked(repository.findById).mockResolvedValue(null);

    await expect(service.findByIdForSession('deleted-user', tenantId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.findById).toHaveBeenCalledWith(tenantId, 'deleted-user');
    expect(permissions.getEffectiveAccess).not.toHaveBeenCalled();
    expect(permissions.getEffectiveAccessForTenant).not.toHaveBeenCalled();
  });

  it('creates a user only in the authenticated tenant when the client supplies a different tenantId', async () => {
    const { service, prisma, repository, crypto, passwords, roles, usersLimitGuard } = setup();
    jest.mocked(repository.findByEmailIndex).mockResolvedValue(null);
    jest.mocked(crypto.blindIndex).mockReturnValue('email-index');
    jest.mocked(crypto.generateToken).mockReturnValue('invite-token');
    jest.mocked(passwords.hash).mockResolvedValue('password-hash');
    jest.mocked(roles.findByKeys).mockResolvedValue([{ id: 'role-follower', key: 'FOLLOWER' }] as never);
    jest.mocked(usersLimitGuard.reserve).mockResolvedValue({ allowed: true } as never);
    jest.spyOn(service, 'findById').mockResolvedValue({ id: 'user-a' } as never);

    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-a' }) },
      userRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (callback: unknown) =>
      (callback as (transaction: typeof tx) => Promise<{ id: string }>)(tx),
    );

    const dto = { email: 'member@example.test', tenantId: 'tenant-b' } as never;
    await service.create(tenantId, dto, context);

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId, email: 'member@example.test', emailIndex: 'email-index' }),
      select: { id: true },
    }));
    expect(tx.user.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-b' }),
    }));
    expect(repository.findByEmailIndex).toHaveBeenCalledWith(tenantId, 'email-index');
  });

});
