import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import { toExecutionIncidentView, type ExecutionIncidentRow } from './execution.mapper';
import type { ExecutionIncidentView } from './execution.types';

export interface IncidentCounts {
  open: number;
  critical: number;
  warning: number;
  info: number;
  /** Unresolved incidents older than an hour: the ones nobody is looking at. */
  stale: number;
}

/**
 * Execution incidents: read, count, close.
 *
 * There is no `create` here. Incidents are raised by the trading worker at the
 * moment something goes wrong on the money path, with the full context that
 * only the worker has. An HTTP endpoint that let a client invent one would
 * produce a table where real and imagined incidents are indistinguishable.
 *
 * Closing is the only mutation, and it is append-only in spirit: `resolvedAt`,
 * `resolvedBy` and `resolutionNote` are filled in, and nothing that describes
 * what happened is ever touched.
 */
@Injectable()
export class ExecutionIncidentsService {
  private static readonly INCIDENT_SELECT = {
    id: true,
    accountId: true,
    orderId: true,
    clientOrderId: true,
    incidentType: true,
    severity: true,
    venue: true,
    symbol: true,
    errorCode: true,
    summary: true,
    details: true,
    occurredAtMicros: true,
    resolvedAt: true,
    resolvedBy: true,
    resolutionNote: true,
    notifiedAt: true,
    createdAt: true,
  } satisfies Prisma.ExecutionIncidentSelect;

  private static readonly STALE_AFTER_MS = 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(ExecutionIncidentsService.name) private readonly logger: PinoLogger,
  ) {}

  async list(filter: {
    tenantId: string;
    accountId?: string;
    orderId?: string;
    incidentType?: string;
    severity?: string;
    /** Defaults to unresolved only. */
    includeResolved?: boolean;
    page?: number;
    limit?: number;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<ExecutionIncidentView>> {
    const pagination = normalisePagination(filter, ['createdAt', 'severity']);

    const where: Prisma.ExecutionIncidentWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.orderId ? { orderId: filter.orderId } : {}),
      ...(filter.incidentType ? { incidentType: filter.incidentType as never } : {}),
      ...(filter.severity ? { severity: filter.severity as never } : {}),
      ...(filter.includeResolved ? {} : { resolvedAt: null }),
      ...(pagination.search
        ? { summary: { contains: pagination.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.executionIncident.findMany({
        where,
        select: ExecutionIncidentsService.INCIDENT_SELECT,
        // Severity first, then recency. An operator opening this list wants the
        // CRITICAL from twenty minutes ago above the INFO from twenty seconds
        // ago, which a pure timestamp sort would bury.
        orderBy: [{ severity: 'desc' }, { createdAt: pagination.sortOrder }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.executionIncident.count({ where }),
    ]);

    return {
      items: rows.map((row) => toExecutionIncidentView(row as ExecutionIncidentRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async get(tenantId: string, incidentId: string): Promise<ExecutionIncidentView> {
    const incident = await this.prisma.executionIncident.findFirst({
      where: { id: incidentId, tenantId },
      select: ExecutionIncidentsService.INCIDENT_SELECT,
    });

    if (!incident) {
      throw new NotFoundException('Execution incident not found.');
    }

    return toExecutionIncidentView(incident as ExecutionIncidentRow);
  }

  async counts(tenantId: string, accountId?: string): Promise<IncidentCounts> {
    const base: Prisma.ExecutionIncidentWhereInput = {
      tenantId,
      resolvedAt: null,
      ...(accountId ? { accountId } : {}),
    };

    const staleBefore = new Date(Date.now() - ExecutionIncidentsService.STALE_AFTER_MS);

    const [open, critical, warning, info, stale] = await this.prisma.$transaction([
      this.prisma.executionIncident.count({ where: base }),
      this.prisma.executionIncident.count({ where: { ...base, severity: 'CRITICAL' } }),
      this.prisma.executionIncident.count({ where: { ...base, severity: 'WARNING' } }),
      this.prisma.executionIncident.count({ where: { ...base, severity: 'INFO' } }),
      this.prisma.executionIncident.count({
        where: { ...base, createdAt: { lt: staleBefore } },
      }),
    ]);

    return { open, critical, warning, info, stale };
  }

  async resolve(
    tenantId: string,
    incidentId: string,
    actor: { userId: string; requestId?: string | null },
    note: string,
  ): Promise<ExecutionIncidentView> {
    const existing = await this.prisma.executionIncident.findFirst({
      where: { id: incidentId, tenantId },
      select: ExecutionIncidentsService.INCIDENT_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Execution incident not found.');
    }

    if (existing.resolvedAt !== null) {
      throw new ConflictException('This incident has already been resolved.');
    }

    const updated = await this.prisma.executionIncident.update({
      where: { id: incidentId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: actor.userId,
        resolutionNote: sanitiseForLog(note, 1000),
      },
      select: ExecutionIncidentsService.INCIDENT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.EXECUTION_INCIDENT_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'execution_incident',
      resourceId: incidentId,
      description: sanitiseForLog(note, 500),
      metadata: {
        incidentType: existing.incidentType,
        severity: existing.severity,
        errorCode: existing.errorCode,
        orderId: existing.orderId,
        accountId: existing.accountId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'execution.incident_resolved',
        tenantId,
        incidentId,
        incidentType: existing.incidentType,
        severity: existing.severity,
        actorId: actor.userId,
      },
      'Execution incident resolved',
    );

    return toExecutionIncidentView(updated as ExecutionIncidentRow);
  }
}
