import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { AccountRestrictionService } from './account-restriction.service';
import { deterministicIdempotencyKey, FundingRequestState, FUNDING_VALID_TRANSITIONS, isValidDecimal } from './client-lifecycle.types';

/**
 * Creates and manages deposit/funding requests with explicit states, requested amount/currency,
 * external reference, source type, approval requirements, and settlement status.
 * A request is never proof that funds moved. A pending funding request must never be reported as completed money movement.
 */

@Injectable()
export class FundingRequestService {
  private readonly logger = new Logger(FundingRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
    private readonly restrictionService: AccountRestrictionService,
  ) {}

  async createFundingRequest(params: {
    tenantId: string;
    accountId: string;
    clientProfileId?: string | null;
    requestedAmount: string;
    currency: string;
    externalReference?: string | null;
    sourceType?: string | null;
    requestedBy?: string | null;
    idempotencyKey?: string;
    correlationId?: string | null;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, accountId, clientProfileId = null, requestedAmount, currency, externalReference = null, sourceType = null, requestedBy = null, correlationId = null, metadata = {} } = params;

    if (!isValidDecimal(requestedAmount)) throw new BadRequestException(`Invalid requestedAmount decimal: ${requestedAmount}`);

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found or tenant mismatch');

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId, clientProfileId: clientProfileId ?? undefined });

    // Check NO_DEPOSIT restriction blocks funding request
    const canDeposit = await this.restrictionService.hasRestriction({ tenantId, accountId, restrictionType: 'NO_DEPOSIT' as any });
    if (canDeposit) {
      throw new BadRequestException('NO_DEPOSIT restriction active — funding request blocked');
    }

    if (!policy.fundingControls.allowedCurrencies.includes(currency)) {
      throw new BadRequestException(`Currency ${currency} not allowed`);
    }

    if (policy.fundingControls.requireExternalReference && !externalReference) {
      throw new BadRequestException('External reference required by policy');
    }

    // Check duplicate external funding reference
    if (externalReference) {
      try {
        const dup = await (this.prisma as any).fundingRequest.findFirst({ where: { tenantId, externalReference } });
        if (dup) {
          throw new BadRequestException(`Duplicate external funding reference detected: ${externalReference}`);
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
    }

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: 'funding-request',
      tenantId,
      accountId,
      externalRef: externalReference ?? `${requestedAmount}:${currency}:${Date.now()}`,
    });

    try {
      const existing = await (this.prisma as any).fundingRequest.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log({ event: 'client.funding.idempotent_hit', idempotencyKey });
        return existing;
      }
    } catch {}

    const fundingRequest = await (this.prisma as any).fundingRequest.create({
      data: {
        tenantId,
        accountId,
        clientProfileId: clientProfileId ?? account.clientProfileId ?? null,
        state: 'REQUESTED',
        requestedAmount,
        currency,
        externalReference: externalReference ?? null,
        sourceType: sourceType ?? null,
        requestedBy: requestedBy ?? null,
        idempotencyKey,
        metadata,
        requestedAt: new Date(),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? account.clientProfileId,
      accountId,
      action: 'FUNDING_REQUESTED',
      entityType: 'FUNDING_REQUEST',
      entityId: fundingRequest.id,
      actorId: requestedBy,
      toState: 'REQUESTED',
      correlationId,
      evidence: { requestedAmount, currency, externalReference, sourceType },
    });

    this.logger.log({ event: 'client.funding.requested', tenantId, accountId, requestedAmount, currency });

    return fundingRequest;
  }

  async transitionFundingRequest(params: {
    tenantId: string;
    fundingRequestId: string;
    toState: FundingRequestState;
    operatorId?: string | null;
    reason?: string;
    approvedAmount?: string | null;
    submittedAmount?: string | null;
    confirmedAmount?: string | null;
    settledAmount?: string | null;
    externalReference?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, fundingRequestId, toState, operatorId = null, reason, approvedAmount = null, submittedAmount = null, confirmedAmount = null, settledAmount = null, externalReference = null, correlationId = null } = params;

    const request = await (this.prisma as any).fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } });
    if (!request) throw new BadRequestException('Funding request not found');

    const currentState = request.state as FundingRequestState;
    const allowed = FUNDING_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid funding transition ${currentState} → ${toState}`);
    }

    // Never convert REQUESTED → CONFIRMED merely because operator clicked approve
    if (currentState === FundingRequestState.REQUESTED && toState === FundingRequestState.CONFIRMED) {
      throw new BadRequestException('Invalid transition REQUESTED → CONFIRMED — must go through UNDER_REVIEW→APPROVED→SUBMITTED→CONFIRMED with external confirmation');
    }

    // CONFIRMED only when authoritative external confirms — check externalReference or evidence
    if (toState === FundingRequestState.CONFIRMED) {
      if (!request.externalReference && !externalReference) {
        throw new BadRequestException('CONFIRMED state requires external reference from authoritative payment/custody/exchange');
      }
      // In real implementation, would verify external settlement via payment provider
      // Here we require confirmedAmount and external reference
      if (!confirmedAmount) {
        throw new BadRequestException('CONFIRMED requires confirmedAmount from external settlement');
      }
    }

    // A rejected/blocked request must never be silently retried into success
    if (currentState === FundingRequestState.FAILED && toState === FundingRequestState.CONFIRMED) {
      throw new BadRequestException('Failed request cannot be directly transitioned to CONFIRMED — requires reversal and new request');
    }

    const updated = await (this.prisma as any).fundingRequest.update({
      where: { id: fundingRequestId },
      data: {
        state: toState as any,
        ...(approvedAmount ? { approvedAmount } : {}),
        ...(submittedAmount ? { submittedAmount } : {}),
        ...(confirmedAmount ? { confirmedAmount } : {}),
        ...(settledAmount ? { settledAmount } : {}),
        ...(externalReference ? { externalReference } : {}),
        ...(toState === FundingRequestState.APPROVED ? { approvedAt: new Date(), approvedBy: operatorId } : {}),
        ...(toState === FundingRequestState.SUBMITTED ? { submittedAt: new Date() } : {}),
        ...(toState === FundingRequestState.CONFIRMED ? { confirmedAt: new Date() } : {}),
        ...(toState === FundingRequestState.FAILED ? { failedAt: new Date(), failureReason: reason } : {}),
        ...(toState === FundingRequestState.REVERSED ? { reversalReason: reason } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: request.clientProfileId,
      accountId: request.accountId,
      action: 'FUNDING_STATE_CHANGED',
      entityType: 'FUNDING_REQUEST',
      entityId: fundingRequestId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, approvedAmount, confirmedAmount, externalReference },
    });

    return updated;
  }

  async getFundingRequest(params: { tenantId: string; fundingRequestId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).fundingRequest.findFirst({ where: { id: params.fundingRequestId, tenantId: params.tenantId } });
    } catch {
      return null;
    }
  }

  async listFundingRequests(params: {
    tenantId: string;
    accountId?: string;
    clientProfileId?: string;
    state?: string;
    currency?: string;
    externalReference?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, accountId, clientProfileId, state, currency, externalReference, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (state) where.state = state;
    if (currency) where.currency = currency;
    if (externalReference) where.externalReference = externalReference;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).fundingRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).fundingRequest.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
