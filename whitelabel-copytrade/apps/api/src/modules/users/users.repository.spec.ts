// # Responsibility: verifies tenant-scoped user lookups and excludes soft-deleted accounts from public administration lists.
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersRepository } from './users.repository';

describe('UsersRepository tenant isolation and deletion semantics', () => {
  function setup() {
    const prisma = {
      user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    return { repository: new UsersRepository(prisma), prisma };
  }

  it('scopes user-id reads by tenant and refuses soft-deleted users', async () => {
    const { repository, prisma } = setup();
    jest.mocked(prisma.user.findFirst).mockResolvedValue(null);

    await expect(repository.findById('tenant-a', 'user-b')).resolves.toBeNull();
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-b', tenantId: 'tenant-a', deletedAt: null },
      select: expect.any(Object),
    });
  });

  it('enforces blind-index uniqueness within each tenant without crossing tenant boundaries', async () => {
    const { repository, prisma } = setup();
    jest.mocked(prisma.user.findFirst).mockResolvedValue(null);

    await repository.findByEmailIndex('tenant-a', 'blind-index');
    await repository.findByEmailIndex('tenant-b', 'blind-index');

    expect(jest.mocked(prisma.user.findFirst).mock.calls.map(([query]) => query)).toEqual([
      { where: { tenantId: 'tenant-a', emailIndex: 'blind-index' }, select: expect.any(Object) },
      { where: { tenantId: 'tenant-b', emailIndex: 'blind-index' }, select: expect.any(Object) },
    ]);
  });

  it('never returns soft-deleted rows even when unknown query properties request them', async () => {
    const { repository, prisma } = setup();
    await repository.list('tenant-a', { includeDeleted: true } as never);
    const findManyQuery = jest.mocked(prisma.user.findMany).mock.calls[0]?.[0] as { where: Record<string, unknown> };
    const countQuery = jest.mocked(prisma.user.count).mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findManyQuery.where).toMatchObject({ tenantId: 'tenant-a', deletedAt: null });
    expect(countQuery.where).toMatchObject({ tenantId: 'tenant-a', deletedAt: null });
  });
});
