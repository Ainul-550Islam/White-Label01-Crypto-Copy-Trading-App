import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  SecuritySeverity,
  type SecurityEventType,
  type PaginatedResult,
} from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, redact, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface SecurityEventInput {
  tenantId: string | null;
  userId?: string | null;
  type: SecurityEventType;
  severity: SecuritySeverity;
  description: string;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ListSecurityEventsFilter {
  tenantId?: string;
  userId?: string;
  type?: SecurityEventType;
  severity?: SecuritySeverity;
  resolved?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
}

const SORTABLE_FIELDS = ['createdAt', 'severity', 'type'] as const;

/**
 * Records security-relevant events and exposes them for compliance review.
 *
 * High and critical events are additionally logged at warn/error level so they
 * reach the alerting pipeline immediately rather than waiting for someone to
 * open the dashboard.
 */
@Injectable()
export class SecurityEventsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SecurityEventsService.name) private readonly logger: PinoLogger,
  ) {}

  async record(input: SecurityEventInput): Promise<void> {
    const payload = {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      type: input.type,
      severity: input.severity,
      description: sanitiseForLog(input.description, 500),
      metadata: input.metadata ? (redact(input.metadata) as object) : undefined,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
      requestId: input.requestId ?? null,
    };

    try {
      await this.prisma.securityEvent.create({ data: payload });
    } catch (error) {
      this.logger.error(
        { event: 'security.persist_failed', type: input.type, message: (error as Error).message },
        'Failed to persist security event',
      );
    }

    const logPayload = {
      event: 'security.event',
      type: input.type,
      severity: input.severity,
      tenantId: input.tenantId,
      userId: input.userId,
      requestId: input.requestId,
    };

    if (input.severity === SecuritySeverity.CRITICAL) {
      this.logger.error(logPayload, input.description);
    } else if (input.severity === SecuritySeverity.HIGH) {
      this.logger.warn(logPayload, input.description);
    } else {
      this.logger.info(logPayload, input.description);
    }
  }

  async list(filter: ListSecurityEventsFilter): Promise<PaginatedResult<unknown>> {
    const pagination = normalisePagination(filter, SORTABLE_FIELDS);

    const where: Prisma.SecurityEventWhereInput = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.resolved !== undefined ? { resolved: filter.resolved } : {}),
      ...(pagination.search
        ? { description: { contains: pagination.search, mode: 'insensitive' } }
        : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);

    return {
      items,
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async resolve(
    tenantId: string,
    eventId: string,
    resolvedById: string,
    resolution: string,
  ): Promise<void> {
    await this.prisma.securityEvent.updateMany({
      where: { id: eventId, tenantId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById,
        resolution: sanitiseForLog(resolution, 500),
      },
    });
  }
}
