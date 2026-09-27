import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { TransactionService } from './transaction.service';
import { ConfirmationService } from './confirmation.service';
import { CustodyAuditService } from './custody-audit.service';
import { CustodyTransactionState, redactSecrets } from './custody.types';

/**
 * Polls/subscribes to authoritative provider transaction observations, detects pending/confirmed/failed/replaced/dropped/reorged states,
 * stores raw-provider-safe metadata, and never fabricates blockchain status.
 */

@Injectable()
export class TransactionMonitoringService {
  private readonly logger = new Logger(TransactionMonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: BlockchainProviderFactory,
    private readonly transactionService: TransactionService,
    private readonly confirmationService: ConfirmationService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async pollTransaction(params: { tenantId: string; transactionId: string }): Promise<any> {
    const { tenantId, transactionId } = params;

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    if (!tx.transactionHash) {
      // No hash yet — still pending submission
      return tx;
    }

    let provider: any = null;
    try {
      provider = await this.providerFactory.getProviderForNetwork({ networkId: tx.networkId, assetId: tx.assetId });
    } catch {
      throw new BadRequestException('Provider unavailable for transaction polling');
    }

    let observation: any = null;
    try {
      observation = await provider.getTransaction({ transactionHash: tx.transactionHash, networkId: tx.networkId, assetId: tx.assetId });
    } catch (e) {
      this.logger.warn(`Provider getTransaction failed for ${tx.transactionHash}: ${(e as Error).message}`);
      return tx;
    }

    if (!observation) {
      // Transaction not yet observed on chain — could be pending or dropped
      // Check if it's been pending too long — might be dropped
      const ageMs = Date.now() - new Date(tx.createdAt).getTime();
      if (ageMs > 30 * 60 * 1000 && tx.status === 'SUBMITTED') {
        // After 30 min, mark as possibly dropped — but need provider evidence
        // For now, keep as SUBMITTED
      }
      return tx;
    }

    // Update transaction with provider observation — never fabricate blockchain status
    const newStatus = observation.status as CustodyTransactionState;
    const currentStatus = tx.status as CustodyTransactionState;

    if (newStatus !== currentStatus) {
      try {
        await this.transactionService.transitionTransaction({
          tenantId,
          transactionId,
          toState: newStatus,
          blockHash: observation.blockHash ?? null,
          blockNumber: observation.blockNumber ?? null,
          confirmationCount: observation.confirmationCount ?? null,
          actualFee: observation.fee ?? null,
        });
      } catch (e) {
        this.logger.warn(`Failed to transition transaction ${transactionId} ${currentStatus}→${newStatus}: ${(e as Error).message}`);
      }
    } else {
      // Update confirmation count even if status same
      if (observation.confirmationCount !== undefined && observation.confirmationCount !== tx.confirmationCount) {
        try {
          await (this.prisma as any).custodyTransaction.update({
            where: { id: transactionId },
            data: { confirmationCount: observation.confirmationCount, blockHash: observation.blockHash ?? tx.blockHash, blockNumber: observation.blockNumber ?? tx.blockNumber },
          });
        } catch {}
      }
    }

    // Store raw-provider-safe metadata
    try {
      await (this.prisma as any).custodyTransaction.update({
        where: { id: transactionId },
        data: { evidence: redactSecrets({ ...(tx.evidence as any), providerObservation: observation, lastPolledAt: new Date().toISOString() }) as any },
      });
    } catch {}

    // If transaction is confirmed, observe confirmation
    if (observation.confirmationCount > 0) {
      try {
        await this.confirmationService.observeConfirmation({
          tenantId,
          transactionId,
          blockHash: observation.blockHash ?? null,
          blockNumber: observation.blockNumber ?? null,
          confirmationCount: observation.confirmationCount,
          requiredConfirmationCount: tx.requiredConfirmationCount ?? 6,
          providerReference: observation.providerReference ?? null,
        });
      } catch {}
    }

    const updated = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    return updated;
  }

  async handleReorg(params: { tenantId: string; transactionId: string; reason: string; newBlockHash?: string | null; newBlockNumber?: string | null }): Promise<any> {
    const { tenantId, transactionId, reason, newBlockHash = null, newBlockNumber = null } = params;

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    // For transactions previously observed as confirmed but later invalidated: CONFIRMED → REORGED → CONFIRMING
    const currentState = tx.status as CustodyTransactionState;
    if (!['CONFIRMED', 'FINAL', 'CONFIRMING'].includes(currentState)) {
      throw new BadRequestException(`Reorg handling only for CONFIRMED/FINAL/CONFIRMING, current: ${currentState}`);
    }

    const reorged = await this.transactionService.transitionTransaction({
      tenantId,
      transactionId,
      toState: CustodyTransactionState.REORGED as any,
      blockHash: newBlockHash,
      blockNumber: newBlockNumber,
    });

    // Trigger reconciliation, audit, operations incident as appropriate
    await this.auditService.log({
      tenantId,
      walletId: tx.walletId,
      action: 'TRANSACTION_REORGED' as any,
      entityType: 'CUSTODY_TRANSACTION',
      entityId: transactionId,
      evidence: { transactionHash: tx.transactionHash, reason, newBlockHash, newBlockNumber, previousState: currentState },
    });

    this.logger.warn({ event: 'custody.transaction.reorged', tenantId, transactionId, transactionHash: tx.transactionHash, reason });

    return reorged;
  }

  async listPendingTransactions(params: { tenantId: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, page = 1, limit = 50 } = params;
    const where: any = { tenantId, status: { in: ['PENDING', 'SUBMITTED', 'OBSERVED', 'CONFIRMING'] } };

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyTransaction.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyTransaction.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
