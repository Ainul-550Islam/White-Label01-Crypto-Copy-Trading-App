import { Injectable, Logger } from '@nestjs/common';
import { PartnerAuditAction, PartnerAuditEvent } from './partner.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerAuditService {
  private readonly logger = new Logger(PartnerAuditService.name);
  private readonly inMemory: PartnerAuditEvent[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(params: {
    partnerId: string;
    tenantId?: string | null;
    actorId: string;
    actorRole?: string | null;
    action: PartnerAuditAction;
    source: string;
    correlationId: string;
    agreementVersion?: string | null;
    policyVersion?: string | null;
    safeEvidence?: Record<string, unknown>;
  }): Promise<PartnerAuditEvent> {
    const redacted = this.redactEvidence(params.safeEvidence ?? {});

    const event: PartnerAuditEvent = {
      id: `paud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      tenantId: params.tenantId ?? null,
      actorId: params.actorId,
      actorRole: params.actorRole ?? null,
      action: params.action,
      source: params.source,
      correlationId: params.correlationId,
      agreementVersion: params.agreementVersion ?? null,
      policyVersion: params.policyVersion ?? null,
      timestamp: new Date().toISOString(),
      safeEvidence: redacted,
      createdAt: new Date().toISOString(),
    };

    this.inMemory.push(event);
    if (this.inMemory.length > 5000) this.inMemory.splice(0, 1000);

    try {
      await (this.prisma as any).partnerAudit?.create?.({
        data: {
          id: event.id,
          partnerId: event.partnerId,
          tenantId: event.tenantId,
          actorId: event.actorId,
          actorRole: event.actorRole,
          action: event.action,
          source: event.source,
          correlationId: event.correlationId,
          agreementVersion: event.agreementVersion,
          policyVersion: event.policyVersion,
          timestamp: new Date(event.timestamp),
          safeEvidence: redacted as any,
          createdAt: new Date(event.createdAt),
        },
      });
    } catch {
      this.logger.debug(`partner audit persist skipped id=${event.id}`);
    }

    this.logger.log(`audit partner=${params.partnerId} action=${params.action} corr=${params.correlationId}`);
    return event;
  }

  private redactEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
    const sensitive = ['password', 'secret', 'privateKey', 'apiKey', 'token', 'card', 'cvv', 'ssn', 'email', 'phone', 'address', 'government_id', 'kyc_doc', 'credential', 'signingSecret', 'private_key', 'jwt', 'bearer', 'iban', 'accountNumber'];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(evidence)) {
      const lower = k.toLowerCase();
      const isSensitive = sensitive.some(s => lower.includes(s.toLowerCase()));
      if (isSensitive) out[k] = '***REDACTED***';
      else if (typeof v === 'string' && v.length > 500) out[k] = v.slice(0, 500) + '...TRUNCATED';
      else out[k] = v;
    }
    return out;
  }

  async listEvents(partnerId: string, filters?: { tenantId?: string; action?: PartnerAuditAction; correlationId?: string; take?: number }): Promise<PartnerAuditEvent[]> {
    let list = this.inMemory.filter(e => e.partnerId === partnerId);
    if (filters?.tenantId) list = list.filter(e => e.tenantId === filters.tenantId);
    if (filters?.action) list = list.filter(e => e.action === filters.action);
    if (filters?.correlationId) list = list.filter(e => e.correlationId === filters.correlationId);
    list = list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (filters?.take) list = list.slice(0, filters.take);

    try {
      const where: any = { partnerId };
      if (filters?.tenantId) where.tenantId = filters.tenantId;
      if (filters?.action) where.action = filters.action;
      if (filters?.correlationId) where.correlationId = filters.correlationId;
      const rows = await (this.prisma as any).partnerAudit?.findMany?.({ where, take: filters?.take ?? 200, orderBy: { timestamp: 'desc' } });
      if (rows && rows.length > 0) {
        list = rows.map((r: any) => ({
          id: r.id,
          partnerId: r.partnerId,
          tenantId: r.tenantId ?? null,
          actorId: r.actorId,
          actorRole: r.actorRole ?? null,
          action: r.action,
          source: r.source,
          correlationId: r.correlationId,
          agreementVersion: r.agreementVersion ?? null,
          policyVersion: r.policyVersion ?? null,
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
          safeEvidence: r.safeEvidence ?? {},
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        }));
      }
    } catch { /* fallback */ }
    return list;
  }
}
