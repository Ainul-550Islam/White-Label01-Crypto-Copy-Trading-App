import { Injectable, Logger, BadRequestException, ConflictException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { TreasuryBalanceService } from '../custody/treasury-balance.service';
import { ReserveManagementService, lockCustodyReserveAccounting } from '../custody/reserve-management.service';
import { normaliseAddress } from '../custody/withdrawal-destination-policy.service';
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
    @Optional() private readonly balances?: TreasuryBalanceService,
    @Optional() private readonly reserves?: ReserveManagementService,
  ) {}

  async createWithdrawalRequest(params: {
    tenantId: string; accountId: string; clientProfileId?: string | null; requestedAmount: string; currency: string;
    destinationAddress?: string | null; destinationType?: string | null; externalReference?: string | null;
    requestedBy?: string | null; idempotencyKey?: string; correlationId?: string | null; stepUpVerified?: boolean;
    metadata?: unknown;
  }): Promise<any> {
    const { tenantId, accountId, requestedAmount, currency, requestedBy, idempotencyKey, correlationId = null } = params;
    if (!isValidDecimal(requestedAmount)) throw new BadRequestException('Invalid requested amount');
    if (!isPositiveDecimal(requestedAmount)) throw new BadRequestException('requestedAmount must be greater than zero');
    if (requestedAmount.length > 64 || (requestedAmount.split('.')[1]?.length ?? 0) > 12) throw new BadRequestException('Unsupported amount precision');
    // Keep the account lookup before other gates, but reveal no other account's existence.
    const account = await this.prisma.withTenantRls(tenantId, (tx) => tx.institutionalAccount.findFirst({ where: { id: accountId, tenantId } }));
    if (!account) throw new BadRequestException('Account not found');
    if (!requestedBy || !params.stepUpVerified) throw new BadRequestException('Fresh multi-factor verification is required');
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new BadRequestException('A valid idempotency key is required');
    if (!/^[A-Z0-9]{2,10}$/.test(currency)) throw new BadRequestException('Invalid currency');
    const network = String(params.destinationType ?? '').trim().toUpperCase();
    let address: string;
    try { address = normaliseAddress(network, params.destinationAddress ?? '').address; }
    catch { throw new BadRequestException('A valid withdrawal network and destination are required'); }
    if (!this.outbox || !this.balances || !this.reserves) throw new ServiceUnavailableException('Withdrawal safety checks are unavailable');

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId, clientProfileId: account.clientProfileId ?? undefined });
    if (!policy.fundingControls.allowedCurrencies.includes(currency)) throw new BadRequestException('Currency is not allowed');
    if (params.clientProfileId && params.clientProfileId !== account.clientProfileId) throw new BadRequestException('Account not found');
    if (account.state !== 'ACTIVE' || !account.isWithdrawalEnabled || account.deletedAt) throw new BadRequestException('Account is not available for withdrawal');
    if ((policy.withdrawalRules.requireComplianceCheck && account.complianceStatus !== 'CLEAR') ||
        (policy.withdrawalRules.requireRiskCheck && account.riskStatus !== 'CLEAR')) throw new BadRequestException('Required account clearance is unavailable');
    const owner = await this.prisma.withTenantRls(tenantId, (tx) => tx.accountOwnership.findFirst({ where: { tenantId, accountId, ownerId: requestedBy, status: 'ACTIVE' }, select: { id: true } }));
    if (!owner) throw new BadRequestException('Account not found');

    // Idempotent retries are scoped to the same actor and exact immutable intent.
    const sameIntent = (row: { accountId: string; requestedBy: string | null; requestedAmount: string; currency: string; destinationAddress: string | null; destinationType: string | null }) =>
      row.accountId === accountId && row.requestedBy === requestedBy && row.requestedAmount === requestedAmount && row.currency === currency && row.destinationAddress === address && row.destinationType === network;
    const existing = await this.prisma.withTenantRls(tenantId, (tx) => tx.withdrawalRequest.findFirst({ where: { tenantId, idempotencyKey } }));
    if (existing) { if (!sameIntent(existing)) throw new ConflictException('Request key already used'); return existing; }

    const wallets = await this.prisma.withTenantRls(tenantId, (tx) => tx.custodyWallet.findMany({
      where: { tenantId, accountId, state: 'ACTIVE', isActive: true, scope: 'ACCOUNT', networkId: { equals: network, mode: 'insensitive' }, asset: { is: { symbol: currency, isActive: true } } },
      select: { id: true, assetId: true, networkId: true, asset: { select: { decimals: true, networkId: true } } }, take: 2,
    }));
    const wallet = wallets[0];
    if (wallets.length !== 1 || !wallet?.assetId || !wallet.networkId || !wallet.asset ||
        (requestedAmount.split('.')[1]?.length ?? 0) > wallet.asset.decimals || (wallet.asset.networkId !== null && wallet.asset.networkId.toUpperCase() !== network)) throw new ServiceUnavailableException('An authoritative account wallet is unavailable');
    const identity = { tenantId, walletId: wallet.id, assetId: wallet.assetId, networkId: wallet.networkId };
    let balance: Awaited<ReturnType<TreasuryBalanceService['getWalletBalance']>>;
    try { balance = await this.balances.getWalletBalance(identity); }
    catch { throw new ServiceUnavailableException('Withdrawal balance evidence is unavailable'); }
    const observedAt = Date.parse(balance.observationTimestamp);
    if (balance.dataCompleteness !== 'PROVIDER_DERIVED' || balance.walletId !== wallet.id || balance.assetId !== wallet.assetId ||
        balance.networkId !== wallet.networkId || !balance.sourceReference || balance.available === null || !isValidDecimal(balance.available) ||
        new Prisma.Decimal(balance.available).isNegative() || !Number.isFinite(observedAt) ||
        observedAt > Date.now() + 5_000 || Date.now() - observedAt > 60_000) {
      throw new ServiceUnavailableException('Withdrawal balance evidence is unavailable');
    }
    const referenceHash = createHash('sha256').update(balance.sourceReference).digest('hex');
    const outbox = this.outbox;
    const reserves = this.reserves;
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      // Serialize both reserve creation and pending-request accounting; no
      // external provider call is made while these transaction locks are held.
      await lockCustodyReserveAccounting(tx, tenantId, identity.assetId);
      await tx.$queryRaw`SELECT id FROM institutional_accounts WHERE id=${accountId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
      const retry = await tx.withdrawalRequest.findFirst({ where: { tenantId, idempotencyKey } });
      if (retry) { if (!sameIntent(retry)) throw new ConflictException('Request key already used'); return retry; }
      const current = await tx.institutionalAccount.findFirst({ where: { id: accountId, tenantId, state: 'ACTIVE', isWithdrawalEnabled: true, deletedAt: null } });
      const stillOwner = await tx.accountOwnership.findFirst({ where: { tenantId, accountId, ownerId: requestedBy, status: 'ACTIVE' } });
      if (!current || !stillOwner || (policy.withdrawalRules.requireComplianceCheck && current.complianceStatus !== 'CLEAR') ||
          (policy.withdrawalRules.requireRiskCheck && current.riskStatus !== 'CLEAR')) throw new BadRequestException('Required account clearance is unavailable');
      const restrictions = await tx.accountRestriction.count({ where: { tenantId, accountId, status: 'ACTIVE', restrictionType: { in: ['NO_WITHDRAWAL', 'ACCOUNT_LOCKED', 'COMPLIANCE_HOLD', 'SECURITY_HOLD', 'RISK_HOLD', 'OPERATIONAL_HOLD'] } } });
      if (restrictions) throw new BadRequestException('Account restrictions prevent withdrawal');
      const maintenance = await tx.operationalMaintenanceWindow.findFirst({ where: { state: 'ACTIVE', OR: [{ tenantId }, { tenantId: null }], scope: { in: ['PLATFORM', 'TENANT', 'TRADING_CAPABILITY'] } } });
      if (maintenance) throw new ServiceUnavailableException('Withdrawals are temporarily unavailable');
      const activeNetwork = await tx.custodyNetwork.findFirst({ where: { networkId: identity.networkId, status: 'ACTIVE' }, select: { id: true } });
      if (!activeNetwork) throw new ServiceUnavailableException('Withdrawal network evidence is unavailable');
      const destinations = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM withdrawal_destinations WHERE tenant_id=${tenantId}::uuid AND user_id=${requestedBy}::uuid AND network=${network} AND address=${address} AND status='ACTIVE' AND revoked_at IS NULL AND activates_at<=NOW() FOR SHARE`;
      if (!destinations[0]) throw new BadRequestException('An active withdrawal destination is required');
      const currentWallet = await tx.custodyWallet.findFirst({ where: { id: wallet.id, tenantId, accountId, state: 'ACTIVE', isActive: true, scope: 'ACCOUNT', assetId: identity.assetId, networkId: identity.networkId } });
      if (!currentWallet) throw new ServiceUnavailableException('An authoritative account wallet is unavailable');
      let reserve: Awaited<ReturnType<ReserveManagementService['evaluateReserveSufficiency']>>;
      try { reserve = await reserves.evaluateReserveSufficiency({ ...identity, requestedAmount }, balance); }
      catch { throw new ServiceUnavailableException('Withdrawal reserve evidence is unavailable'); }
      if (reserve.dataCompleteness !== 'PROVIDER_DERIVED' || !reserve.sufficient || reserve.availableAfterReserve === null ||
          !isValidDecimal(reserve.availableAfterReserve) || new Prisma.Decimal(reserve.availableAfterReserve).isNegative()) {
        throw new ServiceUnavailableException('Withdrawal reserve evidence is unavailable');
      }
      // The reserve calculation uses exactly the same provider observation.
      const available = Prisma.Decimal.min(new Prisma.Decimal(balance.available!), new Prisma.Decimal(reserve.availableAfterReserve));
      // A confirmation without a timestamp, or after this observation, may
      // not yet be reflected in that balance and must remain reserved.
      const pending = await tx.withdrawalRequest.findMany({ where: { tenantId, accountId, currency, OR: [
        { state: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED'] } },
        { state: 'CONFIRMED', OR: [{ confirmedAt: null }, { confirmedAt: { gte: new Date(observedAt) } }] },
      ] }, select: { requestedAmount: true, approvedAmount: true, submittedAmount: true, confirmedAmount: true, state: true }, take: 201 });
      if (pending.length >= 200) throw new BadRequestException('Too many pending withdrawal requests');
      let reserved = new Prisma.Decimal(0);
      for (const row of pending) {
        if (!isValidDecimal(row.requestedAmount) || !isPositiveDecimal(row.requestedAmount)) throw new ServiceUnavailableException('Pending balance evidence is unavailable');
        let amount = new Prisma.Decimal(row.requestedAmount);
        if (row.state === 'CONFIRMED' && !row.confirmedAmount) throw new ServiceUnavailableException('Confirmed balance evidence is unavailable');
        for (const evidence of [row.approvedAmount, row.submittedAmount, row.confirmedAmount]) {
          if (evidence === null) continue;
          if (!isValidDecimal(evidence) || !isPositiveDecimal(evidence)) throw new ServiceUnavailableException('Pending balance evidence is unavailable');
          amount = Prisma.Decimal.max(amount, new Prisma.Decimal(evidence));
        }
        reserved = reserved.add(amount);
      }
      if (available.sub(reserved).lessThan(new Prisma.Decimal(requestedAmount))) throw new BadRequestException('Available balance is insufficient');
      if (Date.now() - observedAt > 60_000) throw new ServiceUnavailableException('Withdrawal balance evidence is stale');
      if (params.externalReference && await tx.withdrawalRequest.findFirst({ where: { tenantId, externalReference: params.externalReference } })) throw new ConflictException('External reference already used');
      const created = await tx.withdrawalRequest.create({ data: { tenantId, accountId, clientProfileId: current.clientProfileId, state: 'REQUESTED',
        requestedAmount, currency, destinationAddress: address, destinationType: network, externalReference: params.externalReference ?? null,
        requestedBy, idempotencyKey, metadata: { walletId: wallet.id, assetId: wallet.assetId, destinationId: destinations[0].id },
        evidence: { balanceObservedAt: balance.observationTimestamp, balanceSourceDigest: referenceHash, mfaAction: 'PAYOUT_CREATE' } } });
      await outbox.append(tx, { tenantId, aggregateType: 'withdrawal_request', aggregateId: created.id, eventType: 'withdrawal.requested',
        idempotencyKey: `withdrawal-request:${created.id}:requested`, correlationId: correlationId && correlationId.length <= 64 ? correlationId : null,
        occurredAt: created.requestedAt, payload: { withdrawalRequestId: created.id, amount: created.requestedAmount, currency: created.currency, status: created.state } });
      await tx.clientLifecycleAudit.create({ data: { tenantId, accountId, clientProfileId: current.clientProfileId, actorId: requestedBy,
        actorType: 'USER', action: 'WITHDRAWAL_REQUESTED', entityType: 'WITHDRAWAL_REQUEST', entityId: created.id, toState: 'REQUESTED',
        evidence: { currency, network, destinationId: destinations[0].id, balanceObservedAt: balance.observationTimestamp } } });
      return created;
    });
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

    const [data, total] = await this.prisma.withTenantRls(tenantId, (tx) => Promise.all([
      tx.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.withdrawalRequest.count({ where }),
    ]));
    return { data, total, page, limit };
  }
}
