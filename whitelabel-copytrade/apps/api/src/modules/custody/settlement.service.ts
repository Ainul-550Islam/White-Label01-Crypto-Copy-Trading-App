// # Responsibility: bridge complete custody confirmation evidence into tenant-bound submitted workflows atomically with audit; never swallow a required settlement failure.
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type CustodyDeposit, type CustodyWithdrawal, type CustodyTransaction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditAction, CustodySettlementState, cmp, custodyJsonInput, isValidDecimal } from './custody.types';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async finalizeDepositSettlement(params: {
    tenantId: string; depositId: string; operatorId?: string | null; correlationId?: string | null;
  }): Promise<never> {
    const { tenantId, depositId } = params;
    return this.prisma.$transaction(async (tx) => {
      // Custody and funding rows are tenant protected; a bare transaction on
      // a non-bypass role would otherwise be unable to see either record.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const deposit = await tx.custodyDeposit.findFirst({ where: { id: depositId, tenantId } });
      if (!deposit) throw new BadRequestException('Deposit not found');
      this.assertConfirmation(deposit, 'Deposit');
      const transactionHash = deposit.transactionHash;
      if (!transactionHash) throw new BadRequestException('Deposit settlement requires authoritative transaction hash');
      const transaction = await tx.custodyTransaction.findFirst({ where: { tenantId, depositId, transactionHash } });
      this.assertTransaction(transaction, deposit);
      if (deposit.fundingRequestId) {
        const request = await tx.fundingRequest.findFirst({ where: { id: deposit.fundingRequestId, tenantId } });
        if (!request) throw new BadRequestException('Linked funding request not found for this tenant');
        const wallet = deposit.walletId ? await tx.custodyWallet.findFirst({ where: { id: deposit.walletId, tenantId } }) : null;
        const asset = await tx.custodyAsset.findFirst({ where: { assetId: deposit.assetId, isActive: true } });
        if (!wallet || wallet.accountId !== request.accountId || !asset || asset.symbol !== request.currency) {
          throw new BadRequestException('Linked funding account/currency does not match custody evidence');
        }
        if (request.state === 'CONFIRMED') {
          if (request.externalReference !== transactionHash || request.confirmedAmount === null || request.settledAmount === null
            || cmp(request.confirmedAmount, deposit.amount) !== 0 || cmp(request.settledAmount, deposit.amount) !== 0) {
            throw new BadRequestException('Conflicting previously confirmed funding evidence');
          }
        } else if (request.state !== 'SUBMITTED' || request.submittedAmount === null || cmp(request.submittedAmount, deposit.amount) !== 0) {
          throw new BadRequestException('Funding settlement requires a matching submitted amount/state');
        }
      }
      // A custody state, transaction hash, confirmation count or portfolio
      // reporting entry is not proof of a spendable customer-liability credit.
      // Never mutate the request or claim SETTLED until a verified, atomic
      // customer credit exists in the authoritative balance system.
      throw new ServiceUnavailableException('Customer credit has not been independently verified; deposit settlement cannot be finalized.');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async finalizeWithdrawalSettlement(params: {
    tenantId: string; custodyWithdrawalId: string; operatorId?: string | null; correlationId?: string | null;
  }): Promise<{ custodyWithdrawalId: string; settled: true; transactionHash: string; settlementState: CustodySettlementState.SETTLED }> {
    const { tenantId, custodyWithdrawalId, operatorId = null, correlationId = null } = params;
    const result = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.custodyWithdrawal.findFirst({ where: { id: custodyWithdrawalId, tenantId } });
      if (!withdrawal) throw new BadRequestException('Custody withdrawal not found');
      this.assertConfirmation(withdrawal, 'Withdrawal');
      const transactionHash = withdrawal.transactionHash;
      if (!transactionHash) throw new BadRequestException('Withdrawal settlement requires authoritative transaction hash');
      const transaction = await tx.custodyTransaction.findFirst({ where: { tenantId, withdrawalId: custodyWithdrawalId, transactionHash } });
      this.assertTransaction(transaction, withdrawal);
      if (withdrawal.withdrawalRequestId) {
        const request = await tx.withdrawalRequest.findFirst({ where: { id: withdrawal.withdrawalRequestId, tenantId } });
        if (!request) throw new BadRequestException('Linked withdrawal request not found for this tenant');
        const wallet = withdrawal.walletId ? await tx.custodyWallet.findFirst({ where: { id: withdrawal.walletId, tenantId } }) : null;
        const asset = await tx.custodyAsset.findFirst({ where: { assetId: withdrawal.assetId, isActive: true } });
        if (!wallet || wallet.accountId !== request.accountId || withdrawal.accountId !== request.accountId
          || !asset || asset.symbol !== request.currency || request.destinationAddress !== withdrawal.destinationAddress) {
          throw new BadRequestException('Linked withdrawal account/currency/destination does not match custody evidence');
        }
        if (request.state === 'CONFIRMED') {
          if (request.externalReference !== transactionHash || request.confirmedAmount === null || request.settledAmount === null
            || cmp(request.confirmedAmount, withdrawal.amount) !== 0 || cmp(request.settledAmount, withdrawal.amount) !== 0) {
            throw new BadRequestException('Conflicting previously confirmed withdrawal evidence');
          }
        } else {
          if (request.state !== 'SUBMITTED' || request.submittedAmount === null || cmp(request.submittedAmount, withdrawal.amount) !== 0) {
            throw new BadRequestException('Withdrawal settlement requires a matching submitted amount/state');
          }
          const updated = await tx.withdrawalRequest.updateMany({ where: { id: request.id, tenantId, state: 'SUBMITTED', submittedAmount: request.submittedAmount },
            data: { state: 'CONFIRMED', confirmedAt: withdrawal.confirmedAt, confirmedAmount: withdrawal.amount,
              settledAmount: withdrawal.amount, externalReference: transactionHash } });
          if (updated.count !== 1) throw new BadRequestException('Withdrawal settlement changed concurrently');
        }
      }
      await tx.custodyAudit.create({ data: { tenantId, walletId: withdrawal.walletId, action: CustodyAuditAction.SETTLEMENT_FINALIZED,
        entityType: 'CUSTODY_WITHDRAWAL', entityId: custodyWithdrawalId, actorId: operatorId, correlationId,
        evidence: custodyJsonInput({ transactionHash, amount: withdrawal.amount, assetId: withdrawal.assetId, networkId: withdrawal.networkId,
          withdrawalRequestId: withdrawal.withdrawalRequestId, transactionId: transaction?.id }) } });
      return { custodyWithdrawalId, settled: true, transactionHash, settlementState: CustodySettlementState.SETTLED } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.logger.log({ event: 'custody.settlement.withdrawal_finalized', tenantId, custodyWithdrawalId });
    return result;
  }

  async handleReorgSettlement(params: { tenantId: string; transactionId: string; reason: string }): Promise<{
    transactionId: string; settlementState: CustodySettlementState.REORGED; reason: string; reconciliationRequired: true;
  }> {
    const { tenantId, transactionId, reason } = params;
    if (!reason.trim()) throw new BadRequestException('A reorg reason is required');
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
      if (!transaction) throw new BadRequestException('Transaction not found');
      const updated = await tx.custodyTransaction.updateMany({ where: { id: transactionId, tenantId, status: transaction.status },
        data: { status: 'REORGED', isReorged: true, reorgedAt: new Date(), failureReason: reason } });
      if (updated.count !== 1) throw new BadRequestException('Transaction changed concurrently during reorg');
      if (transaction.depositId) {
        const deposit = await tx.custodyDeposit.findFirst({ where: { id: transaction.depositId, tenantId } });
        if (!deposit) throw new BadRequestException('Reorg deposit link missing for tenant');
        const depositUpdate = await tx.custodyDeposit.updateMany({ where: { id: deposit.id, tenantId }, data: { state: 'REORGED', isFinal: false, failureReason: reason } });
        if (depositUpdate.count !== 1) throw new BadRequestException('Reorg deposit update unavailable');
      }
      if (transaction.withdrawalId) {
        const withdrawal = await tx.custodyWithdrawal.findFirst({ where: { id: transaction.withdrawalId, tenantId } });
        if (!withdrawal) throw new BadRequestException('Reorg withdrawal link missing for tenant');
        const withdrawalUpdate = await tx.custodyWithdrawal.updateMany({ where: { id: withdrawal.id, tenantId }, data: { state: 'REORGED', failureReason: reason } });
        if (withdrawalUpdate.count !== 1) throw new BadRequestException('Reorg withdrawal update unavailable');
      }
      await tx.custodyAudit.create({ data: { tenantId, walletId: transaction.walletId, action: 'TRANSACTION_REORGED',
        entityType: 'CUSTODY_TRANSACTION', entityId: transactionId, reason,
        evidence: custodyJsonInput({ transactionHash: transaction.transactionHash, previousState: transaction.status,
          reconciliationRequired: true, note: 'Portfolio/funding reconciliation and incident handling are not claimed completed by this mutation' }) } });
      return { transactionId, settlementState: CustodySettlementState.REORGED, reason, reconciliationRequired: true } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertConfirmation(record: CustodyDeposit | CustodyWithdrawal, label: string): void {
    if (record.state !== 'CONFIRMED' || !record.confirmedAt || !record.transactionHash || !record.providerReference
      || !Number.isSafeInteger(record.requiredConfirmationCount) || record.requiredConfirmationCount <= 0
      || !Number.isSafeInteger(record.confirmationCount) || record.confirmationCount < record.requiredConfirmationCount
      || !isValidDecimal(record.amount) || cmp(record.amount, '0') <= 0) {
      throw new BadRequestException(`${label} must be CONFIRMED with complete provider confirmation evidence to finalize settlement`);
    }
  }

  private assertTransaction(transaction: CustodyTransaction | null, record: CustodyDeposit | CustodyWithdrawal): void {
    if (!transaction || transaction.tenantId !== record.tenantId || transaction.walletId !== record.walletId
      || transaction.assetId !== record.assetId || transaction.networkId !== record.networkId || cmp(transaction.amount, record.amount) !== 0
      || transaction.transactionHash !== record.transactionHash || transaction.isReorged
      || !['CONFIRMED', 'FINAL'].includes(transaction.status) || !transaction.providerReference || !transaction.blockHash || !transaction.blockNumber
      || !transaction.confirmedAt || transaction.confirmationCount < record.requiredConfirmationCount) {
      throw new BadRequestException('Matching non-reorged custody transaction evidence is required');
    }
  }
}
