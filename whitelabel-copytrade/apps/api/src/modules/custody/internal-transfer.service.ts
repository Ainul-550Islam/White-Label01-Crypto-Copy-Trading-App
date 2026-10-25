// # Responsibility: persist authorized tenant-bound internal-transfer requests without manufacturing ledger settlement or blockchain evidence.
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type CustodyInternalTransfer } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey, CustodyInternalTransferState, INTERNAL_TRANSFER_VALID_TRANSITIONS,
  isValidDecimal, cmp, redactSecrets, isCustodyObject, custodyJsonInput, CustodyAuditAction } from './custody.types';

/** An internal approval/reference is not proof that either a ledger or an external chain moved funds. */
@Injectable()
export class InternalTransferService {
  private readonly logger = new Logger(InternalTransferService.name);

  constructor(private readonly prisma: PrismaService, private readonly auditService: CustodyAuditService) {}

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
    metadata?: Record<string, unknown>;
  }): Promise<CustodyInternalTransfer> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, amount, operatorId = null,
      reason = null, authorizationReference = null, correlationId = null, metadata = {} } = params;
    if (!isValidDecimal(amount) || cmp(amount, '0') <= 0) throw new BadRequestException('Internal transfer amount must be a positive supported-precision decimal');
    if (!assetId) throw new BadRequestException('Internal transfer asset must be explicit');
    if (sourceWalletId === destinationWalletId) throw new BadRequestException('Source and destination wallets must be different');
    if (!isCustodyObject(metadata)) throw new BadRequestException('Internal transfer metadata must be an object');

    const sourceWallet = await this.prisma.custodyWallet.findFirst({ where: { id: sourceWalletId, tenantId } });
    const destinationWallet = await this.prisma.custodyWallet.findFirst({ where: { id: destinationWalletId, tenantId } });
    if (!sourceWallet || !destinationWallet) throw new BadRequestException('Source or destination wallet not found for this tenant');
    if (sourceWallet.state !== 'ACTIVE' || destinationWallet.state !== 'ACTIVE') throw new BadRequestException('Both internal-transfer wallets must be ACTIVE');
    if (sourceWallet.assetId !== assetId || destinationWallet.assetId !== assetId) throw new BadRequestException('Internal transfer wallets must match the requested asset');
    const networkId = params.networkId ?? sourceWallet.networkId;
    if (!networkId || sourceWallet.networkId !== networkId || destinationWallet.networkId !== networkId) {
      throw new BadRequestException('Internal transfer requires an explicit matching network for both wallets');
    }
    if (!sourceWallet.ownerId || !destinationWallet.ownerId) throw new BadRequestException('Internal transfer wallet ownership evidence is required');
    const crossOwner = sourceWallet.ownerId !== destinationWallet.ownerId || sourceWallet.ownerType !== destinationWallet.ownerType;
    if (crossOwner && (!authorizationReference?.trim() || !operatorId?.trim())) {
      throw new BadRequestException('Cross-owner internal transfer requires an operator and explicit authorization reference');
    }

    const idempotencyKey = deterministicIdempotencyKey({ type: `internal-transfer:${assetId}:${networkId}`,
      tenantId, walletId: sourceWalletId, assetId, networkId, externalRef: `${sourceWalletId}:${destinationWalletId}:${amount}` });
    const existing = await this.prisma.custodyInternalTransfer.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) {
      if (existing.sourceWalletId !== sourceWalletId || existing.destinationWalletId !== destinationWalletId
        || existing.assetId !== assetId || existing.networkId !== networkId || cmp(existing.amount, amount) !== 0) {
        throw new BadRequestException('Internal transfer idempotency payload mismatch');
      }
      return existing;
    }
    const transfer = await this.prisma.custodyInternalTransfer.create({ data: {
      tenantId, sourceWalletId, destinationWalletId, assetId, networkId, amount,
      state: 'REQUESTED', authorizationReference, operatorId, reason, idempotencyKey,
      metadata: custodyJsonInput(redactSecrets(metadata)), requestedAt: new Date(),
    } });
    await this.auditService.log({ tenantId, walletId: sourceWalletId, action: CustodyAuditAction.INTERNAL_TRANSFER_CREATED,
      entityType: 'CUSTODY_INTERNAL_TRANSFER', entityId: transfer.id, actorId: operatorId,
      toState: 'REQUESTED', correlationId,
      evidence: { sourceWalletId, destinationWalletId, assetId, networkId, amount, reason, authorizationReference } });
    this.logger.log({ event: 'custody.internal_transfer.created', tenantId, transferId: transfer.id, amount, assetId });
    return transfer;
  }

  async approveInternalTransfer(params: {
    tenantId: string;
    transferId: string;
    approverId: string;
    reason?: string | null;
    correlationId?: string | null;
  }): Promise<CustodyInternalTransfer> {
    const { tenantId, transferId, approverId, reason = null, correlationId = null } = params;
    if (!approverId.trim()) throw new BadRequestException('Internal transfer approver is required');
    const transfer = await this.prisma.custodyInternalTransfer.findFirst({ where: { id: transferId, tenantId } });
    if (!transfer) throw new BadRequestException('Internal transfer not found');
    const currentState = this.state(transfer.state);
    if (!INTERNAL_TRANSFER_VALID_TRANSITIONS[currentState].includes(CustodyInternalTransferState.APPROVED)) {
      throw new BadRequestException(`Invalid transition ${currentState} → APPROVED`);
    }
    const approved = await this.prisma.custodyInternalTransfer.update({
      where: { id: transferId, tenantId, state: transfer.state }, data: { state: 'APPROVED', approvedAt: new Date() },
    });
    await this.auditService.log({ tenantId, walletId: transfer.sourceWalletId, action: CustodyAuditAction.INTERNAL_TRANSFER_APPROVED,
      entityType: 'CUSTODY_INTERNAL_TRANSFER', entityId: transferId, actorId: approverId,
      fromState: currentState, toState: 'APPROVED', reason, correlationId, evidence: { transferId, approverId, reason } });
    return approved;
  }

  async settleInternalTransfer(params: {
    tenantId: string;
    transferId: string;
    operatorId?: string | null;
    settlementReference?: string | null;
    correlationId?: string | null;
  }): Promise<never> {
    const transfer = await this.prisma.custodyInternalTransfer.findFirst({ where: { id: params.transferId, tenantId: params.tenantId } });
    if (!transfer) throw new BadRequestException('Internal transfer not found');
    const state = this.state(transfer.state);
    if (state !== CustodyInternalTransferState.APPROVED && state !== CustodyInternalTransferState.SETTLING) {
      throw new BadRequestException(`Transfer must be APPROVED/SETTLING to settle, current: ${state}`);
    }
    // There is no configured authoritative internal ledger-transfer adapter. A caller's reference
    // cannot prove a debit and credit occurred; preserve the state rather than inventing SETTLED.
    throw new ServiceUnavailableException('Internal transfer settlement unavailable: an authoritative ledger-transfer adapter is required; a supplied reference is not settlement evidence');
  }

  async listInternalTransfers(params: {
    tenantId: string;
    sourceWalletId?: string;
    destinationWalletId?: string;
    assetId?: string;
    state?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CustodyInternalTransfer[]; total: number; page: number; limit: number }> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, state, page = 1, limit = 50 } = params;
    const where: Prisma.CustodyInternalTransferWhereInput = { tenantId };
    if (sourceWalletId) where.sourceWalletId = sourceWalletId;
    if (destinationWalletId) where.destinationWalletId = destinationWalletId;
    if (assetId) where.assetId = assetId;
    if (state) where.state = this.state(state);
    const [data, total] = await Promise.all([
      this.prisma.custodyInternalTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.custodyInternalTransfer.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  private state(value: string): CustodyInternalTransferState {
    const state = Object.values(CustodyInternalTransferState).find((member) => member === value);
    if (!state) throw new BadRequestException('Invalid internal-transfer state');
    return state;
  }
}
