// # Responsibility: persist typed tenant funding workflows and transactional outbox events without treating requests as proof of funds movement.
// # Integrates deposit address provisioning and deposit status transitions
import { Injectable, Logger, BadRequestException, ConflictException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, FundingRequestState as StoredFundingState, type FundingRequest } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { AccountRestrictionService } from './account-restriction.service';
import { deterministicIdempotencyKey, FundingRequestState, FUNDING_VALID_TRANSITIONS, isValidDecimal, isPositiveDecimal, AccountRestrictionType, lifecycleEnum, lifecycleMetadata, redactPiiAndSecrets } from './client-lifecycle.types';

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
    @Optional() private readonly outbox?: OutboxService,
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
    metadata?: Record<string, unknown>;
  }): Promise<FundingRequest> {
    const { tenantId, accountId, clientProfileId = null, requestedAmount, currency, externalReference = null, sourceType = null, requestedBy = null, correlationId = null, metadata = {} } = params;

    if (!isValidDecimal(requestedAmount)) throw new BadRequestException(`Invalid requestedAmount decimal: ${requestedAmount}`);
    if (!isPositiveDecimal(requestedAmount)) throw new BadRequestException('requestedAmount must be greater than zero');

    const account = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const scopedAccount = await tx.institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!scopedAccount) throw new BadRequestException('Account not found or tenant mismatch');
      if (clientProfileId) {
        const profile = await tx.clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
        if (!profile || (scopedAccount.clientProfileId && scopedAccount.clientProfileId !== clientProfileId)) {
          throw new BadRequestException('Funding client profile not found, tenant mismatch, or account/profile mismatch');
        }
      }
      return scopedAccount;
    });

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId, clientProfileId: clientProfileId ?? undefined });

    if (!policy.fundingControls.allowedCurrencies.includes(currency)) {
      throw new BadRequestException(`Currency ${currency} not allowed`);
    }

    if (policy.fundingControls.requireExternalReference && !externalReference) {
      throw new BadRequestException('External reference required by policy');
    }

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: 'funding-request',
      tenantId,
      accountId,
      externalRef: externalReference ?? `${requestedAmount}:${currency}:${Date.now()}`,
    });

    const storedMetadata = lifecycleMetadata(metadata);
    const effectiveProfileId = clientProfileId ?? account.clientProfileId ?? null;
    const matchesIntent = (row: FundingRequest): boolean =>
      row.idempotencyKey === idempotencyKey && row.accountId === accountId &&
      row.clientProfileId === effectiveProfileId && row.requestedAmount === requestedAmount &&
      row.currency === currency && row.externalReference === externalReference &&
      row.sourceType === sourceType && row.requestedBy === requestedBy &&
      isDeepStrictEqual(row.metadata, storedMetadata);

    if (!this.outbox) {
      throw new Error('Transactional outbox is unavailable; refusing funding request without its funding.requested event');
    }
    let outcome: { request: FundingRequest; created: boolean };
    try {
      outcome = await this.prisma.withTenantRls(tenantId, async (tx) => {
        const store = tx;
        // Repeat account and restriction checks on the transaction that writes
        // the request. Under forced RLS, an unscoped read would otherwise make
        // an active restriction invisible to this endpoint.
        const currentAccount = await tx.institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
        if (!currentAccount || currentAccount.deletedAt || currentAccount.state !== 'ACTIVE' || !currentAccount.isFundingEnabled ||
            currentAccount.clientProfileId !== account.clientProfileId) {
          throw new BadRequestException('Account is not eligible for deposits');
        }
        if (await this.restrictionService.hasRestriction({ tenantId, accountId, restrictionType: AccountRestrictionType.NO_DEPOSIT }, tx)) {
          throw new BadRequestException('NO_DEPOSIT restriction active — funding request blocked');
        }
        if (externalReference) {
          // Serialize the reference check and insert across concurrent requests.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`funding-reference:${tenantId}:${externalReference}`}::text, 0))::text AS locked`;
          const duplicate = await store.fundingRequest.findFirst({ where: { tenantId, externalReference } });
          if (duplicate) {
            if (matchesIntent(duplicate)) return { request: duplicate, created: false };
            throw new BadRequestException('Duplicate external funding reference detected');
          }
        }
        const existing = await store.fundingRequest.findFirst({ where: { tenantId, idempotencyKey } });
        if (existing) {
          if (!matchesIntent(existing)) throw new ConflictException('Request key already used for a different funding request');
          return { request: existing, created: false };
        }
        const created = await store.fundingRequest.create({
          data: {
            tenantId,
            accountId,
            clientProfileId: effectiveProfileId,
            state: 'REQUESTED',
            requestedAmount,
            currency,
            externalReference: externalReference ?? null,
            sourceType: sourceType ?? null,
            requestedBy: requestedBy ?? null,
            idempotencyKey,
            metadata: storedMetadata,
            requestedAt: new Date(),
          },
        });
        await tx.clientLifecycleAudit.create({ data: {
          tenantId, clientProfileId: effectiveProfileId, accountId, action: 'FUNDING_REQUESTED',
          entityType: 'FUNDING_REQUEST', entityId: created.id, actorId: requestedBy,
          actorType: requestedBy ? 'USER' : null, toState: 'REQUESTED',
          correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
          // Do not copy the external payment reference into audit evidence.
          evidence: { requestedAmount, currency, sourceType },
        } });
        await this.outbox!.append(tx, {
          tenantId,
          aggregateType: 'funding_request',
          aggregateId: created.id,
          eventType: 'funding.requested',
          idempotencyKey: `funding-request:${created.id}:requested`,
          correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
          occurredAt: created.requestedAt,
          payload: {
            fundingRequestId: created.id,
            amount: created.requestedAmount,
            currency: created.currency,
            status: created.state,
          },
        });
        return { request: created, created: true };
      });
    } catch (error) {
      // The tenant/key unique constraint serializes concurrent creation. If a
      // competing transaction won, read the committed row and verify its
      // immutable intent before treating this call as a retry.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.withTenantRls(tenantId, (tx) =>
          tx.fundingRequest.findFirst({ where: { tenantId, idempotencyKey } }),
        );
        if (existing) {
          if (!matchesIntent(existing)) throw new ConflictException('Request key already used for a different funding request');
          return existing;
        }
      }
      throw error;
    }
    const fundingRequest = outcome.request;
    if (!outcome.created) return fundingRequest;


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
  }): Promise<FundingRequest> {
    const { tenantId, fundingRequestId, toState, operatorId = null, reason, approvedAmount = null, submittedAmount = null, confirmedAmount = null, settledAmount = null, externalReference = null, correlationId = null } = params;

    const request = await this.prisma.withTenantRls(tenantId, (tx) =>
      tx.fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } }));
    if (!request) throw new BadRequestException('Funding request not found');

    const currentState = lifecycleEnum(Object.values(FundingRequestState), request.state, 'persisted funding state');
    const allowed = FUNDING_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid funding transition ${currentState} → ${toState}`);
    }

    // Never convert REQUESTED → CONFIRMED merely because operator clicked approve
    if (currentState === FundingRequestState.REQUESTED && toState === FundingRequestState.CONFIRMED) {
      throw new BadRequestException('Invalid transition REQUESTED → CONFIRMED — must go through UNDER_REVIEW→APPROVED→SUBMITTED→CONFIRMED with external confirmation');
    }

    // A caller-supplied reference and amount do not prove provider settlement
    // or a spendable customer credit. Do not publish funding.confirmed or
    // change the workflow until an authoritative credit can commit atomically.
    if (toState === FundingRequestState.CONFIRMED) {
      throw new ServiceUnavailableException('Customer credit has not been independently verified; funding cannot be confirmed.');
    }
    if (confirmedAmount !== null || settledAmount !== null) {
      throw new BadRequestException('Confirmed and settled amounts require verified funding settlement.');
    }
    for (const [field, value] of [['approvedAmount', approvedAmount], ['submittedAmount', submittedAmount]] as const) {
      // These columns are strings. Validate without scaling/truncating an
      // asset's smallest units or accepting an invalid amount as positive.
      if (value !== null && (typeof value !== 'string' || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value))) {
        throw new BadRequestException(`${field} must be a positive decimal string`);
      }
    }
    const updated = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const store = tx;
      const current = await store.fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } });
      if (!current || current.state !== currentState) {
        throw new BadRequestException('Funding request changed during transition; reload and retry');
      }
      const changed = await store.fundingRequest.updateMany({
        where: { id: fundingRequestId, tenantId, state: current.state },
        data: {
          state: toState,
          ...(approvedAmount ? { approvedAmount } : {}),
          ...(submittedAmount ? { submittedAmount } : {}),
          ...(externalReference ? { externalReference } : {}),
          ...(toState === FundingRequestState.APPROVED ? { approvedAt: new Date(), approvedBy: operatorId } : {}),
          ...(toState === FundingRequestState.SUBMITTED ? { submittedAt: new Date() } : {}),
          ...(toState === FundingRequestState.FAILED ? { failedAt: new Date(), failureReason: reason } : {}),
          ...(toState === FundingRequestState.REVERSED ? { reversalReason: reason } : {}),
        },
      });
      if (changed.count !== 1) throw new BadRequestException('Funding request changed during transition; reload and retry');
      const row = await store.fundingRequest.findFirstOrThrow({ where: { id: fundingRequestId, tenantId } });
      await store.clientLifecycleAudit.create({ data: {
        tenantId, clientProfileId: row.clientProfileId, accountId: row.accountId, action: 'FUNDING_STATE_CHANGED',
        entityType: 'FUNDING_REQUEST', entityId: row.id, actorId: operatorId,
        fromState: currentState, toState, reason: reason ? redactPiiAndSecrets(reason).slice(0, 1000) : null,
        correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
        // Do not duplicate external payment references in audit evidence.
        evidence: { fromState: currentState, toState, approvedAmount, submittedAmount },
      } });
      return row;
    });

    return updated;
  }

  async getFundingRequest(params: { tenantId: string; fundingRequestId: string }): Promise<FundingRequest | null> {
    return this.prisma.withTenantRls(params.tenantId, (tx) => tx.fundingRequest.findFirst({ where: { id: params.fundingRequestId, tenantId: params.tenantId } }));
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
  }): Promise<{ data: FundingRequest[]; total: number; page: number; limit: number }> {
    const { tenantId, accountId, clientProfileId, state, currency, externalReference, page = 1, limit = 50 } = params;
    const where: Prisma.FundingRequestWhereInput = { tenantId };
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (state) where.state = lifecycleEnum(Object.values(StoredFundingState), state, 'funding state');
    if (currency) where.currency = currency;
    if (externalReference) where.externalReference = externalReference;

    const [data, total] = await this.prisma.withTenantRls(tenantId, (tx) => Promise.all([
      tx.fundingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.fundingRequest.count({ where }),
    ]));
    return { data, total, page, limit };
  }
}
