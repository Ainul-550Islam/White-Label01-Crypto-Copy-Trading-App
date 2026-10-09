// # NEW — Claims outbox batches with SKIP LOCKED, publishes idempotently, retries, and dead-letters
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { EventSubscriptionService } from '../../modules/developer-platform/event-subscription.service';
import { eventDefinition } from '../../modules/developer-platform/developer.types';
import {
  CopyTradingNotificationProcessor,
  type CopyTradingNotificationEventType,
} from '../../modules/notifications/processors/copy-trading-notification.processor';

const TENANT_BATCH_SIZE = 32;
const EVENT_BATCH_SIZE = 20;
const TENANT_CACHE_MS = 30_000;
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 12;
const MAX_RETRY_DELAY_MS = 300_000;

interface ClaimedOutboxEvent {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  correlationId: string | null;
  leaseOwner: string;
}

interface TenantBatch {
  events: ClaimedOutboxEvent[];
  oldestUnpublishedAt: Date | null;
}

interface OutboxEventPayload extends Record<string, unknown> {
  followerId?: unknown;
  userId?: unknown;
  subscriptionId?: unknown;
  executionId?: unknown;
  traderId?: unknown;
  strategyId?: unknown;
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  status?: unknown;
  reasonCode?: unknown;
}

function asPayload(value: unknown): OutboxEventPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OUTBOX_PAYLOAD_NOT_OBJECT');
  }
  return value as OutboxEventPayload;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function outboxRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const exponent = Math.min(safeAttempt - 1, 20);
  return Math.min(1_000 * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/**
 * API-process relay for tenant-scoped domain events. Claims commit before any
 * side effect, and each side effect uses the outbox event's stable identity.
 * A process crash after one destination accepted the event therefore retries
 * safely: webhook projection uses deterministic event/delivery keys and the
 * in-app notification has a unique (tenant, source event, recipient) key.
 *
 * Only the oldest unpublished row for an aggregate is claimable. A DEAD row
 * intentionally blocks later rows for that aggregate until an operator
 * repairs or explicitly replays it; later lifecycle events cannot silently
 * overtake a quarantined predecessor.
 */
@Injectable()
export class OutboxRelayProcessor {
  private readonly logger = new Logger(OutboxRelayProcessor.name);
  private readonly leaseOwner = randomUUID();
  private running = false;
  private tenantIds: string[] = [];
  private tenantCursor = 0;
  private tenantCacheExpiresAt = 0;
  private readonly lagByTenant = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: EventSubscriptionService,
    private readonly notifications: CopyTradingNotificationProcessor,
    private readonly metrics: MetricsRegistry,
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.relayOnce();
    } catch (error) {
      this.logger.error(
        `Outbox relay cycle failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      this.metrics.inc('wlct_outbox_failed_total', {});
    } finally {
      this.running = false;
    }
  }

  /** Public for a deterministic worker-level test and controlled one-shot runs. */
  async relayOnce(): Promise<number> {
    const tenantIds = await this.nextTenantIds();
    let processed = 0;

    for (const tenantId of tenantIds) {
      const batch = await this.claimBatch(tenantId);
      this.recordLag(tenantId, batch.oldestUnpublishedAt);
      for (const event of batch.events) {
        await this.deliverOne(event);
        processed += 1;
      }
    }

    return processed;
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
      this.tenantCursor = this.tenantIds.length === 0 ? 0 : this.tenantCursor % this.tenantIds.length;
    }

    if (this.tenantIds.length === 0) return [];
    const count = Math.min(TENANT_BATCH_SIZE, this.tenantIds.length);
    const batch: string[] = [];
    for (let index = 0; index < count; index += 1) {
      batch.push(this.tenantIds[(this.tenantCursor + index) % this.tenantIds.length] as string);
    }
    this.tenantCursor = (this.tenantCursor + count) % this.tenantIds.length;
    return batch;
  }

  private async claimBatch(tenantId: string): Promise<TenantBatch> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const events = await tx.$queryRaw<ClaimedOutboxEvent[]>`
        WITH candidates AS (
          SELECT candidate."id"
          FROM "outbox_events" AS candidate
          WHERE candidate."tenant_id" = ${tenantId}::uuid
            AND (
              (candidate."status" = 'PENDING' AND candidate."available_at" <= CURRENT_TIMESTAMP)
              OR
              (candidate."status" = 'PROCESSING' AND candidate."lease_expires_at" <= CURRENT_TIMESTAMP)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "outbox_events" AS earlier
              WHERE earlier."tenant_id" = candidate."tenant_id"
                AND earlier."aggregate_type" = candidate."aggregate_type"
                AND earlier."aggregate_id" = candidate."aggregate_id"
                AND earlier."status" <> 'PUBLISHED'
                AND earlier."aggregate_sequence" < candidate."aggregate_sequence"
            )
          ORDER BY candidate."available_at" ASC, candidate."created_at" ASC, candidate."id" ASC
          LIMIT ${EVENT_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "outbox_events" AS event
        SET "status" = 'PROCESSING',
            "attempts" = event."attempts" + 1,
            "lease_owner" = ${this.leaseOwner},
            "lease_expires_at" = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond'),
            "updated_at" = CURRENT_TIMESTAMP
        FROM candidates
        WHERE event."id" = candidates."id"
          AND event."tenant_id" = ${tenantId}::uuid
        RETURNING
          event."id",
          event."tenant_id" AS "tenantId",
          event."aggregate_type" AS "aggregateType",
          event."aggregate_id" AS "aggregateId",
          event."event_type" AS "eventType",
          event."payload",
          event."attempts",
          event."available_at" AS "availableAt",
          event."created_at" AS "createdAt",
          event."correlation_id" AS "correlationId",
          event."lease_owner" AS "leaseOwner"
      `;
      const oldest = await tx.outboxEvent.findFirst({
        where: { tenantId, status: { not: 'PUBLISHED' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { createdAt: true },
      });
      return { events, oldestUnpublishedAt: oldest?.createdAt ?? null };
    });
  }

  private async deliverOne(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.dispatch(event);
      const result = await this.prisma.withTenantRls(event.tenantId, (tx) =>
        tx.outboxEvent.updateMany({
          where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', leaseOwner: this.leaseOwner },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: new Date(),
          },
        }),
      );
      if (result.count !== 1) {
        throw new Error('OUTBOX_LEASE_LOST_BEFORE_PUBLISH_COMMIT');
      }
      this.metrics.inc('wlct_outbox_published_total', {});
    } catch (error) {
      await this.retryOrDeadLetter(event, error);
    }
  }

  private async dispatch(event: ClaimedOutboxEvent): Promise<void> {
    const definition = eventDefinition(event.eventType);
    if (!definition) {
      throw new Error('OUTBOX_EVENT_TYPE_NOT_IN_CATALOG');
    }

    const payload = asPayload(event.payload);
    const correlationId = event.correlationId ?? event.id;
    const projection = this.subscriptions.projectEvent({
      tenantId: event.tenantId,
      source: definition.source,
      eventType: event.eventType,
      domainRecordId: event.aggregateId,
      outboxEventId: event.id,
      occurredAt: event.createdAt,
      correlationId,
      payload,
    });
    const notification = this.notificationFor(event, payload);

    // If one destination succeeds and the other fails, the relay retries both.
    // Each destination is idempotent, so this is at-least-once transport with
    // exactly one durable logical delivery per destination.
    await Promise.all([
      projection,
      notification === null
        ? Promise.resolve(undefined)
        : this.notifications.emitCopyTradingNotification(notification),
    ]);
  }

  private notificationFor(
    event: ClaimedOutboxEvent,
    payload: OutboxEventPayload,
  ): {
    tenantId: string;
    userId: string;
    sourceEventId: string;
    eventType: CopyTradingNotificationEventType;
    subscriptionId?: string;
    executionId?: string;
    symbol?: string;
    reason?: string;
    metadata: Record<string, unknown>;
  } | null {
    const userId = nonEmptyString(payload.userId) ?? nonEmptyString(payload.followerId);
    if (userId === null) return null;

    let eventType: CopyTradingNotificationEventType;
    switch (event.eventType) {
      case 'copy.execution.filled':
        eventType = 'COPY_EXECUTION_FILLED';
        break;
      case 'copy.execution.failed':
        eventType = 'COPY_EXECUTION_FAILED';
        break;
      case 'copy.execution.skipped':
        eventType = 'COPY_EXECUTION_SKIPPED';
        break;
      case 'copy.subscription.created':
        eventType = 'COPY_SUBSCRIPTION_CREATED';
        break;
      case 'copy.subscription.paused':
        eventType = 'COPY_SUBSCRIPTION_PAUSED';
        break;
      case 'copy.subscription.resumed':
        eventType = 'COPY_SUBSCRIPTION_RESUMED';
        break;
      case 'copy.subscription.stopped':
        eventType = 'COPY_SUBSCRIPTION_STOPPED';
        break;
      case 'copy.subscription.cancelled':
        eventType = 'COPY_SUBSCRIPTION_CANCELLED';
        break;
      default:
        return null;
    }

    const subscriptionId = nonEmptyString(payload.subscriptionId);
    const executionId = nonEmptyString(payload.executionId);
    const symbol = nonEmptyString(payload.symbol);
    const reasonCode = nonEmptyString(payload.reasonCode);
    const metadata: Record<string, unknown> = {
      aggregateId: event.aggregateId,
      eventType: event.eventType,
    };
    const status = nonEmptyString(payload.status);
    if (status !== null) metadata.status = status;
    const side = nonEmptyString(payload.side);
    if (side !== null) metadata.side = side;
    const quantity = nonEmptyString(payload.quantity);
    if (quantity !== null) metadata.quantity = quantity;
    if (reasonCode !== null) metadata.reasonCode = reasonCode;

    return {
      tenantId: event.tenantId,
      userId,
      sourceEventId: event.id,
      eventType,
      ...(subscriptionId === null ? {} : { subscriptionId }),
      ...(executionId === null ? {} : { executionId }),
      ...(symbol === null ? {} : { symbol }),
      ...(reasonCode === null ? {} : { reason: reasonCode }),
      metadata,
    };
  }

  private async retryOrDeadLetter(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
    const dead = event.attempts >= MAX_ATTEMPTS;
    const errorCode = this.safeErrorCode(error);
    const now = Date.now();
    const result = await this.prisma.withTenantRls(event.tenantId, (tx) =>
      tx.outboxEvent.updateMany({
        where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', leaseOwner: this.leaseOwner },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          availableAt: dead ? event.availableAt : new Date(now + outboxRetryDelayMs(event.attempts)),
          publishedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          updatedAt: new Date(now),
        },
      }),
    );

    this.metrics.inc('wlct_outbox_failed_total', {});
    this.logger.warn(
      {
        event: dead ? 'outbox.dead_lettered' : 'outbox.retry_scheduled',
        tenantId: event.tenantId,
        outboxEventId: event.id,
        attempts: event.attempts,
        errorCode,
        updated: result.count === 1,
      },
      dead ? 'Outbox event moved to dead-letter state' : 'Outbox event retry scheduled',
    );
  }

  private safeErrorCode(error: unknown): string {
    const candidate = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
    const safe = candidate.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
    return safe.length > 0 ? safe : 'OUTBOX_RELAY_FAILURE';
  }

  private recordLag(tenantId: string, oldestUnpublishedAt: Date | null): void {
    if (oldestUnpublishedAt === null) {
      this.lagByTenant.delete(tenantId);
    } else {
      this.lagByTenant.set(
        tenantId,
        Math.max(0, (Date.now() - oldestUnpublishedAt.getTime()) / 1_000),
      );
    }
    const maxLag = this.lagByTenant.size === 0 ? 0 : Math.max(...this.lagByTenant.values());
    this.metrics.setGauge('wlct_outbox_lag_seconds', {}, maxLag);
  }
}
