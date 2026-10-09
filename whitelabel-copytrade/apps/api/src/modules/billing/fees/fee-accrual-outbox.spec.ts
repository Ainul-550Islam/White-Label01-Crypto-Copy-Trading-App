// # NEW — Verifies fee-accrual persistence and its immutable outbox event share the tenant transaction

import { FeeAccrualService } from './fee-accrual.service';
import { FeeAccrualStatus, FeeSourceType, FeeType, SettlementState } from './fee.types';

describe('FeeAccrualService transactional outbox', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const tx = { transactionMarker: true };
  const persisted = {
    id: 'accrual-1',
    tenantId,
    sourceType: FeeSourceType.PAYMENT,
    sourceId: 'payment-1',
    feeType: FeeType.PLATFORM_FEE,
    feeRateBps: 125,
    grossAmount: '100.00',
    feeAmount: '1.25',
    netAmount: '98.75',
    currency: 'USD',
    status: FeeAccrualStatus.ACCRUED,
    settlementState: SettlementState.DRAFT,
    idempotencyKey: 'fee-key-1',
  };

  it('writes one creation-status payload atomically and does not emit again after the accrual later settles', async () => {
    const accrualRepository = {
      findByIdempotencyKey: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...persisted, status: FeeAccrualStatus.SETTLED }),
      findBySource: jest.fn(async () => null),
      create: jest.fn(async () => persisted),
      updateStatus: jest.fn(),
    };
    const policyService = {
      resolvePolicy: jest.fn(async () => ({
        platformFeeBps: 125,
        performanceFeeBps: 200,
        minimumFee: null,
        maximumCap: null,
      })),
    };
    const calculatorService = {
      calculate: jest.fn(() => ({
        grossAmount: '100.00',
        feeAmount: '1.25',
        netAmount: '98.75',
        currency: 'USD',
        calculatedAt: new Date('2026-10-09T00:00:00.000Z'),
      })),
    };
    const ledgerService = { postAccrualToLedger: jest.fn(async () => []) };
    const auditService = {
      logAccrualRejected: jest.fn(),
      logFeeCalculated: jest.fn(),
      logFeeAccrued: jest.fn(),
      logLedgerPostingFailed: jest.fn(),
    };
    const prisma = {
      withTenantRls: jest.fn(async (_tenant: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const outbox = { append: jest.fn(async () => ({ id: 'outbox-accrual-1' })) };
    const service = new FeeAccrualService(
      accrualRepository as never,
      policyService as never,
      calculatorService as never,
      ledgerService as never,
      auditService as never,
      prisma as never,
      outbox as never,
    );
    const params = {
      tenantId,
      sourceType: FeeSourceType.PAYMENT,
      sourceId: 'payment-1',
      feeType: FeeType.PLATFORM_FEE,
      grossAmount: '100.00',
      currency: 'USD',
      idempotencyKey: 'fee-key-1',
    };

    await expect(service.accrueFee(params)).resolves.toMatchObject({ id: 'accrual-1', status: FeeAccrualStatus.ACCRUED });

    expect(prisma.withTenantRls).toHaveBeenCalledTimes(1);
    expect(prisma.withTenantRls).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(accrualRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, idempotencyKey: 'fee-key-1', status: FeeAccrualStatus.ACCRUED }),
      tx,
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        aggregateType: 'fee.accrual',
        aggregateId: 'accrual-1',
        eventType: 'fee.accrued',
        idempotencyKey: 'fee-accrual:accrual-1:accrued',
        payload: {
          accrualId: 'accrual-1',
          sourceType: FeeSourceType.PAYMENT,
          sourceId: 'payment-1',
          feeType: FeeType.PLATFORM_FEE,
          grossAmount: '100.00',
          feeAmount: '1.25',
          currency: 'USD',
          feeRateBps: 125,
          status: FeeAccrualStatus.ACCRUED,
        },
      }),
    );

    await expect(service.accrueFee(params)).resolves.toMatchObject({ id: 'accrual-1', status: FeeAccrualStatus.SETTLED });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(calculatorService.calculate).toHaveBeenCalledTimes(1);
  });
});
