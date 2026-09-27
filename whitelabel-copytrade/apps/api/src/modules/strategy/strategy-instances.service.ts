import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import {
  toStrategyInstanceView,
  toStrategyRunView,
  type StrategyInstanceRow,
  type StrategyRunRow,
} from './strategy.mapper';
import type {
  StrategyCommandAcceptedView,
  StrategyInstanceStatusView,
  StrategyInstanceView,
  StrategyRunView,
} from './strategy.types';

/**
 * Strategy instances: read, inspect, start, stop.
 *
 * Three properties are enforced here rather than left to the caller.
 *
 * 1. **Starting a strategy is not starting live trading.** Enabling an
 *    instance makes it consume market data and emit signals. Whether a signal
 *    becomes an order is decided afterwards by the risk engine and the Part 5
 *    gates, which this service does not touch. When the deployment happens to
 *    be armed for LIVE execution, enabling additionally requires an explicit
 *    confirmation string, because that is the one configuration in which an
 *    automated decision can reach a venue.
 *
 * 2. **Stopping is always allowed.** No confirmation, a short reason, and a
 *    local status change that does not wait for the worker. A stop request
 *    that has to negotiate with a queue is a stop request that arrives too
 *    late.
 *
 * 3. **The API does not run strategies.** It records intent and queues work
 *    for the strategy worker. There is no code path from an HTTP request to a
 *    strategy tick, which is what keeps a slow or hostile request from
 *    entering the data plane.
 */
@Injectable()
export class StrategyInstancesService {
  /** The exact phrase required to enable an instance under LIVE execution. */
  public static readonly LIVE_CONFIRMATION = 'ENABLE STRATEGY IN LIVE MODE';

