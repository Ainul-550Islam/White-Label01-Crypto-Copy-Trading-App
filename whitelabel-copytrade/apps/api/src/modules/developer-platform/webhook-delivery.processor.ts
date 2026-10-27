import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyService,
  type DeveloperPolicyDataPort,
} from './developer-policy.service';
import { DeveloperAuditService } from './developer-audit.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

const TENANT_BATCH_SIZE = 32;
const TENANT_CACHE_MS = 30_000;
const STALE_DELIVERY_MS = 120_000;
const TENANT_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * API-process webhook dispatcher. The delivery row is held with SKIP LOCKED
 * throughout the bounded HTTPS request and its audited state transition.
 * Multiple replicas cannot simultaneously process a row; a process crash
 * rolls the database transaction back so another replica can retry it.
 *
 * This is at-least-once delivery: if the receiver accepts a request but the
 * process dies before commit, the same stable event id can be sent again.
 * Receivers must deduplicate by event id. Paused subscriptions are held and
 * revoked subscriptions are cancelled instead of contacted.
 */
@Injectable()
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);
  private running = false;
  private tenantIds: string[] = [];
  private tenantCursor = 0;
  private tenantCacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly policy: DeveloperPolicyService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    private readonly audit: DeveloperAuditService,
  ) {}

  @Interval(2_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const tenantId of await this.nextTenantIds()) {
        try {
          await this.processTenantOnce(tenantId);
        } catch (error) {
          // Never log URL, payload, headers, secret material or raw errors.
          this.logger.warn(`Webhook delivery failed for tenant ${tenantId}: ${error instanceof Error ? error.name : 'unknown error'}`);
        }
      }
    } catch (error) {
      this.logger.error(`Webhook dispatch cycle failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    } finally {
      this.running = false;
    }
  }

  private async nextTenantIds(): Promise<string[]> {
    if (Date.now() >= this.tenantCacheExpiresAt) {
      const tenants = await this.prisma.tenant.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      this.tenantIds = tenants.map((tenant) => tenant.id);
      this.tenantCacheExpiresAt = Date.now() + TENANT_CACHE_MS;
      this.tenantCursor = this.tenantIds.length ? this.tenantCursor % this.tenantIds.length : 0;
    }
    const count = Math.min(TENANT_BATCH_SIZE, this.tenantIds.length);
    const batch: string[] = [];
    for (let index = 0; index < count; index += 1) {
      batch.push(this.tenantIds[(this.tenantCursor + index) % this.tenantIds.length] as string);
    }
    if (count) this.tenantCursor = (this.tenantCursor + count) % this.tenantIds.length;
    return batch;
  }

  /** Process at most one due delivery, or return false when none is due. */
  async processTenantOnce(tenantId: string): Promise<boolean> {
    if (!TENANT_UUID.test(tenantId)) throw new Error('webhook dispatcher requires a canonical tenant UUID');
    // HTTP has a 10-second total timeout. The extra budget is for signing,
    // audit and commit. One transaction/connection is held per running
    // processor, never one per queued item.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      // Read and lock the current subscription/plan with the same tenant
      // transaction used for the send, so a grant edit cannot complete first.
      const plan = await this.policyData.planLimitViewForTenant(tenantId, tx);
      const entitlements = await this.policyData.tenantEntitlementKeys(tenantId, tx);
      const policy = this.policy.resolve(tenantId, plan, entitlements);
      const maySend = policy.allowedScopes.includes('webhooks:manage');
      const rows = await tx.$queryRaw<Array<{ id: string; state: string; attempt: number; applicationId: string; revokedAt: Date | null }>>`
        SELECT delivery."id", delivery."state", delivery."attempt",
          delivery."application_id" AS "applicationId", subscription."revoked_at" AS "revokedAt"
        FROM "developer_webhook_deliveries" AS delivery
        JOIN "developer_webhook_subscriptions" AS subscription
          ON subscription."id" = delivery."subscription_id"
         AND subscription."tenant_id" = delivery."tenant_id"
        LEFT JOIN "developer_applications" AS application
          ON application."id" = delivery."application_id"
         AND application."tenant_id" = delivery."tenant_id"
         AND application."id" = subscription."application_id"
        WHERE delivery."tenant_id" = ${tenantId}::uuid
          AND (
            subscription."revoked_at" IS NOT NULL
            OR (${maySend} AND subscription."state" = 'ACTIVE' AND subscription."revoked_at" IS NULL
                AND application."state" = 'ACTIVE' AND 'webhooks:manage' = ANY(application."scopes")
                AND application."environment" = subscription."environment"
                AND delivery."environment" = subscription."environment"
                AND delivery."event_version" = subscription."event_version"
                AND delivery."event_type" = ANY(subscription."event_types"))
          )
          AND (
            delivery."state" = 'QUEUED'
            OR (delivery."state" = 'RETRY_SCHEDULED' AND delivery."next_retry_at" <= CURRENT_TIMESTAMP)
            OR (delivery."state" = 'DELIVERING' AND delivery."updated_at" <=
                CURRENT_TIMESTAMP - (${STALE_DELIVERY_MS} * INTERVAL '1 millisecond'))
          )
        ORDER BY delivery."created_at" ASC, delivery."id" ASC
        LIMIT 1
        FOR UPDATE OF delivery SKIP LOCKED
      `;
      const row = rows[0];
      if (!row) return false;
      // DELIVERING rows left by an older, non-transactional sender can be
      // reclaimed after a conservative grace period. Our own transactions
      // never commit that intermediate state.
      if (row.state === 'DELIVERING') {
        await tx.developerWebhookDelivery.update({
          where: { id: row.id },
          data: { state: 'RETRY_SCHEDULED', nextRetryAt: new Date() },
        });
      }
      const actor = { tenantId, actorType: 'SERVICE' as const, actorId: 'webhook-dispatcher', correlationId: `webhook:${row.id}` };
      if (row.revokedAt === null && row.attempt >= policy.webhookMaxAttempts) {
        // A stale legacy attempt, or a lower configured retry limit, must not
        // bypass the limit. Record exhaustion transactionally without sending.
        await tx.developerWebhookDelivery.update({
          where: { id: row.id },
          data: { state: 'EXHAUSTED', nextRetryAt: null },
        });
        await this.audit.record({
          ...actor,
          applicationId: row.applicationId,
          action: 'webhook.delivery_exhausted',
          detail: { deliveryId: row.id, attempt: row.attempt, state: 'EXHAUSTED' },
        }, tx);
      } else {
        await this.deliveries.attempt(actor, row.id, policy, tx);
      }
      return true;
    }, { timeout: 20_000, maxWait: 5_000 });
  }
}
