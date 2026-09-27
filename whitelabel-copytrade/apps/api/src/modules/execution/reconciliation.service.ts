import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import {
  toReconciliationDiscrepancyView,
  toReconciliationRunView,
  type ReconciliationDiscrepancyRow,
  type ReconciliationRunRow,
} from './execution.mapper';
import type {
  ReconciliationDiscrepancyView,
  ReconciliationRunView,
} from './execution.types';

/**
 * Reconciliation runs and their findings.
 *
 * The governing rule of this whole subsystem shows up here as an API shape: a
 * discrepancy can be marked reviewed, but its recorded facts can never be
 * edited, and marking it reviewed does not change any order, balance or
 * position. Resolution is an assertion by a named human that they looked at a
 * disagreement and decided what it meant. If local state genuinely needs to
 * change, that is a separate, separately audited action.
 *
 * The reason is simple. Once an operator can "fix" a discrepancy by clicking a
 * button, the button gets clicked to clear the dashboard, and the dashboard
 * stops meaning anything.
 */
@Injectable()
export class ReconciliationService {
  private static readonly RUN_SELECT = {
    id: true,
    accountId: true,
    venue: true,
    status: true,
    trigger: true,
    startedAt: true,
    finishedAt: true,
    durationMicros: true,
    ordersChecked: true,
    fillsRecovered: true,
    discrepanciesFound: true,
    discrepanciesRepaired: true,
    error: true,
    workerId: true,
  } satisfies Prisma.ReconciliationRunSelect;

  private static readonly DISCREPANCY_SELECT = {
    id: true,
    runId: true,
    orderId: true,
    clientOrderId: true,
    symbol: true,
    discrepancyType: true,
    localValue: true,
    venueValue: true,
    summary: true,
    repaired: true,
    detectedAtMicros: true,
    createdAt: true,
  } satisfies Prisma.ReconciliationDiscrepancySelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(ReconciliationService.name) private readonly logger: PinoLogger,
  ) {}

  async listRuns(filter: {
    tenantId: string;
    accountId?: string;
    status?: string;
    page?: number;
    limit?: number;
    sortOrder?: string;
  }): Promise<PaginatedResult<ReconciliationRunView>> {
    const pagination = normalisePagination(filter, ['startedAt', 'finishedAt']);

    const where: Prisma.ReconciliationRunWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.reconciliationRun.findMany({
        where,
        select: ReconciliationService.RUN_SELECT,
        orderBy: { startedAt: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reconciliationRun.count({ where }),
    ]);

    return {
      items: rows.map((row) => toReconciliationRunView(row as ReconciliationRunRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async getRun(tenantId: string, runId: string): Promise<ReconciliationRunView> {
    const run = await this.prisma.reconciliationRun.findFirst({
      where: { id: runId, tenantId },
      select: ReconciliationService.RUN_SELECT,
    });

    if (!run) {
      throw new NotFoundException('Reconciliation run not found.');
    }

    return toReconciliationRunView(run as ReconciliationRunRow);
  }

  async listDiscrepancies(filter: {
    tenantId: string;
    runId?: string;
    accountId?: string;
    orderId?: string;
    discrepancyType?: string;
    /** Defaults to unreviewed only: the dashboard's default question. */
    includeRepaired?: boolean;
    page?: number;
    limit?: number;
    sortOrder?: string;
  }): Promise<PaginatedResult<ReconciliationDiscrepancyView>> {
    const pagination = normalisePagination(filter, ['createdAt', 'detectedAtMicros']);

    const where: Prisma.ReconciliationDiscrepancyWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.runId ? { runId: filter.runId } : {}),
      ...(filter.orderId ? { orderId: filter.orderId } : {}),
      ...(filter.accountId ? { run: { accountId: filter.accountId } } : {}),
      ...(filter.discrepancyType ? { discrepancyType: filter.discrepancyType as never } : {}),
      ...(filter.includeRepaired ? {} : { repaired: false }),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.reconciliationDiscrepancy.findMany({
        where,
        select: ReconciliationService.DISCREPANCY_SELECT,
        orderBy: { createdAt: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reconciliationDiscrepancy.count({ where }),
    ]);

    return {
      items: rows.map((row) =>
        toReconciliationDiscrepancyView(row as ReconciliationDiscrepancyRow),
      ),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  /**
   * Records that a human reviewed a discrepancy and accepted it.
   *
   * Note what this does not do: it does not touch the order, the balance or the
   * position the discrepancy was about. It sets `repaired = true` on the
   * discrepancy row - meaning "closed", not "corrected" - and writes an audit
   * record naming who closed it and why. The `summary`, `localValue` and
   * `venueValue` fields are never modified, so the original disagreement stays
   * readable forever.
   */
  async resolveDiscrepancy(
    tenantId: string,
    discrepancyId: string,
    actor: { userId: string; requestId?: string | null },
    note: string,
  ): Promise<ReconciliationDiscrepancyView> {
    const existing = await this.prisma.reconciliationDiscrepancy.findFirst({
      where: { id: discrepancyId, tenantId },
      select: ReconciliationService.DISCREPANCY_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Reconciliation discrepancy not found.');
    }

    if (existing.repaired) {
      throw new ConflictException('This discrepancy has already been closed.');
    }

    const updated = await this.prisma.reconciliationDiscrepancy.update({
      where: { id: discrepancyId },
      data: { repaired: true },
      select: ReconciliationService.DISCREPANCY_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.RECONCILIATION_DISCREPANCY_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'reconciliation_discrepancy',
      resourceId: discrepancyId,
      description: sanitiseForLog(note, 500),
      metadata: {
        discrepancyType: existing.discrepancyType,
        orderId: existing.orderId,
        clientOrderId: existing.clientOrderId,
        localValue: existing.localValue,
        venueValue: existing.venueValue,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.warn(
      {
        event: 'execution.discrepancy_closed',
        tenantId,
        discrepancyId,
        discrepancyType: existing.discrepancyType,
        actorId: actor.userId,
      },
      'Reconciliation discrepancy closed by operator review',
    );

    return toReconciliationDiscrepancyView(updated as ReconciliationDiscrepancyRow);
  }

  /** Writes the audit record for an operator-initiated reconciliation pass. */
  async recordManualTrigger(
    tenantId: string,
    accountId: string,
    actor: { userId: string; requestId?: string | null },
    jobId: string,
  ): Promise<void> {
    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.RECONCILIATION_TRIGGERED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'trading_account',
      resourceId: accountId,
      description: 'Manual reconciliation pass requested.',
      metadata: { jobId, trigger: 'MANUAL' },
      requestId: actor.requestId ?? null,
    });
  }
}
