import { ForbiddenException } from '@nestjs/common';
import { CustodyVisibilityService } from './custody-visibility.service';
import { CustodyScope } from './custody.types';

/**
 * Wallet visibility after the round-7 scope fix. assertCanAccessWallet used to substitute the
 * wallet's own clientProfileId/accountId when the caller supplied none, so the CLIENT ownership
 * check compared the wallet with itself and always passed. Now only the caller's own
 * identifiers count: a CLIENT without them is refused, a CLIENT with another owner's ids is
 * refused, tenant-scoped staff scopes see their tenant's wallets and never another tenant's.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function service() {
  const wallets: Record<string, any> = {
    'w-own': { id: 'w-own', tenantId: TENANT, clientProfileId: 'cp-1', accountId: 'acct-1' },
    'w-other-tenant': { id: 'w-other-tenant', tenantId: OTHER_TENANT, clientProfileId: 'cp-9', accountId: 'acct-9' },
  };
  const prisma = {
    custodyWallet: {
      findFirst: jest.fn(async ({ where }: any) => {
        const wallet = wallets[where.id];
        if (!wallet) return null;
        if (where.tenantId && wallet.tenantId !== where.tenantId) return null;
        return wallet;
      }),
    },
  };
  return new CustodyVisibilityService(prisma as any);
}

describe('custody wallet visibility', () => {
  it('refuses a CLIENT scope that carries no ownership identifiers of its own', async () => {
    await expect(service().assertCanAccessWallet({ tenantId: TENANT, walletId: 'w-own', scope: CustodyScope.CLIENT })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses a CLIENT scope naming another owner, allows the wallet's own owner", async () => {
    const svc = service();
    await expect(
      svc.assertCanAccessWallet({ tenantId: TENANT, walletId: 'w-own', scope: CustodyScope.CLIENT, clientProfileId: 'cp-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.assertCanAccessWallet({ tenantId: TENANT, walletId: 'w-own', scope: CustodyScope.CLIENT, clientProfileId: 'cp-1' }),
    ).resolves.toBeUndefined();
  });

  it.each([CustodyScope.TENANT_OWNER, CustodyScope.TREASURY_OPERATOR, CustodyScope.COMPLIANCE_REVIEWER])(
    '%s sees wallets of its own tenant only',
    async (scope) => {
      const svc = service();
      await expect(svc.assertCanAccessWallet({ tenantId: TENANT, walletId: 'w-own', scope })).resolves.toBeUndefined();
      await expect(svc.assertCanAccessWallet({ tenantId: TENANT, walletId: 'w-other-tenant', scope })).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
});
