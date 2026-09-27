import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Resolves tenant-owner, client, trader, follower, managed-account operator, compliance reviewer,
 * security administrator, and platform-admin visibility using existing IAM/RBAC and ownership rules.
 * A client must never be able to view another client's profile, account, funding requests, etc.
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
export class ClientVisibilityService {
  private readonly logger = new Logger(ClientVisibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveVisibleClientProfiles(params: {
    tenantId: string;
    userId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<Array<{ clientProfileId: string }>> {
    const { tenantId, userId, role, isPlatformUser = false } = params;

    // Platform admin can view all profiles in tenant with audit
    if (isPlatformUser && role === ClientVisibilityRole.PLATFORM_ADMIN) {
      try {
        const profiles = await (this.prisma as any).clientProfile.findMany({ where: { tenantId } });
        return profiles.map((p: any) => ({ clientProfileId: p.id }));
      } catch {
        return [];
      }
    }

    // Compliance reviewer and security admin can view all profiles for compliance/security purposes
    if (role === ClientVisibilityRole.COMPLIANCE_REVIEWER || role === ClientVisibilityRole.SECURITY_ADMIN) {
      try {
        const profiles = await (this.prisma as any).clientProfile.findMany({ where: { tenantId } });
        return profiles.map((p: any) => ({ clientProfileId: p.id }));
      } catch {
        return [];
      }
    }

    // Tenant owner can view all profiles in tenant
    if (role === ClientVisibilityRole.TENANT_OWNER) {
      try {
        const profiles = await (this.prisma as any).clientProfile.findMany({ where: { tenantId } });
        return profiles.map((p: any) => ({ clientProfileId: p.id }));
      } catch {
        return [];
      }
    }

    // Client can view own profile only — based on externalIdentityRef or ownership
    if (role === ClientVisibilityRole.CLIENT) {
      try {
        const profiles = await (this.prisma as any).clientProfile.findMany({
          where: { tenantId, OR: [{ externalIdentityRef: userId }, { id: userId }] },
        });
        return profiles.map((p: any) => ({ clientProfileId: p.id }));
      } catch {
        return [];
      }
    }

    // Trader, follower, managed-account operator — view profiles they are related to via relationships
    if ([ClientVisibilityRole.TRADER, ClientVisibilityRole.FOLLOWER, ClientVisibilityRole.MANAGED_ACCOUNT_OPERATOR].includes(role)) {
      try {
        const relationships = await (this.prisma as any).accountRelationship.findMany({
          where: { tenantId, OR: [{ sourceId: userId }, { targetId: userId }], status: 'ACTIVE' },
        });
        const profileIds = new Set<string>();
        for (const rel of relationships) {
          if (rel.clientProfileId) profileIds.add(rel.clientProfileId);
        }
        // Also check ownership
        const ownerships = await (this.prisma as any).accountOwnership.findMany({ where: { tenantId, ownerId: userId, status: 'ACTIVE' } });
        for (const own of ownerships) {
          if (own.clientProfileId) profileIds.add(own.clientProfileId);
        }
        return Array.from(profileIds).map((id) => ({ clientProfileId: id }));
      } catch {
        return [];
      }
    }

    return [];
  }

  async canViewClientProfile(params: {
    tenantId: string;
    userId: string;
    clientProfileId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<boolean> {
    const visible = await this.resolveVisibleClientProfiles({
      tenantId: params.tenantId,
      userId: params.userId,
      role: params.role,
      isPlatformUser: params.isPlatformUser,
    });
    return visible.some((v) => v.clientProfileId === params.clientProfileId);
  }

  async canViewAccount(params: {
    tenantId: string;
    userId: string;
    accountId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<boolean> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      if (!account) return false;

      if (params.isPlatformUser && params.role === ClientVisibilityRole.PLATFORM_ADMIN) return true;
      if (params.role === ClientVisibilityRole.TENANT_OWNER) return true;
      if (params.role === ClientVisibilityRole.COMPLIANCE_REVIEWER || params.role === ClientVisibilityRole.SECURITY_ADMIN) return true;

      // Check if user's client profile owns account
      if (account.clientProfileId) {
        return await this.canViewClientProfile({
          tenantId: params.tenantId,
          userId: params.userId,
          clientProfileId: account.clientProfileId,
          role: params.role,
          isPlatformUser: params.isPlatformUser,
        });
      }

      // Check ownership
      const ownership = await (this.prisma as any).accountOwnership.findFirst({
        where: { tenantId: params.tenantId, accountId: params.accountId, ownerId: params.userId, status: 'ACTIVE' },
      });
      return !!ownership;
    } catch {
      return false;
    }
  }

  async canViewFundingRequest(params: {
    tenantId: string;
    userId: string;
    fundingRequestId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<boolean> {
    try {
      const fr = await (this.prisma as any).fundingRequest.findFirst({ where: { id: params.fundingRequestId, tenantId: params.tenantId } });
      if (!fr) return false;
      return await this.canViewAccount({ tenantId: params.tenantId, userId: params.userId, accountId: fr.accountId, role: params.role, isPlatformUser: params.isPlatformUser });
    } catch {
      return false;
    }
  }

  async enforceClientProfileVisibility(params: {
    tenantId: string;
    userId: string;
    clientProfileId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<void> {
    const canView = await this.canViewClientProfile(params);
    if (!canView) {
      throw new Error(`Access denied: user ${params.userId} cannot view client profile ${params.clientProfileId} as ${params.role}`);
    }
  }

  async enforceAccountVisibility(params: {
    tenantId: string;
    userId: string;
    accountId: string;
    role: ClientVisibilityRole;
    isPlatformUser?: boolean;
  }): Promise<void> {
    const canView = await this.canViewAccount(params);
    if (!canView) {
      throw new Error(`Access denied: user ${params.userId} cannot view account ${params.accountId} as ${params.role}`);
    }
  }
}
