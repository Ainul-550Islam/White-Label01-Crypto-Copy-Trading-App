// # Responsibility: verifies cash ledger operations refuse unknown reads and invalid FX evidence.
import { BadRequestException } from '@nestjs/common';
import { CashLedgerService } from './cash-ledger.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingEventRepository } from './accounting-event.repository';
import { AccountingPolicyService } from './accounting-policy.service';
import { PortfolioCashFlowType } from './portfolio-accounting.types';

describe('CashLedgerService fail-closed balance handling', () => {
  const baseParams = {
    tenantId: 'tenant-1', profileId: 'profile-1', cashFlowType: PortfolioCashFlowType.DEPOSIT,
    asset: 'USD', amount: '10.25', currency: 'USD', occurredAt: new Date('2026-10-01T00:00:00.000Z'),
    sourceType: 'TEST', sourceId: 'source-1',
  };

  function setup() {
    const prisma = {
      portfolioCashLedgerEntry: {
        findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn(),
      },
    } as unknown as PrismaService;
    const policy = { resolvePolicy: jest.fn().mockResolvedValue({ baseCurrency: 'USD', calculationVersion: 'test-v1', policyVersion: 'policy-v1' }) } as unknown as AccountingPolicyService;
    const service = new CashLedgerService(prisma, {} as AccountingEventRepository, policy);
    return { service, prisma, policy };
  }

  it('does not create a movement if the idempotency lookup fails', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.portfolioCashLedgerEntry.findFirst).mockRejectedValue(new Error('database unavailable'));

    await expect(service.recordCashMovement(baseParams)).rejects.toThrow('database unavailable');
    expect(prisma.portfolioCashLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('does not substitute a zero balance when the ledger read fails', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.portfolioCashLedgerEntry.findMany).mockRejectedValue(new Error('database unavailable'));

    await expect(service.getCashBalance({ tenantId: 'tenant-1', profileId: 'profile-1' })).rejects.toThrow('database unavailable');
  });

  it('does not treat an outflow as a positive balance when no prior balance exists', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.portfolioCashLedgerEntry.findFirst).mockResolvedValue(null as never);

    await expect(service.recordCashMovement({ ...baseParams, cashFlowType: PortfolioCashFlowType.WITHDRAWAL })).rejects.toThrow('No prior cash-ledger balance');
    expect(prisma.portfolioCashLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects invalid foreign-exchange evidence before recording a movement', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.portfolioCashLedgerEntry.findFirst).mockResolvedValue(null as never);

    await expect(service.recordCashMovement({
      ...baseParams, asset: 'BTC', currency: 'BTC', baseCurrency: 'USD', conversionRate: '0', conversionSource: 'untrusted',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.portfolioCashLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('persists exact decimal strings without converting financial values to floating point', async () => {
    const { service, prisma } = setup();
    jest.mocked(prisma.portfolioCashLedgerEntry.findFirst).mockResolvedValue(null as never);
    jest.mocked(prisma.portfolioCashLedgerEntry.create).mockResolvedValue({ id: 'created-entry' } as never);

    await service.recordCashMovement({ ...baseParams, amount: '0.100000000001' });
    const write = jest.mocked(prisma.portfolioCashLedgerEntry.create).mock.calls[0]?.[0] as {
      data: { amount: string; runningBalance: string; baseCurrencyAmount: string };
    };
    expect(write.data.amount).toBe('0.100000000001');
    expect(write.data.runningBalance).toBe('0.100000000001');
    expect(write.data.baseCurrencyAmount).toBe('0.100000000001');
  });

  it('returns an existing idempotent entry without writing a second movement', async () => {
    const { service, prisma } = setup();
    const existing = { id: 'existing-entry', amount: '10.25' };
    jest.mocked(prisma.portfolioCashLedgerEntry.findFirst).mockResolvedValue(existing as never);

    await expect(service.recordCashMovement(baseParams)).resolves.toBe(existing);
    expect(prisma.portfolioCashLedgerEntry.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.portfolioCashLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a negative amount rather than reversing the direction implicitly', async () => {
    const { service, prisma } = setup();
    await expect(service.recordCashMovement({ ...baseParams, amount: '-0.01' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.portfolioCashLedgerEntry.findFirst).not.toHaveBeenCalled();
    expect(prisma.portfolioCashLedgerEntry.create).not.toHaveBeenCalled();
  });

});
