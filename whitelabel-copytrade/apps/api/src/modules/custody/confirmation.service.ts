import { failClosedMoneyOperation } from '../../common/money-path-failure';
import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyPolicyService } from './custody-policy.service';
import { CustodyAuditService } from './custody-audit.service';
import { ChainObservationService } from './providers/chain-observation.service';
import { CustodyConfirmationState, CustodyTransactionState, deterministicIdempotencyKey } from './custody.types';

/**
 * Evaluates confirmation/finality requirements using network policy and actual chain/provider evidence.
 * Must distinguish observed, required, confirmed, final, failed, and reorged states.
 */

@Injectable()
export class ConfirmationService {
  private readonly logger = new Logger(ConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly auditService: CustodyAuditService,
    /**
     * Batch 03: optional observation-only chain surface. Never required for
     * the ledger path; when absent the refresh method below refuses instead
     * of downgrading to ledger-derived confirmation claims.
     */
    @Optional() private readonly chainObservation?: ChainObservationService,
  ) {}

  async observeConfirmation(params: {
    tenantId: string;
    transactionId: string;
    blockHash?: string | null;
    blockNumber?: string | null;
    confirmationCount: number;
    requiredConfirmationCount: number;
    providerReference?: string | null;
  }): Promise<any> {
    const { tenantId, transactionId, blockHash = null, blockNumber = null, confirmationCount, requiredConfirmationCount, providerReference = null } = params;

    // Never invent confirmation counts — must be provider-derived, validated above
    if (confirmationCount < 0) throw new BadRequestException('Invalid confirmation count');

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    // Determine confirmation state based on counts and finality
    let state: CustodyConfirmationState;
    if (confirmationCount === 0) {
      state = CustodyConfirmationState.OBSERVED;
    } else if (confirmationCount < requiredConfirmationCount) {
      state = CustodyConfirmationState.REQUIRED;
    } else if (confirmationCount >= requiredConfirmationCount && confirmationCount < requiredConfirmationCount * 2) {
      state = CustodyConfirmationState.CONFIRMED;
    } else {
      state = CustodyConfirmationState.FINAL;
    }

    // Check if transaction was reorged — if blockHash changed, mark as REORGED
    if (tx.blockHash && blockHash && tx.blockHash !== blockHash && tx.status === 'CONFIRMED') {
      state = CustodyConfirmationState.REORGED;
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `confirmation:${transactionId}:${confirmationCount}`,
      tenantId,
      walletId: tx.walletId ?? undefined,
      assetId: tx.assetId,
      networkId: tx.networkId,
      externalRef: `${blockHash ?? ''}:${blockNumber ?? ''}:${confirmationCount}`,
    });

    try {
      const existing = await (this.prisma as any).custodyTransactionConfirmation.findFirst({ where: { transactionId, confirmationCount } });
      if (existing) return existing;
    } catch (caughtErrorB1) { failClosedMoneyOperation(caughtErrorB1, { code: 'CUSTODY_CONFIRMATION_OPERATION_1_FAILED', tenantId: tenantId, entityId: 'UNAVAILABLE' }); }

    const confirmation = await (this.prisma as any).custodyTransactionConfirmation.create({
      data: {
        tenantId,
        transactionId,
        blockHash: blockHash ?? null,
        blockNumber: blockNumber ?? null,
        confirmationCount,
        requiredConfirmationCount,
        state: state as any,
        isFinal: state === CustodyConfirmationState.FINAL,
        providerReference: providerReference ?? null,
        observedAt: new Date(),
      },
    });

    // Update transaction confirmation count and status if needed
    try {
      let newTxStatus: CustodyTransactionState | null = null;
      if (state === CustodyConfirmationState.CONFIRMED && tx.status !== 'CONFIRMED' && tx.status !== 'FINAL') {
        newTxStatus = CustodyTransactionState.CONFIRMED as any;
      } else if (state === CustodyConfirmationState.FINAL && tx.status !== 'FINAL') {
        newTxStatus = CustodyTransactionState.FINAL as any;
      } else if (state === CustodyConfirmationState.REORGED) {
        newTxStatus = CustodyTransactionState.REORGED as any;
      }

      if (newTxStatus) {
        await (this.prisma as any).custodyTransaction.update({
          where: { id: transactionId },
          data: {
            status: newTxStatus as any,
            confirmationCount,
            blockHash: blockHash ?? tx.blockHash,
            blockNumber: blockNumber ?? tx.blockNumber,
            ...(newTxStatus === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
            ...(newTxStatus === 'FINAL' ? { confirmedAt: new Date() } : {}),
          },
        });

        await this.auditService.log({
          tenantId,
          walletId: tx.walletId,
          action: `TRANSACTION_${newTxStatus}` as any,
          entityType: 'CUSTODY_TRANSACTION',
          entityId: transactionId,
          evidence: { confirmationCount, requiredConfirmationCount, blockHash, blockNumber, state },
        });
      } else {
        await (this.prisma as any).custodyTransaction.update({
          where: { id: transactionId },
          data: { confirmationCount, blockHash: blockHash ?? tx.blockHash, blockNumber: blockNumber ?? tx.blockNumber },
        });
      }
    } catch (caughtErrorB1) { failClosedMoneyOperation(caughtErrorB1, { code: 'CUSTODY_CONFIRMATION_OPERATION_2_FAILED', tenantId: tenantId, entityId: 'UNAVAILABLE' }); }

    return confirmation;
  }

