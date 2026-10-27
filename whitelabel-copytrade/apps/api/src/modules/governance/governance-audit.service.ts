// # Responsibility: persist/read tenant-bound native governance audits without process-memory fallback; recursively sanitize evidence and propagate required durability/serialization failures.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { type GovernanceAudit, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { type GovernanceAuditEvent, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import type { AuditExportFilters } from './governance-audit-export.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class GovernanceAuditService {
  private readonly logger = new Logger(GovernanceAuditService.name);
  constructor(private readonly policyService: GovernancePolicyService, private readonly prisma: PrismaService) {}

  async recordEvent(params: {
    tenantId: string; actionType: GovernanceActionType; subjectUserId?: string | null; requestId?: string | null;
    reportId?: string | null; evidencePackageId?: string | null; legalHoldId?: string | null; retentionCandidateId?: string | null;
    consentId?: string | null; state: string; result: string; reason?: string | null; correlationId: string;
    createdBy: string; safeEvidence?: Record<string, unknown>;
  }, transaction?: Prisma.TransactionClient): Promise<GovernanceAuditEvent> {
    if (!params.tenantId || !params.actionType || !params.correlationId || !params.createdBy) throw new BadRequestException('tenantId, actionType, correlationId, createdBy required');
    const safeEvidence = this.evidenceObject(params.safeEvidence ?? {}, new WeakSet());
    const create = (tx: Prisma.TransactionClient) => tx.governanceAudit.create({ data: { id: randomUUID(), tenantId: params.tenantId, actionType: params.actionType,
      subjectUserId: params.subjectUserId ?? null, requestId: params.requestId ?? null, reportId: params.reportId ?? null,
      evidencePackageId: params.evidencePackageId ?? null, legalHoldId: params.legalHoldId ?? null, retentionCandidateId: params.retentionCandidateId ?? null,
      consentId: params.consentId ?? null, state: params.state, result: params.result, reason: params.reason ?? null,
      correlationId: params.correlationId, createdBy: params.createdBy, createdAt: new Date(), safeEvidence } });
    const row = transaction ? await create(transaction) : await this.prisma.withTenantRls(params.tenantId, create);
    this.policyService.assertTenantIsolation(params.tenantId, row.tenantId);
    const event = this.mapRow(row);
    this.logger.log(`audit tenant=${params.tenantId} action=${params.actionType} state=${params.state} corr=${params.correlationId}`);
    return event;
  }

  async listEvents(tenantId: string, filters?: AuditExportFilters & { correlationId?: string; periodStart?: string; periodEnd?: string; take?: number }, transaction?: Prisma.TransactionClient): Promise<GovernanceAuditEvent[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    if (filters?.take !== undefined && (!Number.isSafeInteger(filters.take) || filters.take < 1)) throw new BadRequestException('Positive integer audit take required');
    const where: Prisma.GovernanceAuditWhereInput = { tenantId };
    if (filters?.actionType) where.actionType = filters.actionType;
    if (filters?.correlationId) where.correlationId = filters.correlationId;
    if (filters?.subjectUserId) where.subjectUserId = filters.subjectUserId;
    if (filters?.actorId) where.createdBy = filters.actorId;
    if (filters?.outcome) where.result = filters.outcome;
    if (filters?.periodStart || filters?.periodEnd) where.createdAt = { ...(filters.periodStart ? { gte: new Date(filters.periodStart) } : {}), ...(filters.periodEnd ? { lt: new Date(filters.periodEnd) } : {}) };
    const fields = { REQUEST: 'requestId', REPORT: 'reportId', EVIDENCE_PACKAGE: 'evidencePackageId', LEGAL_HOLD: 'legalHoldId', RETENTION_CANDIDATE: 'retentionCandidateId', CONSENT: 'consentId' } as const;
    if (filters?.entityType) where[fields[filters.entityType]] = filters.entityId ?? { not: null };
    const find = (tx: Prisma.TransactionClient) => tx.governanceAudit.findMany({ where, ...(filters?.take !== undefined ? { take: filters.take } : {}), orderBy: filters?.periodStart ? [{ createdAt: 'asc' }, { id: 'asc' }] : { createdAt: 'desc' } });
    const rows = transaction ? await find(transaction) : await this.prisma.withTenantRls(tenantId, find);
    return rows.map((row) => { this.policyService.assertTenantIsolation(tenantId, row.tenantId); return this.mapRow(row); });
  }

  private mapRow(row: GovernanceAudit): GovernanceAuditEvent {
    const actionType = Object.values(GovernanceActionType).find((action) => action === row.actionType);
    if (!actionType || !record(row.safeEvidence)) throw new Error('Malformed persisted governance audit action/evidence');
    return { ...row, actionType, createdAt: row.createdAt.toISOString(), safeEvidence: this.evidenceObject(row.safeEvidence, new WeakSet()) };
  }

  private evidenceObject(value: Record<string, unknown>, seen: WeakSet<object>): Prisma.InputJsonObject {
    if (seen.has(value)) throw new BadRequestException('Circular audit evidence cannot be persisted');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new BadRequestException('Plain JSON audit evidence required');
    seen.add(value);
    const output: { [key: string]: Prisma.InputJsonValue | null } = {};
    const sanitized = this.policyService.sanitizeLogEvidence(value);
    for (const [key, item] of Object.entries(sanitized)) {
      if (item === undefined) continue;
      // Define own properties so a supplied __proto__ key cannot mutate a serializer's prototype.
      Object.defineProperty(output, key, { value: this.evidenceValue(item, seen), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(value);
    return output;
  }

  private evidenceValue(value: unknown, seen: WeakSet<object>): Prisma.InputJsonValue | null {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new BadRequestException('Circular audit evidence cannot be persisted');
      seen.add(value); const entries: unknown[] = value;
      const result = entries.map((entry) => this.evidenceValue(entry, seen)); seen.delete(value); return result;
    }
    if (record(value)) return this.evidenceObject(value, seen);
    throw new BadRequestException('Audit evidence must contain serializable finite JSON values');
  }
}
