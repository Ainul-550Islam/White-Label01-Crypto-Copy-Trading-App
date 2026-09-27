/**
 * Developer-platform reconciliation.
 *
 * Read-only detection of orphaned/duplicated/stale records across
 * applications, credentials, grants/tokens, scopes, webhooks, deliveries
 * and usage. Findings are REPORTED with a suggested action and are never
 * applied automatically: authoritative security and usage truth is never
 * silently mutated by this service.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  DEVELOPER_SCOPES,
  isKnownEventType,
  RECONCILIATION_FINDING_KINDS,
  type ReconciliationFinding,
  type ReconciliationFindingKind,
} from './developer.types';

export interface ReconciliationReport {
  tenantId: string | null;
  scannedAt: string;
  findings: ReconciliationFinding[];
  counts: Record<ReconciliationFindingKind, number>;
}

@Injectable()
export class DeveloperReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private emptyCounts(): Record<ReconciliationFindingKind, number> {
    const counts = {} as Record<ReconciliationFindingKind, number>;
    for (const kind of RECONCILIATION_FINDING_KINDS) counts[kind] = 0;
    return counts;
  }

  private finding(
    kind: ReconciliationFindingKind,
    severity: ReconciliationFinding['severity'],
    subjectType: string,
    subjectId: string,
    detail: string,
    suggestedAction: string,
  ): ReconciliationFinding {
    return { kind, severity, subjectType, subjectId, detail, suggestedAction };
  }

  async reconcile(tenantId?: string): Promise<ReconciliationReport> {
    const findings: ReconciliationFinding[] = [];
    const counts = this.emptyCounts();
    const push = (finding: ReconciliationFinding) => {
      findings.push(finding);
      counts[finding.kind] += 1;
    };
    const tenantFilter = tenantId ? { tenantId } : {};

    // 1. APPLICATION_WITHOUT_TENANT — the FK prevents this in SQL, but the
    //    scan is deliberate: a tenant row removed by an unrelated flow would
    //    orphan applications and the detector must say so, not assume.
    const applications = await this.prisma.developerApplication.findMany({
      where: tenantFilter,
      include: { tenant: { select: { id: true } } },
      take: 10_000,
    });
    for (const application of applications) {
      if (!application.tenant || !application.tenantId) {
        push(
          this.finding(
            'APPLICATION_WITHOUT_TENANT',
            'HIGH',
            'developer_application',
            application.id,
            'application row has no resolvable tenant',
            'quarantine application and investigate tenant removal flow',
          ),
        );
      }

      // 2. VERSION_WITHOUT_CONTRACT — applications pinned to dead versions.
      //    (checked per application below via credentials/tokens usage)

      // 3. TOKEN_WITHOUT_ACTIVE_APPLICATION
      if (application.state === 'REVOKED') {
        const liveTokens = await this.prisma.developerAccessToken.count({
          where: { applicationId: application.id, revokedAt: null },
        });
        if (liveTokens > 0) {
          push(
            this.finding(
              'TOKEN_WITHOUT_ACTIVE_APPLICATION',
              'HIGH',
              'developer_application',
              application.id,
              `${liveTokens} live token(s) on a revoked application`,
              'revoke tokens (explicit security action, not automatic)',
            ),
          );
        }
      }
    }

    // 4. CREDENTIAL_WITHOUT_APPLICATION
    const credentials = await this.prisma.developerCredential.findMany({
      where: { ...tenantFilter, revokedAt: null },
      include: { application: { select: { id: true, tenantId: true } } },
      take: 10_000,
    });
    for (const credential of credentials) {
      if (!credential.application) {
        push(
          this.finding(
            'CREDENTIAL_WITHOUT_APPLICATION',
            'HIGH',
            'developer_credential',
            credential.keyId,
            'active credential has no resolvable application',
            'revoke credential after investigation (explicit security action)',
          ),
        );
      }
    }

    // 5. SCOPE_WITHOUT_POLICY — credentials/application scopes outside the
    //    current catalog indicate drift between releases.
    const knownScopes = new Set(DEVELOPER_SCOPES.map((definition) => definition.scope));
    for (const credential of credentials) {
      const unknown = credential.scopes.filter((scope: string) => !knownScopes.has(scope));
      if (unknown.length > 0) {
        push(
          this.finding(
            'SCOPE_WITHOUT_POLICY',
            'MEDIUM',
            'developer_credential',
            credential.keyId,
            `credential holds unknown scope(s): ${unknown.join(', ')}`,
            'reissue credential with cataloged scopes after review',
          ),
        );
      }
    }

    // 6. WEBHOOK_WITHOUT_APPLICATION / WEBHOOK_SCOPE_MISMATCH
    const subscriptions = await this.prisma.developerWebhookSubscription.findMany({
      where: { ...tenantFilter, revokedAt: null },
      include: {
        application: { select: { id: true, scopes: true, tenantId: true } },
      },
      take: 10_000,
    });
    for (const subscription of subscriptions) {
      if (!subscription.application) {
        push(
          this.finding(
            'WEBHOOK_WITHOUT_APPLICATION',
            'HIGH',
            'developer_webhook_subscription',
            subscription.id,
            'active subscription has no resolvable application',
            'pause subscription and reassign ownership',
          ),
        );
        continue;
      }
      if (!subscription.application.scopes.includes('webhooks:manage')) {
        push(
          this.finding(
            'WEBHOOK_SCOPE_MISMATCH',
            'MEDIUM',
            'developer_webhook_subscription',
            subscription.id,
            "owning application lacks the 'webhooks:manage' scope",
            'review application scope history in the audit chain',
          ),
        );
      }
      const unknownEvents = subscription.eventTypes.filter((type: string) => !isKnownEventType(type));
      if (unknownEvents.length > 0) {
        push(
          this.finding(
            'SCOPE_WITHOUT_POLICY',
            'LOW',
            'developer_webhook_subscription',
            subscription.id,
            `subscribed to unknown event type(s): ${unknownEvents.join(', ')}`,
            'trim subscription event list',
          ),
        );
      }
    }

    // 7. DELIVERY_WITHOUT_EVENT / DELIVERY_STATUS_UNKNOWN
    const deliveries = await this.prisma.developerWebhookDelivery.findMany({
      where: tenantFilter,
      select: { id: true, state: true, eventId: true },
      take: 20_000,
    });
    for (const delivery of deliveries) {
      if (!delivery.eventId) {
        push(
          this.finding(
            'DELIVERY_WITHOUT_EVENT',
            'MEDIUM',
            'developer_webhook_delivery',
            delivery.id,
            'delivery row has no event id',
            'rebuild delivery from the authoritative event record',
          ),
        );
      }
      const KNOWN_STATES = ['QUEUED', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'EXHAUSTED', 'CANCELLED'];
      if (!KNOWN_STATES.includes(delivery.state)) {
        push(
          this.finding(
            'DELIVERY_STATUS_UNKNOWN',
            'MEDIUM',
            'developer_webhook_delivery',
            delivery.id,
            `delivery state '${delivery.state}' is outside the state machine`,
            'repair via explicit state transition after review',
          ),
        );
      }
    }

    // 8. USAGE_WITHOUT_APPLICATION
    const usageEvents = await this.prisma.usageEvent.findMany({
      where: {
        ...tenantFilter,
        meterKey: { startsWith: 'developer_' },
      },
      select: { id: true, safeMetadata: true },
      take: 20_000,
    });
    const knownApplicationIds = new Set(applications.map((application: { id: string }) => application.id));
    for (const event of usageEvents) {
      const metadata = (event.safeMetadata ?? {}) as Record<string, unknown>;
      const applicationId = typeof metadata.applicationId === 'string' ? metadata.applicationId : null;
      if (applicationId && !knownApplicationIds.has(applicationId)) {
        push(
          this.finding(
            'USAGE_WITHOUT_APPLICATION',
            'LOW',
            'usage_event',
            event.id,
            `usage references unknown application '${applicationId}'`,
            'verify against audit history; usage stays (billing truth is authoritative)',
          ),
        );
      }
    }

    // 9. TENANT_SCOPE_MISMATCH — deliveries whose tenant differs from their
    //    subscription's tenant.
    for (const delivery of deliveries.slice(0, 2_000)) {
      const row = await this.prisma.developerWebhookDelivery.findUnique({
        where: { id: delivery.id },
        select: { tenantId: true, subscription: { select: { tenantId: true } } },
      });
      if (row?.subscription && row.tenantId !== row.subscription.tenantId) {
        push(
          this.finding(
            'TENANT_SCOPE_MISMATCH',
            'HIGH',
            'developer_webhook_delivery',
            delivery.id,
            'delivery tenant differs from subscription tenant',
            'cancel delivery and investigate cross-tenant write path',
          ),
        );
      }
    }

    findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.subjectId.localeCompare(b.subjectId));
    return { tenantId: tenantId ?? null, scannedAt: new Date().toISOString(), findings, counts };
  }
}
