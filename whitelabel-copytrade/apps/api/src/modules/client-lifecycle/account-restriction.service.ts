// # Responsibility: persist canonical tenant restrictions and preserve fail-closed trade/withdraw checks.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma, RestrictionStatus, AccountRestrictionType as StoredRestrictionType, type AccountRestriction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, AccountRestrictionType, RestrictionScope, lifecycleEnum } from './client-lifecycle.types';

/**
 * Applies explicit restrictions such as NO_TRADING, NO_WITHDRAWAL, NO_DEPOSIT, REVIEW_REQUIRED,
 * READ_ONLY, or ACCOUNT_LOCKED with reason, source, duration, and audit information.
 * A restriction must be enforceable at the application boundary without silently changing exchange state.
 */

@Injectable()
export class AccountRestrictionService {
  private readonly logger = new Logger(AccountRestrictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async applyRestriction(params: {
    tenantId: string;
    accountId?: string | null;
    clientProfileId?: string | null;
    restrictionType: AccountRestrictionType;
    scope?: RestrictionScope;
    reason: string;
    source: string;
    createdBy?: string | null;
    effectiveAt?: Date;
    expiresAt?: Date | null;
    correlationId?: string | null;
  }): Promise<AccountRestriction> {
    const { tenantId, accountId = null, clientProfileId = null, restrictionType, scope = RestrictionScope.ACCOUNT, reason, source, createdBy = null, effectiveAt = new Date(), expiresAt = null, correlationId = null } = params;

    if (!reason || reason.trim().length < 5) throw new BadRequestException('Restriction reason required (min 5 chars)');

    if (!accountId && !clientProfileId) throw new BadRequestException('Either accountId or clientProfileId required');

    // Verify tenant isolation
    if (accountId) {
      const account = await this.prisma.institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new BadRequestException('Account not found or tenant mismatch');
    }
    if (clientProfileId) {
      const profile = await this.prisma.clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
      if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `restriction:${restrictionType}:${scope}`,
      tenantId,
      accountId: accountId ?? undefined,
      clientProfileId: clientProfileId ?? undefined,
      externalRef: `${restrictionType}:${reason.slice(0, 20)}`,
    });

    const existing = await this.prisma.accountRestriction.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) return existing;

    const restriction = await this.prisma.accountRestriction.create({
      data: {
        tenantId,
        accountId: accountId ?? null,
        clientProfileId: clientProfileId ?? null,
        restrictionType: restrictionType,
        scope: scope,
        status: 'ACTIVE',
        reason,
        source,
        createdBy: createdBy ?? null,
        effectiveAt,
        expiresAt: expiresAt ?? null,
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? null,
      accountId: accountId ?? null,
      action: 'RESTRICTION_APPLIED',
      entityType: 'ACCOUNT_RESTRICTION',
      entityId: restriction.id,
      actorId: createdBy,
      toState: restrictionType,
      reason,
      correlationId,
      evidence: { restrictionType, scope, reason, source, effectiveAt, expiresAt },
    });

    this.logger.log({ event: 'client.restriction.applied', tenantId, restrictionType, accountId, clientProfileId });

    return restriction;
  }

  async revokeRestriction(params: {
    tenantId: string;
    restrictionId: string;
    revokedBy?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<AccountRestriction> {
    const { tenantId, restrictionId, revokedBy = null, reason, correlationId = null } = params;

    const restriction = await this.prisma.accountRestriction.findFirst({ where: { id: restrictionId, tenantId } });
    if (!restriction) throw new BadRequestException('Restriction not found');

    const updated = await this.prisma.accountRestriction.update({
      where: { id: restrictionId, tenantId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: revokedBy ?? null },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: restriction.clientProfileId,
      accountId: restriction.accountId,
      action: 'RESTRICTION_REVOKED',
      entityType: 'ACCOUNT_RESTRICTION',
      entityId: restrictionId,
      actorId: revokedBy,
      fromState: restriction.restrictionType,
      reason: reason ?? null,
      correlationId,
      evidence: { restrictionType: restriction.restrictionType, reason },
    });

    return updated;
  }

  async listRestrictions(params: {
    tenantId: string;
    accountId?: string;
    clientProfileId?: string;
    restrictionType?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AccountRestriction[]; total: number; page: number; limit: number }> {
    const { tenantId, accountId, clientProfileId, restrictionType, status, page = 1, limit = 50 } = params;
    const where: Prisma.AccountRestrictionWhereInput = { tenantId };
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (restrictionType) where.restrictionType = lifecycleEnum(Object.values(StoredRestrictionType), restrictionType, 'restrictionType');
    if (status) where.status = lifecycleEnum(Object.values(RestrictionStatus), status, 'restriction status');
    else where.status = 'ACTIVE';

    const [data, total] = await Promise.all([
      this.prisma.accountRestriction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountRestriction.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async hasRestriction(params: { tenantId: string; accountId: string; restrictionType: AccountRestrictionType }, transaction?: Prisma.TransactionClient): Promise<boolean> {
    const read = (tx: Prisma.TransactionClient) => tx.accountRestriction.findFirst({
      where: { tenantId: params.tenantId, accountId: params.accountId, restrictionType: params.restrictionType, status: 'ACTIVE' },
    });
    // A missing tenant context under forced RLS must never look like an
    // unrestricted account. Read on the caller's transaction when available.
    const restriction = transaction ? await read(transaction) : await this.prisma.withTenantRls(params.tenantId, read);
    return !!restriction;
  }

  async canTrade(params: { tenantId: string; accountId: string }): Promise<{ allowed: boolean; blockingRestrictions: string[] }> {
    const blockingTypes = [AccountRestrictionType.NO_TRADING, AccountRestrictionType.ACCOUNT_LOCKED, AccountRestrictionType.COMPLIANCE_HOLD, AccountRestrictionType.SECURITY_HOLD, AccountRestrictionType.RISK_HOLD, AccountRestrictionType.OPERATIONAL_HOLD, AccountRestrictionType.READ_ONLY];
    try {
      const restrictions = await this.prisma.accountRestriction.findMany({
        where: { tenantId: params.tenantId, accountId: params.accountId, status: 'ACTIVE', restrictionType: { in: blockingTypes } },
      });
      const blocking = restrictions.map((r) => r.restrictionType);
      return { allowed: blocking.length === 0, blockingRestrictions: blocking };
    } catch {
      return { allowed: false, blockingRestrictions: ['CHECK_FAILED'] };
    }
  }

  async canWithdraw(params: { tenantId: string; accountId: string }): Promise<{ allowed: boolean; blockingRestrictions: string[] }> {
    const blockingTypes = [AccountRestrictionType.NO_WITHDRAWAL, AccountRestrictionType.ACCOUNT_LOCKED, AccountRestrictionType.COMPLIANCE_HOLD, AccountRestrictionType.SECURITY_HOLD, AccountRestrictionType.OPERATIONAL_HOLD];
    try {
      const restrictions = await this.prisma.accountRestriction.findMany({
        where: { tenantId: params.tenantId, accountId: params.accountId, status: 'ACTIVE', restrictionType: { in: blockingTypes } },
      });
      const blocking = restrictions.map((r) => r.restrictionType);
      return { allowed: blocking.length === 0, blockingRestrictions: blocking };
    } catch {
      return { allowed: false, blockingRestrictions: ['CHECK_FAILED'] };
    }
  }
}
