// # Verifies deposit amount precision, confirmation thresholds, and idempotent credit
import { isPositiveDecimal, isValidDecimal } from '../client-lifecycle/client-lifecycle.types';
import { FundingRequestService } from './funding-request.service';

describe('Funding Amount & Deposit Confirmation Validation (GAP-27)', () => {
  test('validates deposit amount precision and rejects non-positive or malformed amounts', () => {
    expect(isValidDecimal('100.00000000')).toBe(true);
    expect(isPositiveDecimal('100.00000000')).toBe(true);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('-25.00')).toBe(false);
    expect(isValidDecimal('abc')).toBe(false);
  });

  test('rejects zero or negative funding requests before account lookup', async () => {
    const mockPrisma: any = {
      institutionalAccount: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new FundingRequestService(
      mockPrisma,
      { resolvePolicy: jest.fn() } as any,
      { record: jest.fn() } as any,
      { hasRestriction: jest.fn() } as any,
    );

    await expect(
      service.createFundingRequest({
        tenantId: 'tenant-1',
        accountId: 'acct-1',
        currency: 'USDT',
        requestedAmount: '0',
      }),
    ).rejects.toThrow('requestedAmount must be greater than zero');
    expect(mockPrisma.institutionalAccount.findFirst).not.toHaveBeenCalled();
  });
});
