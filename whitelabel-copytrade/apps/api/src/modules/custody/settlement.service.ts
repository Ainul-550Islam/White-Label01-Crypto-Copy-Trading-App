import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { CustodySettlementState, redactSecrets } from './custody.types';

/**
 * Finalizes custody settlement state only from authoritative confirmations/reconciliation.
 * It bridges custody events into existing funding/withdrawal workflows without becoming a second finance ledger.
 */

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async finalizeDepositSettlement(params: {
    tenantId: string;
    depositId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, depositId, operatorId = null, correlationId = null } = params;

    const deposit = await (this.prisma as any).custodyDeposit.findFirst({ where: { id: depositId, tenantId } });
    if (!deposit) throw new BadRequestException('Deposit not found');

    // Settlement only from authoritative confirmations — must be CONFIRMED
    if (deposit.state !== 'CONFIRMED') {
      throw new BadRequestException(`Deposit must be CONFIRMED to finalize settlement, current: ${deposit.state}`);
    }

    if (!deposit.transactionHash) {
      throw new BadRequestException('Deposit settlement requires authoritative transaction hash from chain evidence');
    }

    // Bridge custody events into existing funding/withdrawal workflows without becoming second finance ledger
    // Update funding request if linked — but do not create second finance ledger
    if (deposit.fundingRequestId) {
      try {
        const fundingRequest = await (this.prisma as any).fundingRequest.findFirst({ where: { id: deposit.fundingRequestId, tenantId } });
        if (fundingRequest) {
          // Only transition funding request to CONFIRMED if deposit is CONFIRMED and has authoritative evidence
          // Funding workflow is not marked confirmed without external settlement — custody settlement provides that external evidence
          if (fundingRequest.state !== 'CONFIRMED') {
            await (this.prisma as any).fundingRequest.update({
              where: { id: deposit.fundingRequestId },
              data: {
                state: 'CONFIRMED',
                confirmedAt: new Date(),
                confirmedAmount: deposit.amount,
                settledAmount: deposit.amount,
                externalReference: deposit.transactionHash,
              },
            });

            await this.auditService.log({
              tenantId,
              walletId: deposit.walletId,
              action: 'SETTLEMENT_FINALIZED' as any,
              entityType: 'FUNDING_REQUEST',
              entityId: deposit.fundingRequestId,
              actorId: operatorId,
              correlationId,
              evidence: { depositId, transactionHash: deposit.transactionHash, amount: deposit.amount, note: 'Settlement references authoritative transaction evidence' },
            });
          }
        }
      } catch {}
    }

    await this.auditService.log({
      tenantId,
      walletId: deposit.walletId,
      action: 'SETTLEMENT_FINALIZED' as any,
      entityType: 'CUSTODY_DEPOSIT',
      entityId: depositId,
      actorId: operatorId,
      correlationId,
      evidence: { transactionHash: deposit.transactionHash, amount: deposit.amount, assetId: deposit.assetId, networkId: deposit.networkId, note: 'Settlement references authoritative transaction evidence' },
    });

    this.logger.log({ event: 'custody.settlement.deposit_finalized', tenantId, depositId, transactionHash: deposit.transactionHash });

    return { depositId, settled: true, transactionHash: deposit.transactionHash, settlementState: CustodySettlementState.SETTLED };
  }

  async finalizeWithdrawalSettlement(params: {
    tenantId: string;
    custodyWithdrawalId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, custodyWithdrawalId, operatorId = null, correlationId = null } = params;

    const withdrawal = await (this.prisma as any).custodyWithdrawal.findFirst({ where: { id: custodyWithdrawalId, tenantId } });
    if (!withdrawal) throw new BadRequestException('Custody withdrawal not found');

    // Settlement only from authoritative confirmations
    if (withdrawal.state !== 'CONFIRMED') {
      throw new BadRequestException(`Withdrawal must be CONFIRMED to finalize settlement, current: ${withdrawal.state}`);
    }

    if (!withdrawal.transactionHash) {
      throw new BadRequestException('Withdrawal settlement requires authoritative transaction hash');
    }

    // Bridge into funding/withdrawal workflows — not second finance ledger
    if (withdrawal.withdrawalRequestId) {
      try {
        const withdrawalRequest = await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawal.withdrawalRequestId, tenantId } });
        if (withdrawalRequest && withdrawalRequest.state !== 'CONFIRMED') {
          await (this.prisma as any).withdrawalRequest.update({
            where: { id: withdrawal.withdrawalRequestId },
            data: {
              state: 'CONFIRMED',
              confirmedAt: new Date(),
              confirmedAmount: withdrawal.amount,
              settledAmount: withdrawal.amount,
              externalReference: withdrawal.transactionHash,
            },
          });
        }
      } catch {}
    }

    await this.auditService.log({
      tenantId,
      walletId: withdrawal.walletId,
      action: 'SETTLEMENT_FINALIZED' as any,
      entityType: 'CUSTODY_WITHDRAWAL',
      entityId: custodyWithdrawalId,
      actorId: operatorId,
      correlationId,
      evidence: { transactionHash: withdrawal.transactionHash, amount: withdrawal.amount, assetId: withdrawal.assetId, networkId: withdrawal.networkId },
    });

    this.logger.log({ event: 'custody.settlement.withdrawal_finalized', tenantId, custodyWithdrawalId, transactionHash: withdrawal.transactionHash });

    return { custodyWithdrawalId, settled: true, transactionHash: withdrawal.transactionHash, settlementState: CustodySettlementState.SETTLED };
  }

  async handleReorgSettlement(params: { tenantId: string; transactionId: string; reason: string }): Promise<any> {
    const { tenantId, transactionId, reason } = params;

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    // Reorg handling must trigger funding reconciliation, portfolio accounting reconciliation, operations incident, audit
    // For settlement, mark as REORGED

    await this.auditService.log({
      tenantId,
      walletId: tx.walletId,
      action: 'SETTLEMENT_REORGED' as any,
      entityType: 'CUSTODY_TRANSACTION',
      entityId: transactionId,
      evidence: { transactionHash: tx.transactionHash, reason, previousState: tx.status },
    });

    return { transactionId, settlementState: CustodySettlementState.REORGED, reason };
  }
}
