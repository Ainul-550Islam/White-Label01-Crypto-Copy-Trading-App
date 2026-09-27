import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountOwnershipService } from './account-ownership.service';

/**
 * Resolves what a client, trader, follower, operator, compliance reviewer, or platform administrator
 * may perform on an account using existing IAM/RBAC and lifecycle restrictions.
 */

export enum ClientVisibilityRole {
  CLIENT = 'CLIENT',
  TENANT_OWNER = 'TENANT_OWNER',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  MANAGED_ACCOUNT_OPERATOR = 'MANAGED_ACCOUNT_OPERATOR',
  COMPLIANCE_REVIEWER = 'COMPLIANCE_REVIEWER',
  SECURITY_ADMIN = 'SECURITY_ADMIN',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

@Injectable()
export class AccountPermissionService {
  private readonly logger = new Logger(AccountPermissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: AccountOwnershipService,
  ) {}

  async canPerformAction(params: {
    tenantId: string;
    accountId: string;
    userId: string;
    role: ClientVisibilityRole;
    action: string;
    isPlatformUser?: boolean;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { tenantId, accountId, userId, role, action, isPlatformUser = false } = params;

    // Platform admin can perform all actions with audit
    if (isPlatformUser && role === ClientVisibilityRole.PLATFORM_ADMIN) {
      return { allowed: true };
    }

    // Compliance reviewer can perform review actions
    if (role === ClientVisibilityRole.COMPLIANCE_REVIEWER) {
      const allowedActions = ['REVIEW', 'VIEW', 'RESTRICT', 'COMPLIANCE_HOLD'];
      if (allowedActions.includes(action)) return { allowed: true };
      return { allowed: false, reason: `Compliance reviewer cannot perform ${action}` };
    }

    // Security admin can perform security-related actions
    if (role === ClientVisibilityRole.SECURITY_ADMIN) {
      const allowedActions = ['VIEW', 'SECURITY_HOLD', 'REVIEW', 'RESTRICT'];
      if (allowedActions.includes(action)) return { allowed: true };
      return { allowed: false, reason: `Security admin cannot perform ${action}` };
    }

    // Tenant owner can perform all actions within tenant
    if (role === ClientVisibilityRole.TENANT_OWNER) {
      try {
        const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
        if (!account) return { allowed: false, reason: 'Account not found or tenant mismatch' };
        return { allowed: true };
      } catch {
        return { allowed: false, reason: 'Failed to verify tenant ownership' };
      }
    }

    // For client/trader/follower/operator, verify ownership
    try {
      const isOwner = await this.ownershipService.verifyOwnership({ tenantId, accountId, ownerId: userId });
      if (!isOwner) {
        // Also check if user is client profile owner
        const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
        if (account?.clientProfileId) {
          const profile = await (this.prisma as any).clientProfile.findFirst({ where: { id: account.clientProfileId, tenantId } });
          if (profile && profile.externalIdentityRef === userId) {
            // Client owns profile, allow limited actions
            const clientAllowedActions = ['VIEW', 'REQUEST_FUNDING', 'REQUEST_WITHDRAWAL', 'VIEW_OWN_FUNDING'];
            if (clientAllowedActions.includes(action)) return { allowed: true };
            return { allowed: false, reason: `Client cannot perform privileged action ${action}` };
          }
        }
        return { allowed: false, reason: 'User does not own account' };
      }

      // Owner can perform most actions except privileged platform actions
      const privilegedActions = ['APPROVE_ONBOARDING', 'ACTIVATE_LIVE', 'BYPASS_COMPLIANCE', 'BYPASS_RISK', 'BYPASS_SECURITY'];
      if (privilegedActions.includes(action)) {
        return { allowed: false, reason: `Owner cannot self-approve privileged action ${action}` };
      }

      return { allowed: true };
    } catch (e) {
      return { allowed: false, reason: `Permission check failed: ${(e as Error).message}` };
    }
  }

  async enforcePermission(params: {
    tenantId: string;
    accountId: string;
    userId: string;
    role: ClientVisibilityRole;
    action: string;
    isPlatformUser?: boolean;
  }): Promise<void> {
    const result = await this.canPerformAction(params);
    if (!result.allowed) {
      throw new Error(`Permission denied: ${result.reason ?? 'not allowed'}`);
    }
  }

  async listPermissionsForRole(role: ClientVisibilityRole): Promise<string[]> {
    switch (role) {
      case ClientVisibilityRole.PLATFORM_ADMIN:
        return ['*'];
      case ClientVisibilityRole.TENANT_OWNER:
        return ['VIEW', 'CREATE', 'UPDATE', 'RESTRICT', 'SUSPEND', 'CLOSE', 'REVIEW', 'FUNDING', 'WITHDRAWAL', 'OWNERSHIP'];
      case ClientVisibilityRole.COMPLIANCE_REVIEWER:
        return ['VIEW', 'REVIEW', 'RESTRICT', 'COMPLIANCE_HOLD'];
      case ClientVisibilityRole.SECURITY_ADMIN:
        return ['VIEW', 'REVIEW', 'RESTRICT', 'SECURITY_HOLD'];
      case ClientVisibilityRole.CLIENT:
        return ['VIEW', 'REQUEST_FUNDING', 'REQUEST_WITHDRAWAL', 'VIEW_OWN_FUNDING'];
      case ClientVisibilityRole.TRADER:
        return ['VIEW', 'TRADE', 'VIEW_OWN_ACCOUNT'];
      case ClientVisibilityRole.FOLLOWER:
        return ['VIEW', 'FOLLOW', 'VIEW_OWN_ACCOUNT'];
      case ClientVisibilityRole.MANAGED_ACCOUNT_OPERATOR:
        return ['VIEW', 'OPERATE', 'VIEW_OWN_ACCOUNT'];
      default:
        return ['VIEW'];
    }
  }
}
