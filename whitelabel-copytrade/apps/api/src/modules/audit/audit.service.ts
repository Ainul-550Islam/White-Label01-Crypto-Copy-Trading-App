import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { redact, sanitiseForLog } from '@wlct/utils';
import type { PaginatedResult } from '@wlct/shared-types';

import { AuditRepository } from './audit.repository';
import type { AuditLogEntity, AuditRecordInput, ListAuditLogsFilter } from './audit.types';

/**
 * Buffered, non-blocking audit writer.
 *
 * Audit records must never slow down or fail a business operation, but they
 * also must not be lost. The service batches inserts on a short interval and
 * flushes synchronously on shutdown; every payload passes through `redact()`
 * so secrets can never enter the trail even if a caller passes a whole DTO.
 */
@Injectable()
export class AuditService implements OnApplicationShutdown {
  private static readonly FLUSH_INTERVAL_MS = 1_000;
  private static readonly MAX_BUFFER = 200;

  private buffer: AuditRecordInput[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly repository: AuditRepository,
    @InjectPinoLogger(AuditService.name) private readonly logger: PinoLogger,
  ) {
    this.timer = setInterval(() => {
      void this.flush();
    }, AuditService.FLUSH_INTERVAL_MS);
    // Do not keep the event loop alive purely for the audit flusher.
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Queues an audit record. Never throws into the caller's control flow. */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      this.buffer.push({
        ...input,
        description: input.description ? sanitiseForLog(input.description, 500) : null,
        changes: input.changes ? redact(input.changes) : null,
        metadata: input.metadata ? redact(input.metadata) : null,
      });

      if (this.buffer.length >= AuditService.MAX_BUFFER) {
        await this.flush();
      }
    } catch (error) {
      this.logger.error(
        { event: 'audit.enqueue_failed', action: input.action, message: (error as Error).message },
        'Failed to enqueue audit record',
      );
    }
  }

  /** Writes a record immediately; used for security-critical events. */
  async recordImmediate(input: AuditRecordInput): Promise<void> {
    try {
      await this.repository.createMany([
        {
          tenantId: input.tenantId,
          actorType: input.actorType,
          actorId: input.actorId,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          outcome: input.outcome,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          description: input.description ? sanitiseForLog(input.description, 500) : null,
          changes: input.changes ? (redact(input.changes) as object) : undefined,
          metadata: input.metadata ? (redact(input.metadata) as object) : undefined,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
          requestId: input.requestId ?? null,
          correlationId: input.correlationId ?? null,
          operationId: input.operationId ?? null,
        },
      ]);
    } catch (error) {
      this.logger.error(
        { event: 'audit.write_failed', action: input.action, message: (error as Error).message },
        'Failed to write audit record',
      );
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const pending = this.buffer;
    this.buffer = [];

    try {
      await this.repository.createMany(
        pending.map((input) => ({
          tenantId: input.tenantId,
          actorType: input.actorType,
          actorId: input.actorId,
          actorEmail: input.actorEmail ?? null,
          action: input.action,
          outcome: input.outcome,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          description: input.description ?? null,
          changes: (input.changes as object) ?? undefined,
          metadata: (input.metadata as object) ?? undefined,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent ?? null,
          requestId: input.requestId ?? null,
          correlationId: input.correlationId ?? null,
          operationId: input.operationId ?? null,
        })),
      );
    } catch (error) {
      this.logger.error(
        { event: 'audit.flush_failed', count: pending.length, message: (error as Error).message },
        'Failed to flush audit buffer',
      );
    }
  }

  async list(filter: ListAuditLogsFilter): Promise<PaginatedResult<AuditLogEntity>> {
    return this.repository.list(filter);
  }
}
