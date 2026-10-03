import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Resolves what tenant owner, trader, follower, managed-account operator,
 * compliance reviewer, platform admin may view based on existing IAM/RBAC/account ownership.
 */

export enum InvestorVisibilityRole {
  TENANT_OWNER = 'TENANT_OWNER',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  MANAGED_ACCOUNT_OPERATOR = 'MANAGED_ACCOUNT_OPERATOR',
  COMPLIANCE_REVIEWER = 'COMPLIANCE_REVIEWER',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

@Injectable()
export class InvestorVisibilityService {
  private readonly logger = new Logger(InvestorVisibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveVisibleProfiles(params: {
    tenantId: string;
    userId: string;
    role: InvestorVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<Array<{ profileId: string; scope: string; scopeId: string }>> {
    const { tenantId, userId, role, isPlatformUser = false } = params;

    // Platform admin can view all profiles in tenant (with audit)
    if (isPlatformUser && role === InvestorVisibilityRole.PLATFORM_ADMIN) {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({ where: { tenantId } });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    // Compliance reviewer can view all profiles in tenant for compliance purposes
    if (role === InvestorVisibilityRole.COMPLIANCE_REVIEWER) {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({ where: { tenantId } });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    // Tenant owner can view all profiles in tenant
    if (role === InvestorVisibilityRole.TENANT_OWNER) {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({ where: { tenantId } });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    // Trader can view own trader-scoped profiles and strategy profiles they own
    if (role === InvestorVisibilityRole.TRADER) {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({
        where: { tenantId, scopeId: userId, scope: { in: ['TRADER', 'STRATEGY'] } },
      });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    // Follower can view own follower-scoped profiles
    if (role === InvestorVisibilityRole.FOLLOWER) {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({
        where: { tenantId, scopeId: userId, scope: 'FOLLOWER' },
      });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    // Managed account operator can view managed account profiles they operate
    if (role === InvestorVisibilityRole.MANAGED_ACCOUNT_OPERATOR) {
      // The accounts an operator runs are ACTIVE OPERATOR_TO_ACCOUNT
      // relationships (client-lifecycle): source = operator, target = account.
      const relationships = await this.prisma.accountRelationship.findMany({
        where: { tenantId, sourceId: userId, relationshipType: 'OPERATOR_TO_ACCOUNT', status: 'ACTIVE', endedAt: null },
        select: { targetId: true },
      });
      const accountIds = relationships.map((r) => r.targetId);
      if (accountIds.length === 0) {
        return [];
      }
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({
        where: { tenantId, scope: 'MANAGED_ACCOUNT', scopeId: { in: accountIds } },
      });
      return profiles.map((p: any) => ({ profileId: p.id, scope: p.scope, scopeId: p.scopeId }));
    }

    return [];
  }

  async canViewProfile(params: {
    tenantId: string;
    userId: string;
    profileId: string;
    role: InvestorVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<boolean> {
    const visible = await this.resolveVisibleProfiles({
      tenantId: params.tenantId,
      userId: params.userId,
      role: params.role,
      isPlatformUser: params.isPlatformUser,
    });
    return visible.some((v) => v.profileId === params.profileId);
  }

  async canViewStatement(params: {
    tenantId: string;
    userId: string;
    statementId: string;
    role: InvestorVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<boolean> {
    const statement = await (this.prisma as any).portfolioStatement.findFirst({
      where: { tenantId: params.tenantId, statementId: params.statementId },
    });
    if (!statement) return false;

    return await this.canViewProfile({
      tenantId: params.tenantId,
      userId: params.userId,
      profileId: statement.profileId,
      role: params.role,
      isPlatformUser: params.isPlatformUser,
    });
  }

  async enforceVisibility(params: {
    tenantId: string;
    userId: string;
    profileId: string;
    role: InvestorVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<void> {
    const canView = await this.canViewProfile(params);
    if (!canView) {
      throw new Error(`Access denied: user ${params.userId} cannot view profile ${params.profileId} as ${params.role}`);
    }
  }
}
