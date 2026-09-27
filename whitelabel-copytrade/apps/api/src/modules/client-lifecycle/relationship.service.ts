import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, AccountRelationshipType, RelationshipStatus } from './client-lifecycle.types';

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
    metadata?: any;
  }): Promise<any> {
    const { tenantId, sourceId, sourceType, targetId, targetType, relationshipType, clientProfileId = null, accountId = null, createdBy = null, source = null, correlationId = null, metadata = {} } = params;

    // No cross-tenant ownership relationship may be created — verify tenant boundaries
    // For each source/target, verify they belong to same tenant if they are tenant-scoped models
    try {
      if (sourceType === 'CLIENT_PROFILE') {
        const src = await (this.prisma as any).clientProfile.findFirst({ where: { id: sourceId, tenantId } });
        if (!src) throw new ForbiddenException('Cross-tenant relationship rejected — source client profile belongs to different tenant');
      }
      if (targetType === 'CLIENT_PROFILE') {
        const tgt = await (this.prisma as any).clientProfile.findFirst({ where: { id: targetId, tenantId } });
        if (!tgt) throw new ForbiddenException('Cross-tenant relationship rejected — target client profile belongs to different tenant');
      }
      if (sourceType === 'INSTITUTIONAL_ACCOUNT') {
        const src = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: sourceId, tenantId } });
        if (!src) throw new ForbiddenException('Cross-tenant relationship rejected — source account belongs to different tenant');
      }
      if (targetType === 'INSTITUTIONAL_ACCOUNT') {
        const tgt = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: targetId, tenantId } });
        if (!tgt) throw new ForbiddenException('Cross-tenant relationship rejected — target account belongs to different tenant');
      }
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `relationship:${relationshipType}`,
      tenantId,
      externalRef: `${sourceId}:${sourceType}:${targetId}:${targetType}:${relationshipType}`,
    });

    try {
      const existing = await (this.prisma as any).accountRelationship.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const relationship = await (this.prisma as any).accountRelationship.create({
      data: {
        tenantId,
        sourceId,
        sourceType,
        targetId,
        targetType,
        relationshipType: relationshipType as any,
        status: 'ACTIVE',
        effectiveAt: new Date(),
        clientProfileId: clientProfileId ?? null,
        accountId: accountId ?? null,
        createdBy: createdBy ?? null,
        source: source ?? null,
        metadata,
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
  }): Promise<any> {
    const { tenantId, relationshipId, revokedBy = null, reason, correlationId = null } = params;

    const relationship = await (this.prisma as any).accountRelationship.findFirst({ where: { id: relationshipId, tenantId } });
    if (!relationship) throw new BadRequestException('Relationship not found');

    const updated = await (this.prisma as any).accountRelationship.update({
      where: { id: relationshipId },
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
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, sourceId, targetId, relationshipType, clientProfileId, accountId, status, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (sourceId) where.sourceId = sourceId;
    if (targetId) where.targetId = targetId;
    if (relationshipType) where.relationshipType = relationshipType;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (status) where.status = status;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).accountRelationship.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).accountRelationship.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
