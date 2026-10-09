import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { AccountRestrictionService } from './account-restriction.service';
import { deterministicIdempotencyKey, WithdrawalRequestState, WITHDRAWAL_VALID_TRANSITIONS, isValidDecimal, isPositiveDecimal } from './client-lifecycle.types';

/**
 * Creates and manages withdrawal requests with approval, compliance, risk, security, destination validation,
 * external reference, and explicit completion/rejection states. Must never directly transfer funds.
 */

@Injectable()
export class WithdrawalRequestService {
  private readonly logger = new Logger(WithdrawalRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
    private readonly restrictionService: AccountRestrictionService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  async createWithdrawalRequest(params: {
    tenantId: string;
    accountId: string;
    clientProfileId?: string | null;
    requestedAmount: string;
    currency: string;
    destinationAddress?: string | null;
    destinationType?: string | null;
    externalReference?: string | null;
    requestedBy?: string | null;
    idempotencyKey?: string;
    correlationId?: string | null;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, accountId, clientProfileId = null, requestedAmount, currency, destinationAddress = null, destinationType = null, externalReference = null, requestedBy = null, correlationId = null, metadata = {} } = params;

    if (!isValidDecimal(requestedAmount)) throw new BadRequestException(`Invalid requestedAmount: ${requestedAmount}`);
    if (!isPositiveDecimal(requestedAmount)) throw new BadRequestException('requestedAmount must be greater than zero');

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found');

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId, clientProfileId: clientProfileId ?? undefined });

    // Withdrawals must require explicit evaluation of:
    // Account ownership, status, NO_WITHDRAWAL restriction, Compliance, Risk, Security/MFA, Destination validation, etc.

    // Account ownership is enforced before this service is reached:
    // ClientLifecycleController.assertAccountAccess limits customers to the
    // accounts in their own scope (404 otherwise) and lets tenant-wide staff
    // act on a client's behalf; the controller is the only caller. Here a
    // requester who is not a registered owner is recorded as an on-behalf
    // request for the audit trail. (This lookup used to sit in `catch {}`
    // behind a "for test purposes, allow but log" comment.)
    if (requestedBy) {
      const ownership = await this.prisma.accountOwnership.findFirst({
        where: { tenantId, accountId, ownerId: requestedBy, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!ownership) {
        this.logger.warn({ event: 'client.withdrawal.requested_on_behalf', accountId, requestedBy });
      }
    }

    // Account status
    if (['CLOSED', 'CLOSURE_PENDING', 'SUSPENDED'].includes(account.state)) {
      throw new BadRequestException(`Account status ${account.state} cannot request withdrawal`);
    }

    // NO_WITHDRAWAL restriction blocks withdrawal
    const hasNoWithdrawal = await this.restrictionService.hasRestriction({ tenantId, accountId, restrictionType: 'NO_WITHDRAWAL' as any });
    if (hasNoWithdrawal) {
      throw new BadRequestException('NO_WITHDRAWAL restriction active — withdrawal blocked');
    }

    // Compliance status
    if (policy.withdrawalRules.requireComplianceCheck && account.complianceStatus && ['BLOCKED', 'HOLD', 'REJECTED'].includes(account.complianceStatus)) {
      throw new BadRequestException(`Compliance status ${account.complianceStatus} blocks withdrawal`);
    }

    // Risk state
    if (policy.withdrawalRules.requireRiskCheck && account.riskStatus && ['BLOCKED', 'HOLD'].includes(account.riskStatus)) {
      throw new BadRequestException(`Risk state ${account.riskStatus} blocks withdrawal`);
    }

    // Security/MFA — would delegate to SecurityModule
    // Destination validation
    if (policy.fundingControls.requireDestinationValidation && !destinationAddress) {
      throw new BadRequestException('Destination validation required — destinationAddress missing');
    }

    // Available authoritative balance — would check via Finance/Exchange balance authority, not trust client
    // For now, log that we would check authoritative balance
    this.logger.debug({ event: 'client.withdrawal.balance_check', accountId, requestedAmount, currency, note: 'Would check authoritative balance from Finance/Exchange' });

    // Pending withdrawals — check for existing pending withdrawals
    try {
      const pending = await (this.prisma as any).withdrawalRequest.count({
        where: { tenantId, accountId, state: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED'] } },
      });
      if (pending > 5) {
        throw new BadRequestException(`Too many pending withdrawals (${pending}) — operational restriction`);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    if (!policy.fundingControls.allowedCurrencies.includes(currency)) {
      throw new BadRequestException(`Currency ${currency} not allowed`);
    }

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: 'withdrawal-request',
      tenantId,
      accountId,
      externalRef: externalReference ?? `${requestedAmount}:${currency}:${destinationAddress ?? ''}:${Date.now()}`,
    });

    if (!this.outbox) {
      throw new Error('Transactional outbox is unavailable; refusing withdrawal request without its withdrawal.requested event');
    }
    const withdrawalRequest = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const store = tx as any;
      const existing = await store.withdrawalRequest.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) return existing;
      if (externalReference) {
        const duplicate = await store.withdrawalRequest.findFirst({ where: { tenantId, externalReference } });
        if (duplicate) throw new BadRequestException(`Duplicate external withdrawal reference: ${externalReference}`);
      }
      const created = await store.withdrawalRequest.create({
        data: {
          tenantId,
          accountId,
          clientProfileId: clientProfileId ?? account.clientProfileId ?? null,
          state: 'REQUESTED',
          requestedAmount,
          currency,
          destinationAddress: destinationAddress ?? null,
          destinationType: destinationType ?? null,
          externalReference: externalReference ?? null,
          requestedBy: requestedBy ?? null,
          idempotencyKey,
          metadata,
          requestedAt: new Date(),
        },
      });
      await this.outbox!.append(tx, {
        tenantId,
        aggregateType: 'withdrawal_request',
        aggregateId: created.id,
        eventType: 'withdrawal.requested',
        idempotencyKey: `withdrawal-request:${created.id}:requested`,
        correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
        occurredAt: created.requestedAt,
        payload: {
          withdrawalRequestId: created.id,
          amount: created.requestedAmount,
          currency: created.currency,
          status: created.state,
        },
      });
      return created;
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? account.clientProfileId,
      accountId,
      action: 'WITHDRAWAL_REQUESTED',
      entityType: 'WITHDRAWAL_REQUEST',
      entityId: withdrawalRequest.id,
      actorId: requestedBy,
      toState: 'REQUESTED',
      correlationId,
      evidence: { requestedAmount, currency, destinationAddress, destinationType, externalReference },
    });

