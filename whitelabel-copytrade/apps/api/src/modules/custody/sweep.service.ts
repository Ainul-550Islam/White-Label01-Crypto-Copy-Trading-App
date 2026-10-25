// # Responsibility: create and approve native tenant-bound sweep intents only after required evidence; without a real submission/confirmation adapter, execution never invents settlement.
import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, CustodySweepState as NativeSweepState, type CustodySweep } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { ReserveManagementService } from './reserve-management.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { deterministicIdempotencyKey, CustodyAuditAction, cmp, isValidDecimal } from './custody.types';

@Injectable()
export class SweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: CustodyAuditService,
    private readonly reserveService: ReserveManagementService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly providerFactory: BlockchainProviderFactory,
  ) {}

  async createSweep(params: {
    tenantId: string; sourceWalletId: string; destinationWalletId: string; assetId: string; networkId: string;
    amount: string; operatorId?: string | null; reason?: string | null; correlationId?: string | null;
  }): Promise<CustodySweep> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, networkId, amount,
      operatorId = null, reason = null, correlationId = null } = params;
    if (!isValidDecimal(amount) || cmp(amount, '0') <= 0) throw new BadRequestException('Sweep amount must be a positive supported-precision decimal');
    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');
    if (sourceWalletId === destinationWalletId) throw new BadRequestException('Sweep wallets must be different');
    const [sourceWallet, destinationWallet] = await Promise.all([
      this.prisma.custodyWallet.findFirst({ where: { id: sourceWalletId, tenantId } }),
      this.prisma.custodyWallet.findFirst({ where: { id: destinationWalletId, tenantId } }),
    ]);
    if (!sourceWallet || !destinationWallet) throw new BadRequestException('Source or destination wallet not found for tenant');
    if (sourceWallet.state !== 'ACTIVE' || destinationWallet.state !== 'ACTIVE' || !sourceWallet.isActive || !destinationWallet.isActive
      || sourceWallet.assetId !== assetId || destinationWallet.assetId !== assetId
      || sourceWallet.networkId !== networkId || destinationWallet.networkId !== networkId) {
      throw new BadRequestException('Sweep requires distinct active wallets with the same explicit asset/network');
    }
    const idempotencyKey = deterministicIdempotencyKey({ type: `sweep:${assetId}:${networkId}`, tenantId, walletId: sourceWalletId,
      assetId, networkId, externalRef: `${sourceWalletId}:${destinationWalletId}:${amount}` });
    const existing = await this.prisma.custodySweep.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) {
      if (existing.sourceWalletId !== sourceWalletId || existing.destinationWalletId !== destinationWalletId || existing.assetId !== assetId
        || existing.networkId !== networkId || cmp(existing.amount, amount) !== 0) throw new BadRequestException('Conflicting sweep idempotency identity');
      return existing;
    }
    const reserve = await this.reserveService.evaluateReserveSufficiency({ tenantId, walletId: sourceWalletId, assetId, networkId, requestedAmount: amount });
    if (!reserve.sufficient || reserve.dataCompleteness !== 'PROVIDER_DERIVED' || reserve.availableAfterReserve === null) {
      throw new BadRequestException('Complete authoritative reserve evidence is required for a sweep');
    }
    const eligibility = await this.withdrawalPolicyService.evaluateWithdrawalEligibility({ tenantId, accountId: sourceWallet.accountId,
      walletId: sourceWalletId, assetId, networkId, amount, destinationAddress: destinationWallet.id, operatorId });
    // A verified internal wallet is not an external address. All other required failures still block this intent.
    const failures = eligibility.checks.filter((check) => !check.passed && check.check !== 'destinationAllowlisted');
    if (failures.length) throw new BadRequestException(`Sweep blocked by required evidence: ${failures.map((check) => check.reason ?? check.check).join(',')}`);
    const maintenance = await this.prisma.operationalMaintenanceWindow.findFirst({ where: { state: 'ACTIVE',
      OR: [{ tenantId }, { tenantId: null }], scope: { in: ['PLATFORM', 'TENANT'] } } });
    if (maintenance) throw new BadRequestException('Sweep blocked during applicable maintenance');
    const sweep = await this.prisma.custodySweep.create({ data: { tenantId, sourceWalletId, destinationWalletId, assetId, networkId,
      amount, state: 'REQUESTED', operatorId, reason, idempotencyKey, requestedAt: new Date() } });
    const audit: unknown = await this.auditService.log({ tenantId, walletId: sourceWalletId, action: CustodyAuditAction.SWEEP_REQUESTED,
      entityType: 'CUSTODY_SWEEP', entityId: sweep.id, actorId: operatorId, correlationId,
      evidence: { sourceWalletId, destinationWalletId, assetId, networkId, amount, reason } });
    if (audit === null || audit === undefined) throw new ServiceUnavailableException('Required sweep audit unavailable; persisted intent requires audit reconciliation');
    return sweep;
  }

  async approveSweep(params: { tenantId: string; sweepId: string; approverId: string; reason?: string | null; correlationId?: string | null }): Promise<CustodySweep> {
    const { tenantId, sweepId, approverId, reason = null, correlationId = null } = params;
    if (!approverId.trim()) throw new BadRequestException('Sweep approver is required');
    const sweep = await this.prisma.custodySweep.findFirst({ where: { id: sweepId, tenantId } });
    if (!sweep) throw new BadRequestException('Sweep not found');
    if (sweep.state !== 'REQUESTED') throw new BadRequestException(`Sweep must be REQUESTED to approve, current: ${sweep.state}`);
    if (sweep.operatorId === approverId) throw new BadRequestException('Sweep requires an independent approver');
    const approved = await this.prisma.custodySweep.update({ where: { id: sweepId, tenantId, state: 'REQUESTED' },
      data: { state: 'APPROVED', approvedAt: new Date(), approvedBy: approverId } });
    const audit: unknown = await this.auditService.log({ tenantId, walletId: sweep.sourceWalletId, action: CustodyAuditAction.SWEEP_APPROVED,
      entityType: 'CUSTODY_SWEEP', entityId: sweepId, actorId: approverId, fromState: 'REQUESTED', toState: 'APPROVED', reason, correlationId,
      evidence: { approverId, reason } });
    if (audit === null || audit === undefined) throw new ServiceUnavailableException('Required sweep approval audit unavailable; persisted approval requires audit reconciliation');
    return approved;
  }

  async executeSweep(params: { tenantId: string; sweepId: string; operatorId?: string | null; correlationId?: string | null }): Promise<never> {
    const sweep = await this.prisma.custodySweep.findFirst({ where: { id: params.sweepId, tenantId: params.tenantId } });
    if (!sweep) throw new BadRequestException('Sweep not found');
    if (sweep.state !== 'APPROVED') throw new BadRequestException(`Sweep must be APPROVED to execute, current: ${sweep.state}`);
    const provider = await this.providerFactory.getProviderForNetwork({ networkId: sweep.networkId, assetId: sweep.assetId });
    const capabilities = await provider.getCapabilities();
    if (!capabilities.canSubmitTransaction || !provider.submitTransaction) throw new BadRequestException('Provider cannot submit this sweep');
    // Provider capability alone is not a submission or a ledger debit/credit. No sweep submission/confirmation bridge is configured.
    // Preserve APPROVED, submittedAt, providerReference and settledAt; a clock-derived reference cannot prove settlement.
    throw new ServiceUnavailableException('Sweep execution unavailable: an authoritative submission/confirmation bridge is required; no transaction or settlement is simulated');
  }

  async listSweeps(params: {
    tenantId: string; sourceWalletId?: string; destinationWalletId?: string; assetId?: string; state?: string; page?: number; limit?: number;
  }): Promise<{ data: CustodySweep[]; total: number; page: number; limit: number }> {
    const { tenantId, sourceWalletId, destinationWalletId, assetId, state, page = 1, limit = 50 } = params;
    const where: Prisma.CustodySweepWhereInput = { tenantId };
    if (sourceWalletId) where.sourceWalletId = sourceWalletId;
    if (destinationWalletId) where.destinationWalletId = destinationWalletId;
    if (assetId) where.assetId = assetId;
    if (state) {
      const member = Object.values(NativeSweepState).find((value) => value === state);
      if (!member) throw new BadRequestException('Invalid persisted sweep state');
      where.state = member;
    }
    const [data, total] = await Promise.all([
      this.prisma.custodySweep.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), this.prisma.custodySweep.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
