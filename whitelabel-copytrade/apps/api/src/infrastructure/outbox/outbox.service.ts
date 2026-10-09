// # NEW — Writes domain events inside the caller's Prisma transaction
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEVELOPER_ERROR_CODES, DeveloperError, eventDefinition } from '../../modules/developer-platform/developer.types';
import { validateDeveloperEventPayload } from '../../modules/developer-platform/event-schemas/developer-event-schemas';

export interface AppendOutboxEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string | null;
  occurredAt?: Date;
}

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSequence: number;
  eventType: string;
  payload: Prisma.JsonValue;
  idempotencyKey: string;
  correlationId: string | null;
  createdAt: Date;
}

const TENANT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * The only write API for the transactional outbox.
 *
 * The caller must pass its existing interactive transaction client. This
 * class deliberately has no root PrismaService dependency and cannot silently
 * open a second transaction: the event insert and the state transition stay
 * in the same commit or both roll back. Tenant-scoped idempotency is enforced
 * by the database unique constraint and upsert, so retrying an operation
 * returns the original event rather than producing a second logical event.
 *
 * The advisory transaction lock allocates a strictly increasing sequence per
 * tenant and aggregate. It closes the timestamp-tie hole: JavaScript dates have
 * millisecond precision, so createdAt alone cannot define lifecycle order.
 */
@Injectable()
export class OutboxService {
  async append(
    tx: Prisma.TransactionClient,
    input: AppendOutboxEventInput,
  ): Promise<OutboxEventRecord> {
    this.validate(input);

    const definition = eventDefinition(input.eventType);
    if (!definition) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED,
        `outbox event type '${input.eventType}' is not registered in the developer event catalog`,
      );
    }
    const schemaResult = validateDeveloperEventPayload(input.eventType, input.payload);
    if (!schemaResult.valid) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VALIDATION,
        `outbox event '${input.eventType}' does not satisfy its v1 payload schema`,
        { eventType: input.eventType, schemaErrors: schemaResult.errors },
      );
    }

    const payloadJson = JSON.stringify(input.payload);
    if (payloadJson === undefined || Buffer.byteLength(payloadJson, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new Error('outbox payload is not JSON serializable or exceeds the 64 KiB event limit');
    }
    const payload = JSON.parse(payloadJson) as Prisma.InputJsonValue;
    const occurredAt = input.occurredAt ?? new Date();
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error('outbox occurredAt must be a valid date');
    }

    const aggregateLockKey = `${input.tenantId}:${input.aggregateType}:${input.aggregateId}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${aggregateLockKey}, 0))
    `;
    const latest = await tx.outboxEvent.aggregate({
      where: {
        tenantId: input.tenantId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
      },
      _max: { aggregateSequence: true },
    });
    const aggregateSequence = (latest._max.aggregateSequence ?? 0) + 1;
    if (!Number.isSafeInteger(aggregateSequence) || aggregateSequence < 1) {
      throw new Error('outbox aggregate sequence is exhausted or invalid');
    }

    const event = await tx.outboxEvent.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      create: {
        tenantId: input.tenantId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateSequence,
        eventType: input.eventType,
        payload,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId ?? null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      update: {},
      select: {
        id: true,
        tenantId: true,
        aggregateType: true,
        aggregateId: true,
        aggregateSequence: true,
        eventType: true,
        payload: true,
        idempotencyKey: true,
        correlationId: true,
        createdAt: true,
      },
    });

    if (
      event.aggregateType !== input.aggregateType ||
      event.aggregateId !== input.aggregateId ||
      event.eventType !== input.eventType ||
      canonicalJson(event.payload) !== canonicalJson(payload) ||
      event.correlationId !== (input.correlationId ?? null)
    ) {
      throw new Error('outbox idempotency key was reused for a different event');
    }

    return event as OutboxEventRecord;
  }

  private validate(input: AppendOutboxEventInput): void {
    if (!TENANT_UUID_PATTERN.test(input.tenantId)) {
      throw new Error('outbox tenantId must be a canonical UUID');
    }
    if (!input.aggregateType.trim() || input.aggregateType.length > 64) {
      throw new Error('outbox aggregateType must contain 1 to 64 characters');
    }
    if (!input.aggregateId.trim() || input.aggregateId.length > 128) {
      throw new Error('outbox aggregateId must contain 1 to 128 characters');
    }
    if (!EVENT_TYPE_PATTERN.test(input.eventType) || input.eventType.length > 96) {
      throw new Error('outbox eventType must be a lowercase dotted event token of at most 96 characters');
    }
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
      throw new Error('outbox idempotencyKey must contain 1 to 255 characters');
    }
    if (input.correlationId != null && input.correlationId.length > 64) {
      throw new Error('outbox correlationId must contain at most 64 characters');
    }
    if (input.payload === null || Array.isArray(input.payload) || typeof input.payload !== 'object') {
      throw new Error('outbox payload must be a JSON object');
    }
  }
}