  private static readonly INSTANCE_SELECT = {
    id: true,
    tenantId: true,
    accountId: true,
    name: true,
    kind: true,
    version: true,
    definitionId: true,
    versionId: true,
    instanceKey: true,
    configVersion: true,
    status: true,
    enabled: true,
    health: true,
    failurePolicy: true,
    venue: true,
    symbols: true,
    marketType: true,
    description: true,
    maxOrderQuantity: true,
    maxPositionQuantity: true,
    maxOrderNotional: true,
    maxDailyLoss: true,
    maxOpenOrders: true,
    maxOrdersPerMinute: true,
    consecutiveErrors: true,
    lastHeartbeatAt: true,
    lastStartedAt: true,
    lastStoppedAt: true,
    lastErrorCode: true,
    quarantinedAt: true,
    quarantineReason: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.StrategySelect;

  private static readonly RUN_SELECT = {
    id: true,
    strategyId: true,
    runMode: true,
    status: true,
    instanceKey: true,
    configVersion: true,
    strategyKey: true,
    strategyVersion: true,
    venue: true,
    symbols: true,
    marketType: true,
    startedAt: true,
    stoppedAt: true,
    stopReason: true,
    errorCode: true,
    counters: true,
    lastEventAtMicros: true,
  } satisfies Prisma.StrategyRunSelect;

  private static readonly SORTABLE_FIELDS = [
    'createdAt',
    'updatedAt',
    'name',
    'lastStartedAt',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(StrategyInstancesService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    health?: string;
    venue?: string;
    enabledOnly?: boolean;
    definitionId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<StrategyInstanceView>> {
    const pagination = normalisePagination(filter, StrategyInstancesService.SORTABLE_FIELDS);

    const where: Prisma.StrategyWhereInput = {
      tenantId: filter.tenantId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.health ? { health: filter.health as never } : {}),
      ...(filter.venue ? { venue: filter.venue as never } : {}),
      ...(filter.enabledOnly ? { enabled: true } : {}),
      ...(filter.definitionId ? { definitionId: filter.definitionId } : {}),
      ...(pagination.search
        ? { name: { contains: pagination.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        select: StrategyInstancesService.INSTANCE_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategy.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyInstanceView(row as StrategyInstanceRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, id: string): Promise<StrategyInstanceView> {
    return toStrategyInstanceView(await this.requireInstance(tenantId, id));
  }

  /**
   * Everything an operator needs in one call, including the two facts that are
   * easiest to assume wrongly: whether the engine is running at all, and
   * whether live execution is reachable.
   */
  async getStatus(tenantId: string, id: string): Promise<StrategyInstanceStatusView> {
    const instance = await this.requireInstance(tenantId, id);

    const [currentRun, openIncidents, criticalIncidents, lastCheckpoint] = await Promise.all([
      this.prisma.strategyRun.findFirst({
        where: { tenantId, strategyId: id, status: { in: ['STARTING', 'RUNNING'] } },
        select: StrategyInstancesService.RUN_SELECT,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, strategyId: id, resolvedAt: null },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, strategyId: id, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyCheckpoint.findFirst({
        where: { tenantId, strategyId: id },
        select: { createdAt: true },
        orderBy: { sequence: 'desc' },
      }),
    ]);

    return {
      instance: toStrategyInstanceView(instance),
      currentRun: currentRun ? toStrategyRunView(currentRun as StrategyRunRow) : null,
      openIncidents,
      criticalIncidents,
      lastCheckpointAt: lastCheckpoint ? lastCheckpoint.createdAt.toISOString() : null,
      engineEnabled: this.config.strategyEngineEnabled,
      tradingMode: this.config.tradingMode,
      liveExecutionReachable: this.config.tradingMode === 'LIVE',
    };
  }

  async listRuns(
    tenantId: string,
    id: string,
    filter: { status?: string; page?: number; limit?: number; sortOrder?: string },
  ): Promise<PaginatedResult<StrategyRunView>> {
    await this.requireInstance(tenantId, id);
    const pagination = normalisePagination(filter, ['startedAt']);

    const where: Prisma.StrategyRunWhereInput = {
      tenantId,
      strategyId: id,
      ...(filter.status ? { status: filter.status as never } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyRun.findMany({
        where,
        select: StrategyInstancesService.RUN_SELECT,
        orderBy: { startedAt: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyRun.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyRunView(row as StrategyRunRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async enable(
    tenantId: string,
    id: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string; confirmation?: string },
  ): Promise<StrategyCommandAcceptedView> {
    const instance = await this.requireInstance(tenantId, id);

    if (!this.config.strategyEngineEnabled) {
      throw new ConflictException(
        'The strategy engine is disabled in this deployment (STRATEGY_ENGINE_ENABLED=false). ' +
          'Enabling an instance now would record a state the engine will never act on.',
        { strategyEngineEnabled: false },
      );
    }

    if (instance.quarantinedAt !== null) {
      throw new ConflictException(
        'This instance is quarantined after a failure and cannot be started until the ' +
          'quarantine is cleared. Starting a strategy whose state is not trusted is exactly ' +
          'what the quarantine exists to prevent.',
      );
    }

    if (instance.enabled) {
      throw new ConflictException('This strategy instance is already enabled.');
    }

    if (instance.versionId === null) {
      throw new ValidationException([
        {
          field: 'versionId',
          constraint: 'required',
          message:
            'This instance is not bound to a published strategy version. Behaviour that is ' +
            'not pinned to a version can change underneath a running strategy.',
        },
      ]);
    }

    // The one place where enabling a strategy could lead to a real order.
    // Everywhere else the answer is structural; here it is a deliberate,
    // typed-out confirmation.
    if (this.config.tradingMode === 'LIVE') {
      if (input.confirmation !== StrategyInstancesService.LIVE_CONFIRMATION) {
        throw new ValidationException([
          {
            field: 'confirmation',
            constraint: 'exactPhrase',
            message:
              'This deployment is armed for LIVE execution. To start a strategy under it, ' +
              `send confirmation: "${StrategyInstancesService.LIVE_CONFIRMATION}". Signals ` +
              'from this instance will be evaluated by the risk engine and may become real ' +
              'orders.',
          },
        ]);
      }
    }

    const version = await this.prisma.strategyVersion.findFirst({
      where: { id: instance.versionId },
      select: { status: true, version: true },
    });

    if (!version || version.status === 'DRAFT' || version.status === 'DISABLED') {
      throw new ValidationException([
        {
          field: 'versionId',
          constraint: 'notRunnable',
          message:
            'The strategy version bound to this instance is not runnable. Publish it, or bind ' +
            'the instance to a published version.',
        },
      ]);
    }

    const jobId = await this.dispatch(JOB_NAMES.APPLY_STRATEGY_STATE, {
      tenantId,
      strategyId: id,
      desiredState: 'ENABLED',
      requestedByUserId: actor.userId,
      reason: sanitiseForLog(input.reason, 500),
    });

    await this.prisma.strategy.update({
      where: { id },
      data: { enabled: true, status: 'ENABLED', lastStartedAt: new Date() },
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INSTANCE_ENABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_instance',
      resourceId: id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        venue: instance.venue,
        symbols: instance.symbols,
        tradingMode: this.config.tradingMode,
        liveExecutionReachable: this.config.tradingMode === 'LIVE',
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.instance_enabled',
        tenantId,
        strategyId: id,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        tradingMode: this.config.tradingMode,
        actorId: actor.userId,
      },
      'Strategy instance enabled',
    );

    return {
      accepted: true,
      command: JOB_NAMES.APPLY_STRATEGY_STATE,
      jobId,
      requestedAt: new Date().toISOString(),
      note:
        'The instance is marked enabled and the strategy worker has been asked to start it. ' +
        'Starting a strategy does not enable live trading: signals are still evaluated by the ' +
        `risk engine, and the effective trading mode is ${this.config.tradingMode}.`,
    };
  }

  async disable(
    tenantId: string,
    id: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string },
  ): Promise<StrategyCommandAcceptedView> {
    const instance = await this.requireInstance(tenantId, id);

    if (!instance.enabled) {
      throw new ConflictException('This strategy instance is already disabled.');
    }

    // Note the ordering: local state is changed FIRST, and the queue dispatch
    // follows. It is the opposite of `enable`, and deliberately so. If Redis is
    // down, an operator who asked to stop a strategy must still end up with a
    // strategy that is marked stopped and will not be restarted by the next
    // reconciliation; a failure to notify is recoverable, a strategy that
    // stays enabled because a queue was unavailable is not.
    await this.prisma.strategy.update({
      where: { id },
      data: { enabled: false, status: 'DISABLED', lastStoppedAt: new Date() },
    });

    let jobId = 'not-queued';
    try {
      jobId = await this.dispatch(JOB_NAMES.APPLY_STRATEGY_STATE, {
        tenantId,
        strategyId: id,
        desiredState: 'DISABLED',
        requestedByUserId: actor.userId,
        reason: sanitiseForLog(input.reason, 500),
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'strategy.disable_dispatch_failed',
          tenantId,
          strategyId: id,
          message: (error as Error).message,
        },
        'Strategy marked disabled locally but the worker could not be notified',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INSTANCE_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_instance',
      resourceId: id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.instance_disabled',
        tenantId,
        strategyId: id,
        strategyKey: instance.kind,
        actorId: actor.userId,
      },
      'Strategy instance disabled',
    );

    return {
      accepted: true,
      command: JOB_NAMES.APPLY_STRATEGY_STATE,
      jobId,
      requestedAt: new Date().toISOString(),
      note:
        'The instance is marked disabled immediately. The worker has been asked to stop it; ' +
        'if that notification failed the instance still will not be restarted, because the ' +
        'engine only runs what is marked enabled.',
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireInstance(tenantId: string, id: string): Promise<StrategyInstanceRow> {
    const row = await this.prisma.strategy.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: StrategyInstancesService.INSTANCE_SELECT,
    });

    if (!row) {
      // Not "forbidden": a tenant must not be able to discover that an id
      // exists in another tenant by comparing 403 against 404.
      throw new NotFoundException('Strategy instance');
    }

    return row as StrategyInstanceRow;
  }

  private async dispatch(command: string, payload: Record<string, unknown>): Promise<string> {
    try {
      const jobId = await this.queue.enqueueOrThrow(QUEUE_NAMES.STRATEGY_CONTROL, command, {
        ...payload,
        requestedAt: new Date().toISOString(),
      });
      return jobId ?? 'unknown';
    } catch (error) {
      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the worker cannot be notified. ' +
          'Nothing was started.',
        (error as Error).message,
      );
    }
  }
}
