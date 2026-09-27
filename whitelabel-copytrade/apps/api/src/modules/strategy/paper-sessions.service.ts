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
  toPaperSessionView,
  toPaperSnapshotView,
  type PaperSessionRow,
  type PaperSnapshotRow,
} from './strategy.mapper';
import type { PaperSessionView, PaperSnapshotView } from './strategy.types';

/**
 * Paper trading sessions: start, stop, read.
 *
 * A paper session runs a real strategy against a real market feed and fills it
 * against a simulator. The prices are real; the fills are not. Everything this
 * service returns says so.
 *
 * The safety property that matters is enforced in the engine, not here: the
 * session object refuses to be constructed with an adapter that is not marked
 * simulated, so there is no object in a running session capable of reaching a
 * venue. What this service adds is the second half of that guarantee - it
 * cannot be used to start anything else. `startSession` queues exactly one job
 * name, the worker's paper entry point, and there is no parameter on it that
 * selects an execution mode.
 */
@Injectable()
export class PaperSessionsService {
  private static readonly SESSION_SELECT = {
    id: true,
    sessionIdentifier: true,
    status: true,
    strategyId: true,
    strategyKey: true,
    strategyVersion: true,
    venue: true,
    symbol: true,
    marketType: true,
    initialCapital: true,
    currentEquity: true,
    realisedPnl: true,
    unrealisedPnl: true,
    feesPaid: true,
    maxDrawdown: true,
    signalsGenerated: true,
    signalsAccepted: true,
    signalsRejected: true,
    riskRejections: true,
    simulatedOrders: true,
    simulatedFills: true,
    strategyErrors: true,
    startedAt: true,
    stoppedAt: true,
    stopReason: true,
    errorCode: true,
  } satisfies Prisma.PaperTradingSessionSelect;