  /**
   * Batch 03: refresh a transaction's confirmation state from real chain
   * evidence. NEVER invents values: when the chain surface is disabled or
   * the network has no provider, the typed refusal bubbles to the caller,
   * the ledger row stays exactly as it was, and no transition happens. A
   * CONFIRMED transaction whose chain head no longer contains the recorded
   * blockHash is flipped REORGED through the standard observeConfirmation
   * branch (that flips REORGED when the stored hash differs).
   */
  async refreshConfirmationsFromChain(params: {
    tenantId: string;
    transactionId: string;
  }): Promise<{ refreshed: boolean; confirmationCount: number; state: string; reason?: string }> {
    const { tenantId, transactionId } = params;

    if (!this.chainObservation) {
      throw new BadRequestException(
        'chain observation surface is not configured on this service; refusing to fabricate a refresh',
      );
    }

    const tx = await (this.prisma as any).custodyTransaction.findFirst({
      where: { id: transactionId, tenantId },
    });
    if (!tx) throw new BadRequestException('Transaction not found');
    if (!tx.networkId) {
      throw new BadRequestException('transaction lacks networkId; observation requires explicit network context');
    }
    if (!tx.transactionHash) {
      return { refreshed: false, confirmationCount: tx.confirmationCount ?? 0, state: tx.status, reason: 'no chain hash on record' };
    }

    const provider = this.chainObservation.getProviderForNetwork(tx.networkId);
    if (!provider.getConfirmations) {
      throw new BadRequestException(
        `provider ${provider.providerId} cannot observe confirmations; refresh requires that evidence surface`,
      );
    }
    const observation = await provider.getConfirmations({
      transactionHash: tx.transactionHash,
      networkId: tx.networkId,
      assetId: tx.assetId,
    });

    const requiredConfirmations =
      tx.requiredConfirmationCount ??
      (await this.custodyPolicyService.getRequiredConfirmations({ tenantId, networkId: tx.networkId }));

    await this.observeConfirmation({
      tenantId,
      transactionId,
      blockHash: observation.blockHash ?? null,
      blockNumber: observation.blockNumber ?? null,
      confirmationCount: observation.confirmationCount,
      requiredConfirmationCount: requiredConfirmations,
      providerReference: (tx.providerReference as string | null) ?? null,
    });

    const state =
      observation.confirmationCount >= requiredConfirmations * 2
        ? CustodyConfirmationState.FINAL
        : observation.confirmationCount >= requiredConfirmations
          ? CustodyConfirmationState.CONFIRMED
          : observation.confirmationCount > 0
            ? CustodyConfirmationState.REQUIRED
            : CustodyConfirmationState.OBSERVED;

    return { refreshed: true, confirmationCount: observation.confirmationCount, state };
  }

  async getConfirmations(params: { tenantId: string; transactionId: string }): Promise<any[]> {
    return await (this.prisma as any).custodyTransactionConfirmation.findMany({
      where: { tenantId: params.tenantId, transactionId: params.transactionId },
      orderBy: { confirmationCount: 'asc' },
    });
  }

  async isTransactionConfirmed(params: { tenantId: string; transactionId: string }): Promise<{ confirmed: boolean; final: boolean; confirmationCount: number; requiredCount: number }> {
    try {
      const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: params.transactionId, tenantId: params.tenantId } });
      if (!tx) return { confirmed: false, final: false, confirmationCount: 0, requiredCount: 0 };
      const confirmed = ['CONFIRMED', 'FINAL'].includes(tx.status);
      const final = tx.status === 'FINAL';
      return { confirmed, final, confirmationCount: tx.confirmationCount ?? 0, requiredCount: tx.requiredConfirmationCount ?? 6 };
    } catch {
      return { confirmed: false, final: false, confirmationCount: 0, requiredCount: 0 };
    }
  }
}
