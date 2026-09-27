import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationalAuditService } from './operational-audit.service';
import { IncidentDeduplicationService } from './incident-deduplication.service';
import {
  OperationalIncidentState,
  OperationalIncidentSeverity,
  INCIDENT_VALID_TRANSITIONS,
  isValidTransition,
  deterministicIdempotencyKey,
  redactSecrets,
} from './operations.types';
import { randomUUID } from 'crypto';

/**
 * Creates, updates, acknowledges, resolves, suppresses, and reopens operational incidents.
 * Must enforce explicit state transitions, tenant/platform scope, severity, evidence, timestamps,
 * ownership, and idempotent creation.
 */

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: OperationalAuditService,
    private readonly deduplicationService: IncidentDeduplicationService,
  ) {}

  async createIncident(params: {
    tenantId?: string | null;
    type: string;
    severity: OperationalIncidentSeverity | string;
    title: string;
    summary: string;
    source: string;
    affectedComponent: string;
    affectedCapability?: string | null;
    scopeTarget?: string | null;
    evidence: Record<string, unknown>;
    correlationId?: string | null;
    requestId?: string | null;
    actorId?: string | null;
    actorType?: string;
  }): Promise<any> {
    // Secret redaction enforced
    const evidence = redactSecrets(params.evidence);

    const idempotencyKey = deterministicIdempotencyKey({
      type: `incident:${params.type}`,
      tenantId: params.tenantId ?? null,
      fingerprint: this.deduplicationService.generateFingerprint({
        type: params.type,
        severity: params.severity,
        affectedComponent: params.affectedComponent,
        affectedCapability: params.affectedCapability ?? null,
        tenantId: params.tenantId ?? null,
        scopeTarget: params.scopeTarget ?? null,
      }),
      correlationId: params.correlationId ?? null,
      timestampBucket: new Date().toISOString().slice(0, 13), // hourly dedup bucket
    });

    // Check idempotency key first
    try {
      const existingByIdempotency = await (this.prisma as any).operationalIncident.findFirst({
        where: { idempotencyKey },
      });
      if (existingByIdempotency) {
        return existingByIdempotency;
      }
    } catch {}

    const { incident, isDuplicate } = await this.deduplicationService.deduplicateOrCreate({
      tenantId: params.tenantId ?? null,
      type: params.type,
      severity: params.severity,
      title: params.title,
      summary: params.summary,
      source: params.source,
      affectedComponent: params.affectedComponent,
      affectedCapability: params.affectedCapability ?? null,
      scopeTarget: params.scopeTarget ?? null,
      evidence,
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
      idempotencyKey,
      actorId: params.actorId ?? null,
    });

    const auditRef = await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: isDuplicate ? 'INCIDENT_DEDUPLICATED' : 'INCIDENT_CREATED',
      actorId: params.actorId ?? null,
      actorType: params.actorType ?? (params.actorId ? 'USER' : 'SYSTEM'),
      targetType: 'INCIDENT',
      targetId: incident.id,
      evidence: redactSecrets({
        fingerprint: incident.fingerprint,
        type: params.type,
        severity: params.severity,
        affectedComponent: params.affectedComponent,
        isDuplicate,
        correlationId: params.correlationId,
      }),
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });

    if (!isDuplicate) {
      try {
        await (this.prisma as any).operationalIncident.update({
          where: { id: incident.id },
          data: { auditReference: auditRef ?? undefined },
        });
      } catch {}
    }

    return incident;
  }

  async getIncident(tenantId: string | null, incidentId: string): Promise<any> {
    // Tenant isolation enforced
    const where: any = { id: incidentId };
    if (tenantId !== null) {
      where.tenantId = tenantId;
    } else {
      // Platform request: allow platform incidents (tenantId null) OR require platform RBAC elsewhere (controller)
      // Here we don't filter if tenantId null means platform scope, but controller must enforce RBAC
    }
    try {
      const incident = await (this.prisma as any).operationalIncident.findFirst({ where });
      if (!incident) throw new NotFoundException(`Incident ${incidentId} not found`);
      // Tenant isolation: if requesting tenantId is set, incident must belong to that tenant or be platform-wide readable only with platform RBAC
      if (tenantId !== null && incident.tenantId !== null && incident.tenantId !== tenantId) {
        throw new ForbiddenException('Tenant isolation violation');
      }
      return incident;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      throw new NotFoundException(`Incident ${incidentId} not found`);
    }
  }

  async listIncidents(params: {
    tenantId?: string | null;
    state?: string;
    severity?: string;
    type?: string;
    affectedComponent?: string;
    correlationId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId = null, state, severity, type, affectedComponent, correlationId, page = 1, limit = 20 } = params;
    const where: any = {};
    if (tenantId !== undefined) {
      if (tenantId === null) {
        // Platform query: controller enforces RBAC, we return platform + all? For platform visibility, allow all when tenantId null and platform RBAC passed
        // For safety, when tenantId null we return only platform incidents unless explicitly platform admin
        // Here we keep where empty to allow platform to see all, but tenant isolation is enforced in controller
      } else {
        where.tenantId = tenantId;
      }
    }
    if (state) where.state = state;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (affectedComponent) where.affectedComponent = affectedComponent;
    if (correlationId) where.correlationId = correlationId;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).operationalIncident.findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).operationalIncident.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async transitionIncident(params: {
    tenantId: string | null;
    incidentId: string;
    toState: OperationalIncidentState;
    actorId?: string | null;
    actorType?: string;
    reason?: string | null;
    evidence?: Record<string, unknown>;
    correlationId?: string | null;
    requestId?: string | null;
  }): Promise<any> {
    const incident = await this.getIncident(params.tenantId, params.incidentId);

    const fromState = incident.state as OperationalIncidentState;
    const toState = params.toState;

    if (!isValidTransition(INCIDENT_VALID_TRANSITIONS, fromState, toState)) {
      throw new BadRequestException(`Invalid incident transition ${fromState} -> ${toState}`);
    }

    const now = new Date();
    const data: any = {
      state: toState,
      updatedAt: now,
    };

    // State-specific timestamp handling
    if (toState === OperationalIncidentState.ACKNOWLEDGED) {
      data.acknowledgedAt = now;
      data.acknowledgedBy = params.actorId ?? null;
    } else if (toState === OperationalIncidentState.ESCALATED) {
      data.escalatedAt = now;
      const history = (incident.escalationHistory as any[]) ?? [];
      history.push({
        timestamp: now.toISOString(),
        actorId: params.actorId ?? null,
        reason: params.reason ?? null,
        correlationId: params.correlationId ?? null,
      });
      data.escalationHistory = history;
    } else if (toState === OperationalIncidentState.RESOLVED) {
      data.resolvedAt = now;
      data.resolvedBy = params.actorId ?? null;
      data.resolutionNote = params.reason?.slice(0, 1000) ?? null;
    } else if (toState === OperationalIncidentState.SUPPRESSED) {
      data.suppressedAt = now;
      data.suppressedBy = params.actorId ?? null;
      data.suppressionReason = params.reason?.slice(0, 500) ?? null;
    } else if (toState === OperationalIncidentState.REOPENED) {
      data.reopenedAt = now;
      data.reopenedBy = params.actorId ?? null;
      data.reopenReason = params.reason?.slice(0, 500) ?? null;
    }

    const updated = await (this.prisma as any).operationalIncident.update({
      where: { id: incident.id },
      data,
    });

    // Record transition event
    try {
      await (this.prisma as any).operationalIncidentEvent.create({
        data: {
          tenantId: params.tenantId ?? null,
          incidentId: incident.id,
          eventType: 'STATE_TRANSITION',
          fromState: fromState as any,
          toState: toState as any,
          actorId: params.actorId ?? null,
          actorType: params.actorType ?? (params.actorId ? 'USER' : 'SYSTEM'),
          reason: params.reason?.slice(0, 1000) ?? null,
          evidence: redactSecrets(params.evidence ?? {}) as any,
        },
      });
    } catch {}

    const auditEventMap: Record<string, string> = {
      [OperationalIncidentState.ACKNOWLEDGED]: 'INCIDENT_ACKNOWLEDGED',
      [OperationalIncidentState.ESCALATED]: 'INCIDENT_ESCALATED',
      [OperationalIncidentState.MITIGATING]: 'INCIDENT_MITIGATING',
      [OperationalIncidentState.RESOLVED]: 'INCIDENT_RESOLVED',
      [OperationalIncidentState.SUPPRESSED]: 'INCIDENT_SUPPRESSED',
      [OperationalIncidentState.REOPENED]: 'INCIDENT_REOPENED',
    };

    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: (auditEventMap[toState] ?? 'INCIDENT_CREATED') as any,
      actorId: params.actorId ?? null,
      actorType: params.actorType ?? (params.actorId ? 'USER' : 'SYSTEM'),
      targetType: 'INCIDENT',
      targetId: incident.id,
      evidence: redactSecrets({
        fromState,
        toState,
        reason: params.reason,
        correlationId: params.correlationId,
      }),
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });

    return updated;
  }

  async acknowledge(params: {
    tenantId: string | null;
    incidentId: string;
    actorId?: string | null;
    reason?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    return this.transitionIncident({
      tenantId: params.tenantId,
      incidentId: params.incidentId,
      toState: OperationalIncidentState.ACKNOWLEDGED,
      actorId: params.actorId ?? null,
      reason: params.reason ?? null,
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });
  }

  async resolve(params: {
    tenantId: string | null;
    incidentId: string;
    actorId?: string | null;
    reason: string;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    if (!params.reason) throw new BadRequestException('Resolution reason required');
    return this.transitionIncident({
      tenantId: params.tenantId,
      incidentId: params.incidentId,
      toState: OperationalIncidentState.RESOLVED,
      actorId: params.actorId ?? null,
      reason: params.reason,
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });
  }

  async suppress(params: {
    tenantId: string | null;
    incidentId: string;
    actorId?: string | null;
    reason: string;
    suppressUntil?: Date | null;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    const incident = await this.getIncident(params.tenantId, params.incidentId);
    if (!isValidTransition(INCIDENT_VALID_TRANSITIONS, incident.state as any, OperationalIncidentState.SUPPRESSED)) {
      throw new BadRequestException(`Cannot suppress incident in state ${incident.state}`);
    }
    const updated = await (this.prisma as any).operationalIncident.update({
      where: { id: incident.id },
      data: {
        state: OperationalIncidentState.SUPPRESSED,
        suppressedAt: new Date(),
        suppressedBy: params.actorId ?? null,
        suppressionReason: params.reason.slice(0, 500),
        suppressUntil: params.suppressUntil ?? null,
      },
    });
    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: 'INCIDENT_SUPPRESSED' as any,
      actorId: params.actorId ?? null,
      actorType: params.actorId ? 'USER' : 'SYSTEM',
      targetType: 'INCIDENT',
      targetId: incident.id,
      evidence: redactSecrets({ reason: params.reason, suppressUntil: params.suppressUntil }),
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });
    return updated;
  }

  async reopen(params: {
    tenantId: string | null;
    incidentId: string;
    actorId?: string | null;
    reason: string;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    const incident = await this.getIncident(params.tenantId, params.incidentId);
    if (!isValidTransition(INCIDENT_VALID_TRANSITIONS, incident.state as any, OperationalIncidentState.REOPENED)) {
      throw new BadRequestException(`Cannot reopen incident in state ${incident.state}`);
    }
    return this.transitionIncident({
      tenantId: params.tenantId,
      incidentId: params.incidentId,
      toState: OperationalIncidentState.REOPENED,
      actorId: params.actorId ?? null,
      reason: params.reason,
      correlationId: params.correlationId ?? null,
      requestId: params.requestId ?? null,
    });
  }

  async assignOperator(params: { tenantId: string | null; incidentId: string; operatorId: string; actorId?: string | null }) {
    const incident = await this.getIncident(params.tenantId, params.incidentId);
    const updated = await (this.prisma as any).operationalIncident.update({
      where: { id: incident.id },
      data: { assignedOperatorId: params.operatorId },
    });
    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: 'INCIDENT_ACKNOWLEDGED' as any,
      actorId: params.actorId ?? null,
      actorType: 'USER',
      targetType: 'INCIDENT',
      targetId: incident.id,
      evidence: { assignedOperatorId: params.operatorId },
      correlationId: null,
    });
    return updated;
  }
}