    this.logger.log({ event: 'client.withdrawal.requested', tenantId, accountId, requestedAmount, currency });

    return withdrawalRequest;
  }

  async transitionWithdrawalRequest(params: {
    tenantId: string;
    withdrawalRequestId: string;
    toState: WithdrawalRequestState;
    operatorId?: string | null;
    reason?: string;
    approvedAmount?: string | null;
    submittedAmount?: string | null;
    confirmedAmount?: string | null;
    settledAmount?: string | null;
    externalReference?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, withdrawalRequestId, toState, operatorId = null, reason, approvedAmount = null, submittedAmount = null, confirmedAmount = null, settledAmount = null, externalReference = null, correlationId = null } = params;

    const request = await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });
    if (!request) throw new BadRequestException('Withdrawal request not found');

    const currentState = request.state as WithdrawalRequestState;
    const allowed = WITHDRAWAL_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid withdrawal transition ${currentState} → ${toState}`);
    }

    if (currentState === WithdrawalRequestState.REQUESTED && toState === WithdrawalRequestState.CONFIRMED) {
      throw new BadRequestException('REQUESTED → CONFIRMED not allowed — must go through approval and external confirmation');
    }

    if (toState === WithdrawalRequestState.CONFIRMED) {
      if (!request.externalReference && !externalReference) {
        throw new BadRequestException('CONFIRMED requires external reference from authoritative payment/custody/exchange');
      }
      if (!confirmedAmount) {
        throw new BadRequestException('CONFIRMED requires confirmedAmount from external settlement');
      }
    }

    // Must never directly transfer funds — actual settlement delegated to existing authoritative integration
    if (toState === WithdrawalRequestState.CONFIRMED) {
      this.logger.log({ event: 'client.withdrawal.confirmed_external', withdrawalRequestId, note: 'Settlement delegated to authoritative payment/custody/exchange integration, not direct transfer' });
    }

    if (toState === WithdrawalRequestState.CONFIRMED && !this.outbox) {
      throw new Error('Transactional outbox is unavailable; refusing withdrawal confirmation without its withdrawal.confirmed event');
    }
    const updated = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const store = tx as any;
      const current = await store.withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });
      if (!current || current.state !== currentState) {
        throw new BadRequestException('Withdrawal request changed during transition; reload and retry');
      }
      const changed = await store.withdrawalRequest.update({
        where: { id: withdrawalRequestId },
        data: {
          state: toState as any,
          ...(approvedAmount ? { approvedAmount } : {}),
          ...(submittedAmount ? { submittedAmount } : {}),
          ...(confirmedAmount ? { confirmedAmount } : {}),
          ...(settledAmount ? { settledAmount } : {}),
          ...(externalReference ? { externalReference } : {}),
          ...(toState === WithdrawalRequestState.APPROVED ? { approvedAt: new Date(), approvedBy: operatorId } : {}),
          ...(toState === WithdrawalRequestState.SUBMITTED ? { submittedAt: new Date() } : {}),
          ...(toState === WithdrawalRequestState.CONFIRMED ? { confirmedAt: new Date() } : {}),
          ...(toState === WithdrawalRequestState.FAILED ? { failedAt: new Date(), failureReason: reason } : {}),
          ...(toState === WithdrawalRequestState.REVERSED ? { reversalReason: reason } : {}),
        },
      });
      if (toState === WithdrawalRequestState.CONFIRMED) {
        await this.outbox!.append(tx, {
          tenantId,
          aggregateType: 'withdrawal_request',
          aggregateId: changed.id,
          eventType: 'withdrawal.confirmed',
          idempotencyKey: `withdrawal-request:${changed.id}:confirmed`,
          correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
          occurredAt: changed.confirmedAt ?? changed.updatedAt,
          payload: {
            withdrawalRequestId: changed.id,
            amount: changed.confirmedAmount,
            currency: changed.currency,
            status: changed.state,
          },
        });
      }
      return changed;
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: request.clientProfileId,
      accountId: request.accountId,
      action: 'WITHDRAWAL_STATE_CHANGED',
      entityType: 'WITHDRAWAL_REQUEST',
      entityId: withdrawalRequestId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, approvedAmount, confirmedAmount },
    });

    return updated;
  }

  async getWithdrawalRequest(params: { tenantId: string; withdrawalRequestId: string }): Promise<any | null> {
    return await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: params.withdrawalRequestId, tenantId: params.tenantId } });
  }

  async listWithdrawalRequests(params: {
    tenantId: string;
    accountId?: string;
    clientProfileId?: string;
    state?: string;
    currency?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, accountId, clientProfileId, state, currency, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (state) where.state = state;
    if (currency) where.currency = currency;

    const [data, total] = await Promise.all([
      (this.prisma as any).withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (this.prisma as any).withdrawalRequest.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
