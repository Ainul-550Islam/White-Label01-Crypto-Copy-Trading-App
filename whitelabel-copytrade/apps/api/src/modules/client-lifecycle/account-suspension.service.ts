import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountStateService } from './account-state.service';
import { AccountRestrictionService } from './account-restriction.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { AccountRestrictionType, RestrictionScope, InstitutionalAccountState } from './client-lifecycle.types';

/**
 * Handles controlled account suspension and restoration using explicit authorization, reason codes,
 * effective timestamps, affected capabilities, and verification. Must not silently mutate exchange state.
 */

@Injectable()
export class AccountSuspensionService {
  private readonly logger = new Logger(AccountSuspensionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountStateService: AccountStateService,
    private readonly restrictionService: AccountRestrictionService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async suspendAccount(params: {
    tenantId: string;
    accountId: string;
    reason: string;
    reasonCode?: string;
    source: string;
    operatorId: string;
    effectiveAt?: Date;
    affectedCapabilities?: string[];
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, reason, reasonCode = 'MANUAL', source, operatorId, effectiveAt = new Date(), affectedCapabilities = ['TRADING', 'WITHDRAWAL'], correlationId = null } = params;

    if (!reason || reason.trim().length < 5) throw new BadRequestException('Suspension reason required');

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found');

    // Must not silently mutate exchange state — only administrative state
    // Apply restriction first
    await this.restrictionService.applyRestriction({
      tenantId,
      accountId,
      restrictionType: AccountRestrictionType.ACCOUNT_LOCKED as any,
      scope: RestrictionScope.ACCOUNT as any,
      reason: `SUSPENSION: ${reason} [${reasonCode}]`,
      source,
      createdBy: operatorId,
      effectiveAt,
      correlationId,
    });

    // Transition account state to SUSPENDED
    const suspended = await this.accountStateService.transitionAccount({
      tenantId,
      accountId,
      toState: InstitutionalAccountState.SUSPENDED as any,
      operatorId,
      reason,
      correlationId,
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'ACCOUNT_SUSPENDED',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      fromState: account.state,
      toState: 'SUSPENDED',
      reason,
      correlationId,
      evidence: { reasonCode, source, affectedCapabilities, effectiveAt },
    });

    this.logger.log({ event: 'client.account.suspended', tenantId, accountId, reasonCode, source });

    return suspended;
  }

  async restoreAccount(params: {
    tenantId: string;
    accountId: string;
    reason: string;
    operatorId: string;
    verificationEvidence?: any;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, reason, operatorId, verificationEvidence = {}, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found');

    if (account.state !== 'SUSPENDED') {
      throw new BadRequestException(`Account must be SUSPENDED to restore, current: ${account.state}`);
    }

    // Verify suspension can be lifted — check compliance, risk, security holds
    const activeRestrictions = await (this.prisma as any).accountRestriction.findMany({
      where: { tenantId, accountId, status: 'ACTIVE', restrictionType: { in: ['COMPLIANCE_HOLD', 'SECURITY_HOLD', 'RISK_HOLD', 'OPERATIONAL_HOLD'] } },
    });

    if (activeRestrictions.length > 0) {
      throw new BadRequestException(`Cannot restore — active holds: ${activeRestrictions.map((r: any) => r.restrictionType).join(',')}`);
    }

    // Revoke ACCOUNT_LOCKED restriction
    const lockedRestrictions = await (this.prisma as any).accountRestriction.findMany({
      where: { tenantId, accountId, status: 'ACTIVE', restrictionType: 'ACCOUNT_LOCKED' },
    });

    for (const restriction of lockedRestrictions) {
      await this.restrictionService.revokeRestriction({
        tenantId,
        restrictionId: restriction.id,
        revokedBy: operatorId,
        reason: `Restoration: ${reason}`,
        correlationId,
      });
    }

    const restored = await this.accountStateService.transitionAccount({
      tenantId,
      accountId,
      toState: InstitutionalAccountState.ACTIVE as any,
      operatorId,
      reason,
      correlationId,
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'ACCOUNT_RESTORED',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      fromState: 'SUSPENDED',
      toState: 'ACTIVE',
      reason,
      correlationId,
      evidence: { reason, verificationEvidence },
    });

    this.logger.log({ event: 'client.account.restored', tenantId, accountId, reason });

    return restored;
  }
}
