import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import { toStrategyIncidentView, type StrategyIncidentRow } from './strategy.mapper';
import type { StrategyIncidentView } from './strategy.types';

export interface StrategyIncidentCounts {
  open: number;
  critical: number;
  warning: number;
  info: number;
}

/**
 * Strategy incidents: read, count, close.
 *
 * As with execution incidents, there is no `create`. An incident is raised by
 * the strategy worker at the moment something went wrong, with context only
 * the worker has. An HTTP endpoint that let a client invent one would produce
 * a table in which real and imagined incidents are indistinguishable.
 *
 * Closing is the only mutation and it is append-only in spirit: the resolution
 * fields are filled in, and nothing describing what happened is ever edited.
 */
@Injectable()
export class StrategyIncidentsService {
  private static readonly INCIDENT_SELECT = {
    id: true,
    strategyId: true,
    runId: true,
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
    createdAt: true,
  } satisfies Prisma.StrategyIncidentSelect;

  private static readonly SORTABLE_FIELDS = ['createdAt', 'severity'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(StrategyIncidentsService.name) private readonly logger: PinoLogger,
  ) {}

  async list(filter: {
    tenantId: string;
    severity?: string;
    strategyId?: string;
    unresolvedOnly?: boolean;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<StrategyIncidentView>> {
    const pagination = normalisePagination(filter, StrategyIncidentsService.SORTABLE_FIELDS);

    const where: Prisma.StrategyIncidentWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.severity ? { severity: filter.severity as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
      ...(filter.unresolvedOnly ? { resolvedAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyIncident.findMany({
        where,
        select: StrategyIncidentsService.INCIDENT_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyIncident.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyIncidentView(row as StrategyIncidentRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async counts(tenantId: string): Promise<StrategyIncidentCounts> {
    const [open, critical, warning, info] = await Promise.all([
      this.prisma.strategyIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'WARNING' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'INFO' },
      }),
    ]);

    return { open, critical, warning, info };
  }

  async resolve(
    tenantId: string,
    incidentId: string,
    actor: { userId: string; requestId?: string | null },
    note: string,
  ): Promise<StrategyIncidentView> {
    const existing = await this.prisma.strategyIncident.findFirst({
      where: { id: incidentId, tenantId },
      select: StrategyIncidentsService.INCIDENT_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Strategy incident');
    }

    if (existing.resolvedAt !== null) {
      throw new ConflictException('This incident has already been resolved.');
    }

    const updated = await this.prisma.strategyIncident.update({
      where: { id: incidentId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: actor.userId,
        resolutionNote: sanitiseForLog(note, 1000),
      },
      select: StrategyIncidentsService.INCIDENT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INCIDENT_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_incident',
      resourceId: incidentId,
      description: sanitiseForLog(note, 500),
      metadata: {
        incidentType: existing.incidentType,
        severity: existing.severity,
        errorCode: existing.errorCode,
        strategyId: existing.strategyId,
        runId: existing.runId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.incident_resolved',
        tenantId,
        incidentId,
        incidentType: existing.incidentType,
        severity: existing.severity,
        actorId: actor.userId,
      },
      'Strategy incident resolved',
    );

    return toStrategyIncidentView(updated as StrategyIncidentRow);
  }
}
