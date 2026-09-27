import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationsPolicyService } from './operations-policy.service';
import { OperationalAuditService } from './operational-audit.service';
import { IncidentService } from './incident.service';
import { OperationalIncidentSeverity, OperationalIncidentState, redactSecrets } from './operations.types';

/**
 * Applies explicit escalation policy based on incident severity, dependency criticality,
 * recurrence, age, and existing operator policy. Must integrate with existing notification
 * delivery infrastructure rather than implementing a second notification provider.
 */

@Injectable()
export class IncidentEscalationService {
  private readonly logger = new Logger(IncidentEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: OperationsPolicyService,
    private readonly auditService: OperationalAuditService,
    private readonly incidentService: IncidentService,
  ) {}

  async evaluateAndEscalate(params: {
    tenantId?: string | null;
    incidentId: string;
    triggeredBy?: string | null;
    correlationId?: string | null;
  }): Promise<any | null> {
    const { tenantId = null, incidentId, triggeredBy = null, correlationId = null } = params;

    const incident = await this.incidentService.getIncident(tenantId, incidentId);

    if (incident.state === OperationalIncidentState.RESOLVED || incident.state === OperationalIncidentState.SUPPRESSED) {
      return null; // Do not escalate resolved/suppressed
    }

    const rules = this.policyService.getEscalationRules();
    const rule = rules.find((r) => r.severity === incident.severity);
    if (!rule) return null;

    const now = new Date();
    const firstSeen = new Date(incident.firstSeenAt);
    const ageMinutes = (now.getTime() - firstSeen.getTime()) / 60000;

    const shouldEscalateByAge = ageMinutes >= rule.maxAgeMinutes;
    const shouldEscalateByOccurrence = incident.occurrenceCount >= rule.maxOccurrences;
    const shouldEscalate = shouldEscalateByAge || shouldEscalateByOccurrence;

    if (!shouldEscalate) {
      this.logger.debug({
        event: 'operations.escalation.not_required',
        incidentId,
        ageMinutes: Math.round(ageMinutes),
        occurrenceCount: incident.occurrenceCount,
        severity: incident.severity,
      });
      return null;
    }

    // Apply escalation — transition to ESCALATED if valid
    try {
      const escalated = await this.incidentService.transitionIncident({
        tenantId: tenantId ?? null,
        incidentId,
        toState: OperationalIncidentState.ESCALATED,
        actorId: triggeredBy ?? null,
        actorType: triggeredBy ? 'USER' : 'SYSTEM',
        reason: `Escalated by policy: severity ${incident.severity} age ${Math.round(ageMinutes)}min occurrences ${incident.occurrenceCount}`,
        evidence: redactSecrets({
          rule,
          ageMinutes: Math.round(ageMinutes),
          occurrenceCount: incident.occurrenceCount,
          escalateTo: rule.escalateTo,
        }),
        correlationId: correlationId ?? null,
      });

      // Integrate with existing notification delivery infrastructure (do not implement second provider)
      await this.sendEscalationNotification({
        tenantId: tenantId ?? null,
        incident: escalated,
        escalateTo: rule.escalateTo,
        correlationId: correlationId ?? null,
      });

      await this.auditService.record({
        tenantId: tenantId ?? null,
        eventType: 'ESCALATION_TRIGGERED' as any,
        actorId: triggeredBy ?? null,
        actorType: triggeredBy ? 'USER' : 'SYSTEM',
        targetType: 'INCIDENT',
        targetId: incidentId,
        evidence: redactSecrets({
          severity: incident.severity,
          ageMinutes: Math.round(ageMinutes),
          occurrenceCount: incident.occurrenceCount,
          escalateTo: rule.escalateTo,
        }),
        correlationId: correlationId ?? null,
      });

      return escalated;
    } catch (e) {
      this.logger.warn(`Escalation failed for incident ${incidentId}: ${(e as Error).message}`);
      return null;
    }
  }

  private async sendEscalationNotification(params: {
    tenantId: string | null;
    incident: any;
    escalateTo: string[];
    correlationId: string | null;
  }): Promise<void> {
    // Reuse existing notification infrastructure via Prisma notification table or queue
    // Do not implement second provider
    try {
      // Try to enqueue notification job if queue service available via Prisma fallback
      const title = `Incident escalated: ${params.incident.title}`;
      const body = `Incident ${params.incident.id} severity ${params.incident.severity} escalated to ${params.escalateTo.join(', ')}`;

      // If tenantId present, create in-app notification for operators
      if (params.tenantId) {
        // Find tenant operators/admins
        const operators = await this.prisma.user.findMany({
          where: {
            tenantId: params.tenantId,
            status: 'ACTIVE' as any,
          },
          take: 10,
          select: { id: true },
        });
        for (const op of operators) {
          try {
            await this.prisma.notification.create({
              data: {
                tenantId: params.tenantId,
                userId: op.id,
                channel: 'IN_APP' as any,
                type: 'INCIDENT_ESCALATION',
                title: title.slice(0, 160),
                body: body.slice(0, 1000),
                data: redactSecrets({
                  incidentId: params.incident.id,
                  severity: params.incident.severity,
                  fingerprint: params.incident.fingerprint,
                  correlationId: params.correlationId,
                }) as any,
              } as any,
            });
          } catch {}
        }
      } else {
        // Platform incident: log and audit, notification via existing system would be platform-wide
        this.logger.log({
          event: 'operations.incident.escalation_notification_platform',
          incidentId: params.incident.id,
          escalateTo: params.escalateTo,
        });
      }
    } catch (e) {
      this.logger.warn(`Failed to send escalation notification: ${(e as Error).message}`);
    }
  }

  async checkAllPendingEscalations(): Promise<number> {
    try {
      const now = new Date();
      // Find open incidents that may need escalation
      const incidents = await (this.prisma as any).operationalIncident.findMany({
        where: {
          state: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        take: 100,
        orderBy: { firstSeenAt: 'asc' },
      });

      let escalatedCount = 0;
      for (const incident of incidents) {
        const result = await this.evaluateAndEscalate({
          tenantId: incident.tenantId ?? null,
          incidentId: incident.id,
          triggeredBy: null,
          correlationId: null,
        });
        if (result) escalatedCount++;
      }
      return escalatedCount;
    } catch (e) {
      this.logger.warn(`Failed to check pending escalations: ${(e as Error).message}`);
      return 0;
    }
  }
}