  private static readonly SORTABLE_FIELDS = ['startedAt', 'stoppedAt'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(PaperSessionsService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async start(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    input: { strategyId: string; symbol: string; initialCapital?: string; reason: string },
  ): Promise<PaperSessionView> {
    if (!this.config.paperTradingEnabled) {
      throw new ConflictException(
        'Paper trading is disabled in this deployment (PAPER_TRADING_ENABLED=false).',
        { paperTradingEnabled: false },
      );
    }

    if (!this.config.strategyEngineEnabled) {
      throw new ConflictException(
        'The strategy engine is disabled (STRATEGY_ENGINE_ENABLED=false), so a paper session ' +
          'would receive no market data and make no decisions.',
        { strategyEngineEnabled: false },
      );
    }

    const instance = await this.prisma.strategy.findFirst({
      where: { id: input.strategyId, tenantId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        version: true,
        venue: true,
        symbols: true,
        marketType: true,
        quarantinedAt: true,
      },
    });

    if (!instance) {
      throw new NotFoundException('Strategy instance');
    }

    if (instance.quarantinedAt !== null) {
      throw new ConflictException(
        'This instance is quarantined after a failure. Clear the quarantine before running it, ' +
          'including on paper: a strategy whose state is not trusted produces results that are ' +
          'not worth reading.',
      );
    }

    if (!instance.symbols.includes(input.symbol)) {
      throw new ValidationException([
        {
          field: 'symbol',
          constraint: 'notSubscribed',
          message: `This instance is not configured for ${input.symbol}.`,
        },
      ]);
    }

    const running = await this.prisma.paperTradingSession.findFirst({
      where: {
        tenantId,
        strategyId: input.strategyId,
        symbol: input.symbol,
        status: { in: ['STARTING', 'RUNNING'] },
      },
      select: { id: true },
    });

    if (running) {
      throw new ConflictException(
        'A paper session is already running for this instance and symbol. Two sessions on one ' +
          'instance would share the strategy state and produce two sets of numbers that ' +
          'describe neither.',
        { sessionId: running.id },
      );
    }

    const initialCapital = input.initialCapital ?? this.config.backtestDefaults.initialCapital;

    if (Number.parseFloat(initialCapital) <= 0) {
      throw new ValidationException([
        {
          field: 'initialCapital',
          constraint: 'positive',
          message: 'initialCapital must be greater than zero.',
        },
      ]);
    }

    const sessionIdentifier = `paper-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const created = await this.prisma.paperTradingSession.create({
      data: {
        tenantId,
        strategyId: instance.id,
        requestedByUserId: actor.userId,
        sessionIdentifier,
        status: 'STARTING',
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        venue: instance.venue,
        symbol: input.symbol,
        marketType: instance.marketType,
        initialCapital,
        // Not a default someone can forget to set: written explicitly on every
        // insert, because this column is what tells a reader of the raw table
        // that none of these numbers came from a real account.
        isSimulated: true,
      },
      select: PaperSessionsService.SESSION_SELECT,
    });

    try {
      await this.queue.enqueueOrThrow(
        QUEUE_NAMES.STRATEGY_CONTROL,
        JOB_NAMES.START_PAPER_SESSION,
        {
          tenantId,
          sessionId: created.id,
          strategyId: instance.id,
          symbol: input.symbol,
          initialCapital,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      await this.prisma.paperTradingSession.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorCode: 'QUEUE_UNAVAILABLE',
          stoppedAt: new Date(),
          stopReason: 'The strategy control queue was unavailable at start time.',
        },
      });

      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the paper session could not be started.',
        (error as Error).message,
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.PAPER_SESSION_STARTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'paper_trading_session',
      resourceId: created.id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyId: instance.id,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        symbol: input.symbol,
        venue: instance.venue,
        initialCapital,
        isSimulated: true,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.paper_session_started',
        tenantId,
        sessionId: created.id,
        strategyId: instance.id,
        symbol: input.symbol,
        actorId: actor.userId,
      },
      'Paper trading session started',
    );

    return toPaperSessionView(created as PaperSessionRow);
  }

  async stop(
    tenantId: string,
    sessionId: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string },
  ): Promise<PaperSessionView> {
    const existing = await this.prisma.paperTradingSession.findFirst({
      where: { id: sessionId, tenantId },
      select: PaperSessionsService.SESSION_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Paper trading session');
    }

    if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
      throw new ConflictException('This paper session has already ended.');
    }

    // Local state first, queue second - the same ordering, and for the same
    // reason, as disabling an instance. A stop must not depend on Redis.
    const updated = await this.prisma.paperTradingSession.update({
      where: { id: sessionId },
      data: {
        status: 'STOPPED',
        stoppedAt: new Date(),
        stopReason: sanitiseForLog(input.reason, 500),
      },
      select: PaperSessionsService.SESSION_SELECT,
    });

    try {
      await this.queue.enqueueOrThrow(
        QUEUE_NAMES.STRATEGY_CONTROL,
        JOB_NAMES.STOP_PAPER_SESSION,
        {
          tenantId,
          sessionId,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'strategy.paper_stop_dispatch_failed',
          tenantId,
          sessionId,
          message: (error as Error).message,
        },
        'Paper session marked stopped locally but the worker could not be notified',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.PAPER_SESSION_STOPPED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'paper_trading_session',
      resourceId: sessionId,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyId: existing.strategyId,
        symbol: existing.symbol,
        simulatedOrders: existing.simulatedOrders,
        simulatedFills: existing.simulatedFills,
      },
      requestId: actor.requestId ?? null,
    });

    return toPaperSessionView(updated as PaperSessionRow);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    strategyId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<PaperSessionView>> {
    const pagination = normalisePagination(filter, PaperSessionsService.SORTABLE_FIELDS);

    const where: Prisma.PaperTradingSessionWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.paperTradingSession.findMany({
        where,
        select: PaperSessionsService.SESSION_SELECT,
        orderBy: { [pagination.sortBy ?? 'startedAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.paperTradingSession.count({ where }),
    ]);

    return {
      items: rows.map((row) => toPaperSessionView(row as PaperSessionRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, sessionId: string): Promise<PaperSessionView> {
    const row = await this.prisma.paperTradingSession.findFirst({
      where: { id: sessionId, tenantId },
      select: PaperSessionsService.SESSION_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Paper trading session');
    }

    return toPaperSessionView(row as PaperSessionRow);
  }

  async listSnapshots(
    tenantId: string,
    sessionId: string,
    filter: { limit?: number },
  ): Promise<PaperSnapshotView[]> {
    await this.get(tenantId, sessionId);

    const rows = await this.prisma.paperPortfolioSnapshot.findMany({
      where: { tenantId, sessionId },
      select: {
        sequence: true,
        capturedAtMicros: true,
        cash: true,
        positionQuantity: true,
        positionValue: true,
        equity: true,
        realisedPnl: true,
        unrealisedPnl: true,
        feesPaid: true,
        drawdown: true,
      },
      orderBy: { sequence: 'asc' },
      take: Math.min(filter.limit ?? 200, 1000),
    });

    return rows.map((row) => toPaperSnapshotView(row as PaperSnapshotRow));
  }
}
