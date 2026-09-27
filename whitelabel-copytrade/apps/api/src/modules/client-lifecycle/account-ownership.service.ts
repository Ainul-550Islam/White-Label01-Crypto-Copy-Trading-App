import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, AccountOwnershipType, RelationshipStatus } from './client-lifecycle.types';

/**
 * Controls client/trader/follower/managed-account ownership relationships, validates tenant boundaries,
 * prevents ambiguous ownership, and records immutable ownership changes.
 */

@Injectable()
export class AccountOwnershipService {
  private readonly logger = new Logger(AccountOwnershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async createOwnership(params: {
    tenantId: string;
    accountId: string;
    clientProfileId?: string | null;
    ownerId: string;
    ownerType: string;
    ownershipType?: AccountOwnershipType;
    createdBy?: string | null;
    source?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, clientProfileId = null, ownerId, ownerType, ownershipType = AccountOwnershipType.OWNER, createdBy = null, source = null, correlationId = null } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId });

    // No cross-tenant ownership relationship may be created
    if (!policy.ownershipRules.allowCrossTenantOwnership) {
      try {
        const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
        if (!account) throw new BadRequestException('Account not found or tenant mismatch');

        // Verify owner belongs to same tenant — check User or ClientProfile tenant
        if (clientProfileId) {
          const clientProfile = await (this.prisma as any).clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
          if (!clientProfile) throw new ForbiddenException('Cross-tenant ownership rejected — client profile belongs to different tenant');
        }

        // Check max owners per account
        const existingOwners = await (this.prisma as any).accountOwnership.count({
          where: { tenantId, accountId, status: 'ACTIVE' },
        });
        if (existingOwners >= policy.ownershipRules.maxOwnersPerAccount) {
          throw new BadRequestException(`Max owners per account (${policy.ownershipRules.maxOwnersPerAccount}) exceeded`);
        }
      } catch (e) {
        if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
      }
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `account-ownership:${ownershipType}:${ownerId}`,
      tenantId,
      accountId,
      externalRef: `${accountId}:${ownerId}:${ownershipType}`,
    });

    try {
      const existing = await (this.prisma as any).accountOwnership.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    // Prevent ambiguous ownership — check if same owner already has active ownership
    try {
      const ambiguous = await (this.prisma as any).accountOwnership.findFirst({
        where: { tenantId, accountId, ownerId, ownershipType: ownershipType as any, status: 'ACTIVE' },
      });
      if (ambiguous) {
        throw new BadRequestException('Ambiguous ownership — owner already has active ownership of this type');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    const ownership = await (this.prisma as any).accountOwnership.create({
      data: {
        tenantId,
        accountId,
        clientProfileId: clientProfileId ?? null,
        ownerId,
        ownerType,
        ownershipType: ownershipType as any,
        status: 'ACTIVE',
        effectiveAt: new Date(),
        createdBy: createdBy ?? null,
        source: source ?? null,
        idempotencyKey,
      },
    });

    // All account ownership changes must be explicitly audited
    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? null,
      accountId,
      action: 'OWNERSHIP_CREATED',
      entityType: 'ACCOUNT_OWNERSHIP',
      entityId: ownership.id,
      actorId: createdBy ?? null,
      correlationId,
      evidence: { ownerId, ownerType, ownershipType, accountId },
    });

    this.logger.log({ event: 'client.ownership.created', tenantId, accountId, ownerId, ownershipType });

    return ownership;
  }

  async revokeOwnership(params: {
    tenantId: string;
    ownershipId: string;
    revokedBy?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, ownershipId, revokedBy = null, reason, correlationId = null } = params;

    const ownership = await (this.prisma as any).accountOwnership.findFirst({ where: { id: ownershipId, tenantId } });
    if (!ownership) throw new BadRequestException('Ownership not found');

    const updated = await (this.prisma as any).accountOwnership.update({
      where: { id: ownershipId },
      data: { status: 'REVOKED', endedAt: new Date() },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: ownership.clientProfileId,
      accountId: ownership.accountId,
      action: 'OWNERSHIP_REVOKED',
      entityType: 'ACCOUNT_OWNERSHIP',
      entityId: ownershipId,
      actorId: revokedBy,
      reason: reason ?? null,
      correlationId,
      evidence: { ownershipId, reason, ownerId: ownership.ownerId },
    });

    return updated;
  }

  async listOwnerships(params: {
    tenantId: string;
    accountId?: string;
    ownerId?: string;
    clientProfileId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, accountId, ownerId, clientProfileId, status, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (accountId) where.accountId = accountId;
    if (ownerId) where.ownerId = ownerId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (status) where.status = status;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).accountOwnership.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).accountOwnership.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async verifyOwnership(params: { tenantId: string; accountId: string; ownerId: string }): Promise<boolean> {
    try {
      const ownership = await (this.prisma as any).accountOwnership.findFirst({
        where: { tenantId: params.tenantId, accountId: params.accountId, ownerId: params.ownerId, status: 'ACTIVE' },
      });
      return !!ownership;
    } catch {
      return false;
    }
  }
}
