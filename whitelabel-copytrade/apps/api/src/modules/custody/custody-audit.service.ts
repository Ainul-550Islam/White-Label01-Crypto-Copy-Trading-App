import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditAction, redactSecrets } from './custody.types';

/**
 * Creates immutable audit entries for custody operations, settlement events, reconciliation diagnostics,
 * and privileged actions. Secrets and PII must be redacted and access must be audited.
 */

@Injectable()
export class CustodyAuditService {
  private readonly logger = new Logger(CustodyAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    tenantId: string;
    walletId?: string | null;
    action: CustodyAuditAction;
    entityType: string;
    entityId: string;
    actorId?: string | null;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    correlationId?: string | null;
    evidence?: any;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, walletId = null, action, entityType, entityId, actorId = null, fromState = null, toState = null, reason = null, correlationId = null, evidence = {}, metadata = {} } = params;

    // Privileged actions must be audited — secrets and PII must be redacted
    const redactedEvidence = redactSecrets(evidence);
    const redactedMetadata = redactSecrets(metadata);

    try {
      const audit = await (this.prisma as any).custodyAudit.create({
        data: {
          tenantId,
          walletId: walletId ?? null,
          action: action as any,
          entityType,
          entityId,
          actorId: actorId ?? null,
          fromState: fromState ?? null,
          toState: toState ?? null,
          reason: reason ?? null,
          correlationId: correlationId ?? null,
          evidence: redactedEvidence as any,
          metadata: redactedMetadata as any,
        },
      });

      this.logger.log({ event: 'custody.audit.logged', tenantId, action, entityType, entityId, actorId });

      return audit;
    } catch (e) {
      this.logger.warn(`Failed to create custody audit: ${(e as Error).message}`);
      return null;
    }
  }

  async listAudits(params: {
    tenantId: string;
    walletId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    actorId?: string;
    fromDate?: Date;
    toDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, entityType, entityId, action, actorId, fromDate, toDate, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (walletId) where.walletId = walletId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyAudit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyAudit.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async exportAudits(params: {
    tenantId: string;
    fromDate: Date;
    toDate: Date;
    format?: 'json' | 'csv';
  }): Promise<{ exportedAt: string; count: number; format: string; data: any[] }> {
    const { tenantId, fromDate, toDate, format = 'json' } = params;

    // Deterministic export — same inputs produce identical output
    const where: any = { tenantId, createdAt: { gte: fromDate, lte: toDate } };

    let data: any[] = [];
    try {
      data = await (this.prisma as any).custodyAudit.findMany({ where, orderBy: { createdAt: 'asc' }, take: 10000 });
    } catch {
      data = [];
    }

    // Ensure deterministic ordering and redaction
    const sorted = data.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return {
      exportedAt: new Date().toISOString(),
      count: sorted.length,
      format,
      data: sorted.map((audit: any) => ({
        id: audit.id,
        tenantId: audit.tenantId,
        walletId: audit.walletId,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        actorId: audit.actorId,
        fromState: audit.fromState,
        toState: audit.toState,
        reason: audit.reason,
        correlationId: audit.correlationId,
        evidence: redactSecrets(audit.evidence),
        createdAt: audit.createdAt,
      })),
    };
  }
}
