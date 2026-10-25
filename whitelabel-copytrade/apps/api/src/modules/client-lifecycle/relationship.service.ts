// # Responsibility: persist typed tenant relationships only after authoritative boundary/idempotency checks and metadata validation.
import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, RelationshipStatus, AccountRelationshipType as StoredRelationshipType, type AccountRelationship } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, AccountRelationshipType, lifecycleEnum, lifecycleMetadata } from './client-lifecycle.types';

/**
 * Manages client↔trader, client↔follower, client↔strategy, client↔managed-account, and operator
 * relationship records while preserving tenant ownership and authorization constraints.
 */

@Injectable()
export class RelationshipService {
  private readonly logger = new Logger(RelationshipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async createRelationship(params: {
    tenantId: string;
    sourceId: string;
    sourceType: string;
    targetId: string;
    targetType: string;
    relationshipType: AccountRelationshipType;
    clientProfileId?: string | null;
    accountId?: string | null;
    createdBy?: string | null;
    source?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AccountRelationship> {
    const { tenantId, sourceId, sourceType, targetId, targetType, relationshipType, clientProfileId = null, accountId = null, createdBy = null, source = null, correlationId = null, metadata = {} } = params;

    // No cross-tenant ownership relationship may be created — verify tenant boundaries
    // For each source/target, verify they belong to same tenant if they are tenant-scoped models
    try {
      if (sourceType === 'CLIENT_PROFILE') {
        const src = await this.prisma.clientProfile.findFirst({ where: { id: sourceId, tenantId } });
        if (!src) throw new ForbiddenException('Cross-tenant relationship rejected — source client profile belongs to different tenant');
      }
      if (targetType === 'CLIENT_PROFILE') {
        const tgt = await this.prisma.clientProfile.findFirst({ where: { id: targetId, tenantId } });
        if (!tgt) throw new ForbiddenException('Cross-tenant relationship rejected — target client profile belongs to different tenant');
      }
      if (sourceType === 'INSTITUTIONAL_ACCOUNT') {
        const src = await this.prisma.institutionalAccount.findFirst({ where: { id: sourceId, tenantId } });
        if (!src) throw new ForbiddenException('Cross-tenant relationship rejected — source account belongs to different tenant');
      }
      if (targetType === 'INSTITUTIONAL_ACCOUNT') {
        const tgt = await this.prisma.institutionalAccount.findFirst({ where: { id: targetId, tenantId } });
        if (!tgt) throw new ForbiddenException('Cross-tenant relationship rejected — target account belongs to different tenant');
      }
    } catch (e) {
      throw e;
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `relationship:${relationshipType}`,
      tenantId,
      externalRef: `${sourceId}:${sourceType}:${targetId}:${targetType}:${relationshipType}`,
    });

    const existing = await this.prisma.accountRelationship.findFirst({ where: { tenantId: params.tenantId, idempotencyKey } });
    if (existing) return existing;

    const relationship = await this.prisma.accountRelationship.create({
      data: {
        tenantId,
        sourceId,
        sourceType,
        targetId,
        targetType,
        relationshipType: relationshipType,
        status: 'ACTIVE',
        effectiveAt: new Date(),
        clientProfileId: clientProfileId ?? null,
        accountId: accountId ?? null,
        createdBy: createdBy ?? null,
        source: source ?? null,
        metadata: lifecycleMetadata(metadata),
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? null,
      accountId: accountId ?? null,
      action: 'RELATIONSHIP_CREATED',
      entityType: 'ACCOUNT_RELATIONSHIP',
      entityId: relationship.id,
      actorId: createdBy,
      correlationId,
      evidence: { sourceId, sourceType, targetId, targetType, relationshipType },
    });

    this.logger.log({ event: 'client.relationship.created', tenantId, relationshipType, sourceId, targetId });

    return relationship;
  }

  async revokeRelationship(params: {
    tenantId: string;
    relationshipId: string;
    revokedBy?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<AccountRelationship> {
    const { tenantId, relationshipId, revokedBy = null, reason, correlationId = null } = params;

    const relationship = await this.prisma.accountRelationship.findFirst({ where: { id: relationshipId, tenantId } });
    if (!relationship) throw new BadRequestException('Relationship not found');

    const updated = await this.prisma.accountRelationship.update({
      where: { id: relationshipId, tenantId },
      data: { status: 'REVOKED', endedAt: new Date() },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: relationship.clientProfileId,
      accountId: relationship.accountId,
      action: 'RELATIONSHIP_REVOKED',
      entityType: 'ACCOUNT_RELATIONSHIP',
      entityId: relationshipId,
      actorId: revokedBy,
      reason: reason ?? null,
      correlationId,
      evidence: { relationshipId, reason },
    });

    return updated;
  }

  async listRelationships(params: {
    tenantId: string;
    sourceId?: string;
    targetId?: string;
    relationshipType?: string;
    clientProfileId?: string;
    accountId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AccountRelationship[]; total: number; page: number; limit: number }> {
    const { tenantId, sourceId, targetId, relationshipType, clientProfileId, accountId, status, page = 1, limit = 50 } = params;
    const where: Prisma.AccountRelationshipWhereInput = { tenantId };
    if (sourceId) where.sourceId = sourceId;
    if (targetId) where.targetId = targetId;
    if (relationshipType) where.relationshipType = lifecycleEnum(Object.values(StoredRelationshipType), relationshipType, 'relationship type');
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (status) where.status = lifecycleEnum(Object.values(RelationshipStatus), status, 'relationship status');

    const [data, total] = await Promise.all([
      this.prisma.accountRelationship.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountRelationship.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
