import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettlementService } from './settlement.service';
import { FundingRequestService } from '../client-lifecycle/funding-request.service';
import { FundingRequestState } from '../client-lifecycle/client-lifecycle.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;

(adminUrl && rlsUrl ? describe : describe.skip)('deposit settlement with forced PostgreSQL RLS', () => {
  const tenantId = randomUUID(), otherTenantId = randomUUID();
  const profileId = randomUUID(), accountId = randomUUID(), depositId = randomUUID();
  const networkId = `test-${randomUUID()}`, assetId = `ETH-${randomUUID()}`;
  const now = new Date();
  let admin: PrismaService, db: PrismaService, settlement: SettlementService, fundingId: string;
  const prisma = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);

  beforeAll(async () => {
    admin = prisma(adminUrl!); db = prisma(rlsUrl!); settlement = new SettlementService(db);
    await admin.tenant.createMany({ data: [tenantId, otherTenantId].map((id) => ({ id, slug: `settlement-${id}`, name: 'Settlement test' })) });
    await admin.clientProfile.create({ data: { id: profileId, tenantId, status: 'ACTIVE', idempotencyKey: `profile-${profileId}` } });
    await admin.institutionalAccount.create({ data: { id: accountId, tenantId, clientProfileId: profileId, state: 'ACTIVE',
      isFundingEnabled: true, idempotencyKey: `account-${accountId}` } });
    const funding = await admin.fundingRequest.create({ data: { tenantId, accountId, clientProfileId: profileId, state: 'SUBMITTED',
      currency: 'ETH', requestedAmount: '1', submittedAmount: '1', idempotencyKey: randomUUID() } });
    fundingId = funding.id;
    await admin.custodyNetwork.create({ data: { networkId, name: 'Test Ethereum network', status: 'ACTIVE' } });
    await admin.custodyAsset.create({ data: { assetId, symbol: 'ETH', name: 'Test Ether', decimals: 18, isActive: true, networkId } });
    const wallet = await admin.custodyWallet.create({ data: { tenantId, accountId, assetId, networkId, idempotencyKey: randomUUID() } });
    await admin.custodyDeposit.create({ data: { id: depositId, tenantId, walletId: wallet.id, assetId, networkId, amount: '1',
      transactionHash: '0xsettlement-guard', toAddress: '0xtestaddress', providerReference: 'provider-transaction', state: 'CONFIRMED',
      confirmationCount: 12, requiredConfirmationCount: 6, isFinal: true, confirmedAt: now, fundingRequestId: fundingId, idempotencyKey: randomUUID() } });
    await admin.custodyTransaction.create({ data: { tenantId, walletId: wallet.id, assetId, networkId, amount: '1', direction: 'IN',
      transactionHash: '0xsettlement-guard', blockHash: '0xblock', blockNumber: '42', providerReference: 'provider-transaction',
      status: 'CONFIRMED', confirmationCount: 12, requiredConfirmationCount: 6, confirmedAt: now, depositId, idempotencyKey: randomUUID() } });
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await admin.custodyAsset.deleteMany({ where: { assetId } });
    await admin.custodyNetwork.deleteMany({ where: { networkId } });
    await db.$disconnect(); await admin.$disconnect();
  });

  it('refuses to finalize a matching confirmed transfer without a spendable customer credit', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => settlement.finalizeDepositSettlement({ tenantId, depositId })));
    expect(attempts).toHaveLength(3);
    for (const result of attempts) expect(result.status === 'rejected' && result.reason instanceof ServiceUnavailableException).toBe(true);
    expect(await admin.fundingRequest.findUniqueOrThrow({ where: { id: fundingId } })).toMatchObject({
      state: 'SUBMITTED', confirmedAmount: null, settledAmount: null, externalReference: null,
    });
    expect(await admin.custodyAudit.count({ where: { tenantId, entityId: depositId, action: 'SETTLEMENT_FINALIZED' } })).toBe(0);
  });

  it('does not expose or mutate a deposit from a different tenant', async () => {
    await expect(settlement.finalizeDepositSettlement({ tenantId: otherTenantId, depositId })).rejects.toThrow('Deposit not found');
    expect((await admin.fundingRequest.findUniqueOrThrow({ where: { id: fundingId } })).state).toBe('SUBMITTED');
  });

  it('does not allow the generic funding transition to bypass customer credit verification', async () => {
    const funding = new FundingRequestService(db, {} as never, {} as never, {} as never);
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => funding.transitionFundingRequest({
      tenantId, fundingRequestId: fundingId, toState: FundingRequestState.CONFIRMED,
      confirmedAmount: '1', settledAmount: '1', externalReference: 'unverified-reference',
    })));
    for (const result of attempts) expect(result.status === 'rejected' && result.reason instanceof ServiceUnavailableException).toBe(true);
    await expect(funding.transitionFundingRequest({ tenantId, fundingRequestId: fundingId, toState: FundingRequestState.FAILED,
      settledAmount: '1' })).rejects.toThrow('require verified funding settlement');
    await expect(funding.transitionFundingRequest({ tenantId: otherTenantId, fundingRequestId: fundingId,
      toState: FundingRequestState.CONFIRMED, confirmedAmount: '1' })).rejects.toThrow('Funding request not found');
    expect(await admin.fundingRequest.findUniqueOrThrow({ where: { id: fundingId } })).toMatchObject({ state: 'SUBMITTED', settledAmount: null });
    expect(await admin.outboxEvent.count({ where: { tenantId, aggregateId: fundingId, eventType: 'funding.confirmed' } })).toBe(0);
  });

  it('serializes conflicting funding transitions and commits their audit with the winner', async () => {
    const request = await admin.fundingRequest.create({ data: { tenantId, accountId, clientProfileId: profileId, state: 'APPROVED',
      currency: 'ETH', requestedAmount: '1', approvedAmount: '1', idempotencyKey: randomUUID() } });
    const funding = new FundingRequestService(db, {} as never, {} as never, {} as never);
    const attempts = await Promise.allSettled([
      funding.transitionFundingRequest({ tenantId, fundingRequestId: request.id, toState: FundingRequestState.SUBMITTED, submittedAmount: '1' }),
      funding.transitionFundingRequest({ tenantId, fundingRequestId: request.id, toState: FundingRequestState.CANCELLED }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await admin.fundingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(['SUBMITTED', 'CANCELLED']).toContain(row.state);
    const audit = await admin.clientLifecycleAudit.findMany({ where: { tenantId, entityId: request.id, action: 'FUNDING_STATE_CHANGED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fromState: 'APPROVED', toState: row.state });
  });

  it('validates transition amounts without rounding small decimal units', async () => {
    const request = await admin.fundingRequest.create({ data: { tenantId, accountId, clientProfileId: profileId, state: 'APPROVED',
      currency: 'ETH', requestedAmount: '1', approvedAmount: '1', idempotencyKey: randomUUID() } });
    const funding = new FundingRequestService(db, {} as never, {} as never, {} as never);
    for (const value of ['0', '-1', '1e-3', '1'.repeat(65)]) {
      await expect(funding.transitionFundingRequest({ tenantId, fundingRequestId: request.id,
        toState: FundingRequestState.SUBMITTED, submittedAmount: value })).rejects.toThrow('positive decimal string');
    }
    const result = await funding.transitionFundingRequest({ tenantId, fundingRequestId: request.id,
      toState: FundingRequestState.SUBMITTED, submittedAmount: '0.000000000000000001' });
    expect(result.submittedAmount).toBe('0.000000000000000001');
    expect((await admin.fundingRequest.findUniqueOrThrow({ where: { id: request.id } })).submittedAmount).toBe('0.000000000000000001');
  });

  it('rolls back a funding transition if its required audit cannot be persisted', async () => {
    const request = await admin.fundingRequest.create({ data: { tenantId, accountId, clientProfileId: profileId, state: 'APPROVED',
      currency: 'ETH', requestedAmount: '1', approvedAmount: '1', idempotencyKey: randomUUID() } });
    const funding = new FundingRequestService(db, {} as never, {} as never, {} as never);
    await expect(funding.transitionFundingRequest({ tenantId, fundingRequestId: request.id, toState: FundingRequestState.SUBMITTED,
      submittedAmount: '1', operatorId: 'not-a-valid-uuid' })).rejects.toThrow();
    expect((await admin.fundingRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe('APPROVED');
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId, entityId: request.id, action: 'FUNDING_STATE_CHANGED' } })).toBe(0);
  });

  it('does not accept an existing funding status as proof of a customer balance', async () => {
    await admin.fundingRequest.update({ where: { id: fundingId }, data: { state: 'CONFIRMED',
      confirmedAmount: '1', settledAmount: '1', externalReference: '0xsettlement-guard', confirmedAt: now } });
    await expect(settlement.finalizeDepositSettlement({ tenantId, depositId })).rejects.toThrow(ServiceUnavailableException);
    expect(await admin.custodyAudit.count({ where: { tenantId, entityId: depositId, action: 'SETTLEMENT_FINALIZED' } })).toBe(0);
  });
});
