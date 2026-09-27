import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { INSTITUTIONAL_ACCOUNT_VALID_TRANSITIONS, InstitutionalAccountState } from './client-lifecycle.types';

/**
 * Enforces explicit account lifecycle transitions such as PENDING→ACTIVE→RESTRICTED→SUSPENDED→CLOSED
 * and rejects invalid transitions or unauthorized state changes.
 */

@Injectable()
export class AccountStateService {
  private readonly logger = new Logger(AccountStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async transitionAccount(params: {
    tenantId: string;
    accountId: string;
    toState: InstitutionalAccountState;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, toState, operatorId = null, reason, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found or tenant mismatch');

    const currentState = account.state as InstitutionalAccountState;

    // State-machine validated — do not permit arbitrary client-selected transitions
    const allowed = INSTITUTIONAL_ACCOUNT_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid account transition ${currentState} → ${toState}`);
    }

    // Never trust client-supplied account state — server authoritative
    const updated = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: {
        state: toState as any,
        ...(toState === InstitutionalAccountState.ACTIVE ? { activatedAt: new Date(), isTradingEnabled: true } : {}),
        ...(toState === InstitutionalAccountState.SUSPENDED ? { suspendedAt: new Date(), isTradingEnabled: false } : {}),
        ...(toState === InstitutionalAccountState.CLOSED ? { closedAt: new Date(), isTradingEnabled: false, isFundingEnabled: false, isWithdrawalEnabled: false } : {}),
        ...(toState === InstitutionalAccountState.RESTRICTED ? { isTradingEnabled: false } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'ACCOUNT_STATE_CHANGED',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, reason },
    });

    this.logger.log({ event: 'client.account.state_changed', accountId, from: currentState, to: toState });

    return updated;
  }

  async isAccountActive(params: { tenantId: string; accountId: string }): Promise<boolean> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      return account?.state === 'ACTIVE';
    } catch {
      return false;
    }
  }

  async isAccountRestricted(params: { tenantId: string; accountId: string }): Promise<boolean> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      return account?.state === 'RESTRICTED';
    } catch {
      return false;
    }
  }

  async isAccountSuspended(params: { tenantId: string; accountId: string }): Promise<boolean> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      return account?.state === 'SUSPENDED';
    } catch {
      return false;
    }
  }

  async isAccountClosed(params: { tenantId: string; accountId: string }): Promise<boolean> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      return account?.state === 'CLOSED';
    } catch {
      return false;
    }
  }
}
