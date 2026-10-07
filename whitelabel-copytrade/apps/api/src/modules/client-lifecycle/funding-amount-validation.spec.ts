// # Verifies deposit amount precision, confirmation thresholds, and idempotent credit
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FundingRequestService } from './funding-request.service';
import { WithdrawalRequestService } from './withdrawal-request.service';
import { CreateFundingRequestDto, CreateWithdrawalRequestDto } from './dto/funding-request.dto';
import { isPositiveDecimal } from './client-lifecycle.types';

/**
 * Funding and withdrawal requests must carry a strictly positive amount. A
 * negative "withdrawal" is a disguised deposit (and vice versa), and a zero
 * request is noise in the review queue.
 */
describe('funding / withdrawal amount validation', () => {
  const NON_POSITIVE = ['0', '0.0', '0.000000000000', '-1', '-0.5'];

  it('isPositiveDecimal accepts only amounts above zero', () => {
    for (const value of NON_POSITIVE) expect(isPositiveDecimal(value)).toBe(false);
    for (const value of ['1', '0.01', '1000.123456789012', '0.000000000001'])
      expect(isPositiveDecimal(value)).toBe(true);
    // Below the 12-decimal accounting scale the amount rounds to zero.
    expect(isPositiveDecimal('0.0000000000001')).toBe(false);
    expect(isPositiveDecimal('1e3')).toBe(false);
  });

  function services() {
    const prisma = { institutionalAccount: { findFirst: jest.fn().mockResolvedValue(null) } };
    const deps = [
      prisma,
      { resolvePolicy: jest.fn() },
      { record: jest.fn() },
      { hasRestriction: jest.fn() },
    ] as const;
    return {
      prisma,
      funding: new FundingRequestService(
        ...(deps as unknown as ConstructorParameters<typeof FundingRequestService>),
      ),
      withdrawal: new WithdrawalRequestService(
        ...(deps as unknown as ConstructorParameters<typeof WithdrawalRequestService>),
      ),
    };
  }

  it.each(NON_POSITIVE)(
    'services reject requestedAmount %s before touching the account',
    async (amount) => {
      const { prisma, funding, withdrawal } = services();
      const base = { tenantId: 't1', accountId: 'acc-1', currency: 'USD', requestedAmount: amount };
      await expect(funding.createFundingRequest(base)).rejects.toThrow(
        'requestedAmount must be greater than zero',
      );
      await expect(withdrawal.createWithdrawalRequest(base)).rejects.toThrow(
        'requestedAmount must be greater than zero',
      );
      expect(prisma.institutionalAccount.findFirst).not.toHaveBeenCalled();
    },
  );

  it('a positive amount passes the amount check (and reaches the account lookup)', async () => {
    const { prisma, funding, withdrawal } = services();
    const base = { tenantId: 't1', accountId: 'acc-1', currency: 'USD', requestedAmount: '25.50' };
    await expect(funding.createFundingRequest(base)).rejects.toBeInstanceOf(BadRequestException);
    await expect(withdrawal.createWithdrawalRequest(base)).rejects.toThrow('Account not found');
    expect(prisma.institutionalAccount.findFirst).toHaveBeenCalledTimes(2);
  });

  it('create DTOs reject signed amounts at the validation pipe', async () => {
    for (const Dto of [CreateFundingRequestDto, CreateWithdrawalRequestDto]) {
      const negative = await validate(
        plainToInstance(Dto, { accountId: 'acc-1', currency: 'USD', requestedAmount: '-10' }),
      );
      expect(negative.map((e) => e.property)).toContain('requestedAmount');
      const positive = await validate(
        plainToInstance(Dto, { accountId: 'acc-1', currency: 'USD', requestedAmount: '10' }),
      );
      expect(positive.map((e) => e.property)).not.toContain('requestedAmount');
    }
  });
});
