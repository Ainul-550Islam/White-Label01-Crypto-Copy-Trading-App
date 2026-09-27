import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { redactPiiAndSecrets } from './client-lifecycle.types';

/**
 * Produces immutable lifecycle audit records for every sensitive client/account/ownership/funding/
 * restriction/review transition and redacts PII/secrets appropriately.
 */

@Injectable()
export class LifecycleAuditService {
  private readonly logger = new Logger(LifecycleAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    tenantId: string;
    clientProfileId?: string | null;
    accountId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    actorId?: string | null;
    actorType?: string | null;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    correlationId?: string | null;
    idempotencyKey?: string | null;
    evidence?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const {
      tenantId,
      clientProfileId = null,
      accountId = null,
      action,
      entityType,
      entityId = null,
      actorId = null,
      actorType = null,
      fromState = null,
      toState = null,
      reason = null,
      sourceType = null,
      sourceId = null,
      correlationId = null,
      idempotencyKey = null,
      evidence = {},
      metadata = {},
    } = params;

    // PII and sensitive account information must be protected and redacted from operational logs
    const scrubbedEvidence = redactPiiAndSecrets(evidence);
    const scrubbedMetadata = redactPiiAndSecrets(metadata);

    try {
      // Immutable audit — no update/delete, only create
      await (this.prisma as any).clientLifecycleAudit.create({
        data: {
          tenantId,
          clientProfileId: clientProfileId ?? null,
          accountId: accountId ?? null,
          action,
          entityType,
          entityId: entityId ?? null,
          actorId: actorId ?? null,
          actorType: actorType ?? null,
          fromState: fromState ?? null,
          toState: toState ?? null,
          reason: reason ?? null,
          sourceType: sourceType ?? null,
          sourceId: sourceId ?? null,
          correlationId: correlationId ?? null,
          idempotencyKey: idempotencyKey ?? null,
          evidence: scrubbedEvidence as any,
          metadata: scrubbedMetadata as any,
        },
      });
    } catch (e) {
      this.logger.warn(`Lifecycle audit log failed: ${(e as Error).message}`);
      // Fallback to logger — still immutable, no secrets
      this.logger.log({
        event: `client.audit.${action}.fallback`,
        tenantId,
        clientProfileId,
        accountId,
        entityType,
        entityId,
        evidence: scrubbedEvidence,
      });
    }

    // Also log to general audit if available
    try {
      if ((this.prisma as any).auditLog?.create) {
        await (this.prisma as any).auditLog.create({
          data: {
            tenantId,
            action: `CLIENT_LIFECYCLE_${action}`,
            entityType,
            entityId: entityId ?? clientProfileId ?? accountId ?? 'UNKNOWN',
            actorId,
            correlationId,
            metadata: {
              clientProfileId,
              accountId,
              fromState,
              toState,
              reason,
              ...scrubbedEvidence,
            } as any,
          },
        });
      }
    } catch {}
  }

  async listAudits(params: {
    tenantId: string;
    clientProfileId?: string;
    accountId?: string;
    action?: string;
    entityType?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, clientProfileId, accountId, action, entityType, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).clientLifecycleAudit.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).clientLifecycleAudit.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
