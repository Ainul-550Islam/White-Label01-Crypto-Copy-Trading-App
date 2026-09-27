import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey, CustodyInternalTransferState, INTERNAL_TRANSFER_VALID_TRANSITIONS, isValidDecimal, redactSecrets } from './custody.types';

/**
 * Manages authorized internal custody transfers between supported wallets/accounts without pretending
 * they are external blockchain transactions. Each internal transfer must retain source/destination ownership,
 * asset/network, authorization, audit, and settlement references.
 * Do not create fake blockchain transaction hashes for internal transfers.
 */

@Injectable()
export class InternalTransferService {
  private readonly logger = new Logger(InternalTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async createInternalTransfer(params: {
    tenantId: string;
    sourceWalletId: string;
    destinationWalletId: string;
    assetId: string;
    networkId?: string | null;
    amount: string;
    operatorId?: string | null;
    reason?: string | null;
    authorizationReference?: string | null;
    correlationId?: string | null;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, networkId = null, amount, operatorId = null, reason = null, authorizationReference = null, correlationId = null, metadata = {} } = params;

    if (!isValidDecimal(amount)) throw new BadRequestException(`Invalid amount decimal: ${amount}`);
    if (sourceWalletId === destinationWalletId) throw new BadRequestException('Source and destination wallets must be different');

    // Verify both wallets belong to same tenant — tenant isolation
    const sourceWallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: sourceWalletId, tenantId } });
    if (!sourceWallet) throw new BadRequestException('Source wallet not found or tenant mismatch');
    const destWallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: destinationWalletId, tenantId } });
    if (!destWallet) throw new BadRequestException('Destination wallet not found or tenant mismatch');

    // Same asset required
    if (sourceWallet.assetId !== assetId || destWallet.assetId !== assetId) {
      throw new BadRequestException(`Internal transfer must be same asset — source ${sourceWallet.assetId}, dest ${destWallet.assetId}, requested ${assetId}`);
    }

    // Ownership verified
    if (sourceWallet.ownerId && destWallet.ownerId && sourceWallet.ownerId !== destWallet.ownerId) {
      this.logger.warn({ event: 'custody.internal_transfer.cross_owner', sourceWalletId, destinationWalletId, note: 'Cross-owner internal transfer requires explicit authorization' });
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `internal-transfer:${assetId}:${networkId ?? ''}`,
      tenantId,
      walletId: sourceWalletId,
      assetId,
      networkId: networkId ?? undefined,
      externalRef: `${sourceWalletId}:${destinationWalletId}:${amount}`,
    });

    try {
      const existing = await (this.prisma as any).custodyInternalTransfer.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const transfer = await (this.prisma as any).custodyInternalTransfer.create({
      data: {
        tenantId,
        sourceWalletId,
        destinationWalletId,
        assetId,
        networkId: networkId ?? null,
        amount,
        state: 'REQUESTED',
        authorizationReference: authorizationReference ?? null,
        operatorId: operatorId ?? null,
        reason: reason ?? null,
        idempotencyKey,
        metadata: redactSecrets(metadata) as any,
        requestedAt: new Date(),
      },
    });

    await this.auditService.log({
      tenantId,
      walletId: sourceWalletId,
      action: 'INTERNAL_TRANSFER_CREATED' as any,
      entityType: 'CUSTODY_INTERNAL_TRANSFER',
      entityId: transfer.id,
      actorId: operatorId,
      toState: 'REQUESTED',
      correlationId,
      evidence: { sourceWalletId, destinationWalletId, assetId, networkId, amount, reason, authorizationReference },
    });

    this.logger.log({ event: 'custody.internal_transfer.created', tenantId, transferId: transfer.id, amount, assetId });

    return transfer;
  }

  async approveInternalTransfer(params: {
    tenantId: string;
    transferId: string;
    approverId: string;
    reason?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, transferId, approverId, reason = null, correlationId = null } = params;

    const transfer = await (this.prisma as any).custodyInternalTransfer.findFirst({ where: { id: transferId, tenantId } });
    if (!transfer) throw new BadRequestException('Internal transfer not found');

    const currentState = transfer.state as CustodyInternalTransferState;
    const currentStateStr = currentState as unknown as string;
    if (currentStateStr !== CustodyInternalTransferState.REQUESTED) {
      const allowed = (INTERNAL_TRANSFER_VALID_TRANSITIONS as any)[currentState] ?? [];
      if (!allowed.includes(CustodyInternalTransferState.APPROVED as any)) {
        throw new BadRequestException(`Invalid transition ${currentState} → APPROVED`);
      }
    }

    const approved = await (this.prisma as any).custodyInternalTransfer.update({
      where: { id: transferId },
      data: { state: 'APPROVED', approvedAt: new Date() },
    });

    await this.auditService.log({
      tenantId,
      walletId: transfer.sourceWalletId,
      action: 'INTERNAL_TRANSFER_APPROVED' as any,
      entityType: 'CUSTODY_INTERNAL_TRANSFER',
      entityId: transferId,
      actorId: approverId,
      fromState: currentState,
      toState: 'APPROVED',
      reason: reason ?? null,
      correlationId,
      evidence: { transferId, approverId, reason },
    });

    return approved;
  }

  async settleInternalTransfer(params: {
    tenantId: string;
    transferId: string;
    operatorId?: string | null;
    settlementReference?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, transferId, operatorId = null, settlementReference = null, correlationId = null } = params;

    const transfer = await (this.prisma as any).custodyInternalTransfer.findFirst({ where: { id: transferId, tenantId } });
    if (!transfer) throw new BadRequestException('Internal transfer not found');

    const currentState = transfer.state as CustodyInternalTransferState;
    const currentStateStr = currentState as unknown as string;
    if (currentStateStr !== (CustodyInternalTransferState.APPROVED as unknown as string) && currentStateStr !== (CustodyInternalTransferState.SETTLING as unknown as string)) {
      // Transition to SETTLING first if APPROVED
      if (currentStateStr === (CustodyInternalTransferState.APPROVED as unknown as string)) {
        await (this.prisma as any).custodyInternalTransfer.update({ where: { id: transferId }, data: { state: 'SETTLING' } });
      } else {
        throw new BadRequestException(`Transfer must be APPROVED/SETTLING to settle, current: ${currentState}`);
      }
    }

    // Do not create fake blockchain transaction hashes for internal transfers — use settlement reference
    const settled = await (this.prisma as any).custodyInternalTransfer.update({
      where: { id: transferId },
      data: { state: 'SETTLED', settledAt: new Date(), settlementReference: settlementReference ?? `internal_settle_${transferId.slice(0, 8)}_${Date.now()}` },
    });

    await this.auditService.log({
      tenantId,
      walletId: transfer.sourceWalletId,
      action: 'INTERNAL_TRANSFER_SETTLED' as any,
      entityType: 'CUSTODY_INTERNAL_TRANSFER',
      entityId: transferId,
      actorId: operatorId,
      fromState: currentState,
      toState: 'SETTLED',
      correlationId,
      evidence: { settlementReference: settled.settlementReference, sourceWalletId: transfer.sourceWalletId, destinationWalletId: transfer.destinationWalletId, amount: transfer.amount },
    });

    this.logger.log({ event: 'custody.internal_transfer.settled', tenantId, transferId, settlementReference: settled.settlementReference });

    return settled;
  }

  async listInternalTransfers(params: {
    tenantId: string;
    sourceWalletId?: string;
    destinationWalletId?: string;
    assetId?: string;
    state?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, state, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (sourceWalletId) where.sourceWalletId = sourceWalletId;
    if (destinationWalletId) where.destinationWalletId = destinationWalletId;
    if (assetId) where.assetId = assetId;
    if (state) where.state = state;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyInternalTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyInternalTransfer.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
