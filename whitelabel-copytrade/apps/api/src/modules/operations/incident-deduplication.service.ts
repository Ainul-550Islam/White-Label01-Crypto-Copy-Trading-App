import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  deterministicIncidentFingerprint,
  OperationalIncidentSeverity,
  redactSecrets,
} from './operations.types';

/**
 * Produces deterministic incident fingerprints from normalized incident attributes,
 * correlates repeated failures, increments occurrence metadata, and prevents duplicate
 * incident storms without hiding materially different failures.
 */

@Injectable()
export class IncidentDeduplicationService {
  private readonly logger = new Logger(IncidentDeduplicationService.name);

  constructor(private readonly prisma: PrismaService) {}

  generateFingerprint(params: {
    type: string;
    severity: OperationalIncidentSeverity | string;
    affectedComponent: string;
    affectedCapability?: string | null;
    tenantId?: string | null;
    scopeTarget?: string | null;
  }): string {
    return deterministicIncidentFingerprint({
      type: params.type,
      severity: params.severity as string,
      affectedComponent: params.affectedComponent,
      affectedCapability: params.affectedCapability ?? null,
      tenantId: params.tenantId ?? null,
      scopeTarget: params.scopeTarget ?? null,
    });
  }

  async findExistingIncident(params: {
    fingerprint: string;
    tenantId?: string | null;
  }): Promise<any | null> {
    try {
      const where: any = { fingerprint: params.fingerprint };
      if (params.tenantId !== undefined) {
        where.tenantId = params.tenantId;
      }
      return await (this.prisma as any).operationalIncident.findFirst({
        where,
        orderBy: { lastSeenAt: 'desc' },
      });
    } catch {
      return null;
    }
  }

  async deduplicateOrCreate(params: {
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
    idempotencyKey: string;
    actorId?: string | null;
  }): Promise<{ incident: any; isDuplicate: boolean }> {
    const fingerprint = this.generateFingerprint({
      type: params.type,
      severity: params.severity,
      affectedComponent: params.affectedComponent,
      affectedCapability: params.affectedCapability ?? null,
      tenantId: params.tenantId ?? null,
      scopeTarget: params.scopeTarget ?? null,
    });

    const existing = await this.findExistingIncident({ fingerprint, tenantId: params.tenantId ?? null });

    if (existing) {
      // Check if existing is resolved/suppressed — if so, don't deduplicate, allow reopen via separate flow
      if (existing.state === 'RESOLVED' || existing.state === 'SUPPRESSED') {
        // Create new incident with same fingerprint but new occurrence
        // However we preserve fingerprint uniqueness per tenant+state? We use tenant+fingerprint unique,
        // so we cannot create duplicate with same fingerprint while old exists. We must handle by reopening or creating new with different idempotency.
        // For resolved incidents, we will create a new incident with same fingerprint but we need to allow it — so we will reopen logic elsewhere.
        // Here we increment occurrence if not resolved, else we return existing to be reopened by caller.
        if (existing.state === 'RESOLVED' || existing.state === 'SUPPRESSED') {
          // Caller should reopen; we return existing as duplicate false to signal need to reopen
          return { incident: existing, isDuplicate: false };
        }
      }

      // Increment occurrence metadata — deterministic, no hiding materially different failures because fingerprint includes component/capability/tenant/scopeTarget
      try {
        const updated = await (this.prisma as any).operationalIncident.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(),
            occurrenceCount: { increment: 1 },
            evidence: redactSecrets({
              ...(existing.evidence as any),
              lastEvidence: redactSecrets(params.evidence),
              occurrenceCount: existing.occurrenceCount + 1,
            }) as any,
            correlationId: params.correlationId ?? existing.correlationId,
          },
        });

        // Record deduplication event
        try {
          await (this.prisma as any).operationalIncidentEvent.create({
            data: {
              tenantId: params.tenantId ?? null,
              incidentId: existing.id,
              eventType: 'DEDUPLICATED',
              reason: `Duplicate incident deduplicated, occurrence ${existing.occurrenceCount + 1}`,
              evidence: redactSecrets({ fingerprint, correlationId: params.correlationId }) as any,
              actorId: params.actorId ?? null,
              actorType: 'SYSTEM',
            },
          });
        } catch {}

        this.logger.log({
          event: 'operations.incident.deduplicated',
          fingerprint,
          incidentId: existing.id,
          occurrenceCount: existing.occurrenceCount + 1,
        });

        return { incident: updated, isDuplicate: true };
      } catch (e) {
        this.logger.warn(`Failed to deduplicate incident ${existing.id}: ${(e as Error).message}`);
        return { incident: existing, isDuplicate: true };
      }
    }

    // No existing — create new incident
    try {
      const incident = await (this.prisma as any).operationalIncident.create({
        data: {
          tenantId: params.tenantId ?? null,
          fingerprint,
          type: params.type,
          severity: params.severity as any,
          state: 'OPEN',
          title: params.title.slice(0, 255),
          summary: params.summary.slice(0, 1000),
          source: params.source,
          affectedComponent: params.affectedComponent,
          affectedCapability: params.affectedCapability ?? null,
          evidence: redactSecrets(params.evidence) as any,
          correlationId: params.correlationId ?? null,
          requestId: params.requestId ?? null,
          idempotencyKey: params.idempotencyKey,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          occurrenceCount: 1,
        },
      });

      // Create creation event
      try {
        await (this.prisma as any).operationalIncidentEvent.create({
          data: {
            tenantId: params.tenantId ?? null,
            incidentId: incident.id,
            eventType: 'CREATED',
            toState: 'OPEN',
            reason: params.summary.slice(0, 500),
            evidence: redactSecrets(params.evidence) as any,
            actorId: params.actorId ?? null,
            actorType: params.actorId ? 'USER' : 'SYSTEM',
          },
        });
      } catch {}

      return { incident, isDuplicate: false };
    } catch (e) {
      // Handle race condition: unique constraint violation means another process created same fingerprint concurrently
      const msg = (e as Error).message;
      if (msg.includes('Unique constraint') || msg.includes('idempotency_key') || msg.includes('fingerprint')) {
        const retryExisting = await this.findExistingIncident({ fingerprint, tenantId: params.tenantId ?? null });
        if (retryExisting) {
          return { incident: retryExisting, isDuplicate: true };
        }
      }
      throw e;
    }
  }
}
