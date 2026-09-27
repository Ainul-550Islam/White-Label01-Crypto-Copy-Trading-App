import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey, CustodyTransactionState, TRANSACTION_VALID_TRANSITIONS, isValidDecimal, redactSecrets } from './custody.types';

/**
 * Persists canonical custody transaction records including transaction hash where authoritative,
 * wallet references, asset/network, amount, fee, provider reference, direction, state, timestamps,
 * and source workflow references. Duplicate transaction observations must be idempotent.
 */

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async createTransaction(params: {
    tenantId: string;
    walletId?: string | null;
    assetId: string;
    networkId: string;
    direction: string;
    amount: string;
    transactionHash?: string | null;
    blockHash?: string | null;
    blockNumber?: string | null;
    providerReference?: string | null;
    providerMetadata?: any;
    status?: string;
    confirmationCount?: number;
    requiredConfirmationCount?: number;
    estimatedFee?: string | null;
    actualFee?: string | null;
    feeAsset?: string | null;
    feeReference?: string | null;
    sourceWorkflowType?: string | null;
    sourceWorkflowId?: string | null;
    depositId?: string | null;
    withdrawalId?: string | null;
    observedAt?: Date | null;
    submittedAt?: Date | null;
    confirmedAt?: Date | null;
    failedAt?: Date | null;
    evidence?: any;
    idempotencyKey?: string;
  }): Promise<any> {
    const { tenantId, walletId = null, assetId, networkId, direction, amount, transactionHash = null, blockHash = null, blockNumber = null, providerReference = null, providerMetadata = null, status = 'PENDING', confirmationCount = 0, requiredConfirmationCount = 6, estimatedFee = null, actualFee = null, feeAsset = null, feeReference = null, sourceWorkflowType = null, sourceWorkflowId = null, depositId = null, withdrawalId = null, observedAt = null, submittedAt = null, confirmedAt = null, failedAt = null, evidence = {}, idempotencyKey: providedKey } = params;

    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');
    if (!isValidDecimal(amount)) throw new BadRequestException(`Invalid amount decimal: ${amount}`);
    if (!['IN', 'OUT', 'INTERNAL'].includes(direction)) throw new BadRequestException('Invalid direction');

    // Never invent transaction hashes — transactionHash must be from authoritative provider/chain evidence if provided
    // But allow null for PENDING transactions before submission

    const idempotencyKey = providedKey ?? deterministicIdempotencyKey({
      type: `custody-tx:${direction}:${assetId}:${networkId}`,
      tenantId,
      walletId: walletId ?? undefined,
      assetId,
      networkId,
      externalRef: transactionHash ?? `${sourceWorkflowType ?? ''}:${sourceWorkflowId ?? ''}:${Date.now()}`,
    });

    try {
      const existing = await (this.prisma as any).custodyTransaction.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log({ event: 'custody.transaction.idempotent_hit', idempotencyKey, transactionHash });
        return existing;
      }
    } catch {}

    // Duplicate transaction hash detection — network-aware uniqueness
    if (transactionHash) {
      try {
        const dup = await (this.prisma as any).custodyTransaction.findFirst({ where: { tenantId, networkId, transactionHash } });
        if (dup) {
          // If same hash already exists, return existing — idempotent provider observation
          this.logger.log({ event: 'custody.transaction.duplicate_hash', transactionHash, networkId });
          return dup;
        }
      } catch {}
    }

    const transaction = await (this.prisma as any).custodyTransaction.create({
      data: {
        tenantId,
        walletId: walletId ?? null,
        assetId,
        networkId,
        direction,
        amount,
        transactionHash: transactionHash ?? null,
        blockHash: blockHash ?? null,
        blockNumber: blockNumber ?? null,
        providerReference: providerReference ?? null,
        providerMetadata: providerMetadata ? redactSecrets(providerMetadata) as any : null,
        status: status as any,
        confirmationCount,
        requiredConfirmationCount,
        estimatedFee: estimatedFee ?? null,
        actualFee: actualFee ?? null,
        feeAsset: feeAsset ?? null,
        feeReference: feeReference ?? null,
        sourceWorkflowType: sourceWorkflowType ?? null,
        sourceWorkflowId: sourceWorkflowId ?? null,
        depositId: depositId ?? null,
        withdrawalId: withdrawalId ?? null,
        observedAt: observedAt ?? null,
        submittedAt: submittedAt ?? null,
        confirmedAt: confirmedAt ?? null,
        failedAt: failedAt ?? null,
        evidence: redactSecrets(evidence) as any,
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      walletId: walletId ?? null,
      action: 'TRANSACTION_CREATED' as any,
      entityType: 'CUSTODY_TRANSACTION',
      entityId: transaction.id,
      evidence: { transactionHash, assetId, networkId, amount, direction, status },
    });

    return transaction;
  }

  async transitionTransaction(params: {
    tenantId: string;
    transactionId: string;
    toState: CustodyTransactionState;
    blockHash?: string | null;
    blockNumber?: string | null;
    confirmationCount?: number | null;
    actualFee?: string | null;
    failureReason?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, transactionId, toState, blockHash = null, blockNumber = null, confirmationCount = null, actualFee = null, failureReason = null, operatorId = null, correlationId = null } = params;

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    const currentState = tx.status as CustodyTransactionState;
    const allowed = TRANSACTION_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid transaction transition ${currentState} → ${toState}`);
    }

    // Never mark CONFIRMED without authoritative provider/chain evidence
    if (toState === CustodyTransactionState.CONFIRMED || toState === CustodyTransactionState.FINAL) {
      if (!tx.transactionHash) {
        throw new BadRequestException('Cannot mark CONFIRMED without authoritative transaction hash from provider/chain evidence');
      }
      if (!blockHash && !tx.blockHash) {
        throw new BadRequestException('Cannot mark CONFIRMED without blockHash from provider evidence');
      }
    }

    const updated = await (this.prisma as any).custodyTransaction.update({
      where: { id: transactionId },
      data: {
        status: toState as any,
        ...(blockHash ? { blockHash } : {}),
        ...(blockNumber ? { blockNumber } : {}),
        ...(confirmationCount !== null ? { confirmationCount } : {}),
        ...(actualFee ? { actualFee } : {}),
        ...(failureReason ? { failureReason } : {}),
        ...(toState === CustodyTransactionState.CONFIRMED ? { confirmedAt: new Date() } : {}),
        ...(toState === CustodyTransactionState.FINAL ? { confirmedAt: new Date() } : {}),
        ...(toState === CustodyTransactionState.FAILED ? { failedAt: new Date() } : {}),
        ...(toState === CustodyTransactionState.REORGED ? { isReorged: true, reorgedAt: new Date() } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      walletId: tx.walletId,
      action: `TRANSACTION_${toState}` as any,
      entityType: 'CUSTODY_TRANSACTION',
      entityId: transactionId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      correlationId,
      evidence: { transactionHash: tx.transactionHash, blockHash, blockNumber, confirmationCount, actualFee },
    });

    return updated;
  }

  async getTransaction(params: { tenantId: string; transactionId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyTransaction.findFirst({ where: { id: params.transactionId, tenantId: params.tenantId } });
    } catch {
      return null;
    }
  }

  async getTransactionByHash(params: { tenantId: string; transactionHash: string; networkId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyTransaction.findFirst({ where: { tenantId: params.tenantId, transactionHash: params.transactionHash, networkId: params.networkId } });
    } catch {
      return null;
    }
  }

  async listTransactions(params: {
    tenantId: string;
    walletId?: string;
    assetId?: string;
    networkId?: string;
    status?: string;
    direction?: string;
    sourceWorkflowId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, assetId, networkId, status, direction, sourceWorkflowId, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (walletId) where.walletId = walletId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (sourceWorkflowId) where.sourceWorkflowId = sourceWorkflowId;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyTransaction.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
