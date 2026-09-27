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
import { StrategyCatalogService } from './strategy-catalog.service';
import {
  toBacktestMetricView,
  toBacktestRunView,
  toBacktestTradeView,
  type BacktestMetricRow,
  type BacktestRunRow,
  type BacktestTradeRow,
} from './strategy.mapper';
import type {
  BacktestMetricView,
  BacktestRunView,
  BacktestTradeView,
} from './strategy.types';

/**
 * Backtest submission and results.
 *
 * A backtest opens no socket, holds no credential and touches no venue: it
 * replays a stored, checksummed dataset through the same strategy code that
 * runs live. That is the whole point of it, and it is why this is the least
 * dangerous endpoint in the platform - and why the results it produces are the
 * easiest to over-trust.
 *
 * Which is the other half of this service's job. Every row it returns is
 * labelled simulated and carries the disclaimer, the risk-adjusted figures are
 * withheld rather than invented when there were too few observations, and the
 * configuration hash plus dataset checksum are returned so that a result can
 * be reproduced rather than merely believed.
 *
 * The API does not run the backtest. It records a QUEUED row and hands the
 * work to the strategy worker; a replay of a month of book updates is not
 * something to do inside an HTTP request.
 */
@Injectable()
export class BacktestService {
  private static readonly RUN_SELECT = {
    id: true,
    runIdentifier: true,
    status: true,
    strategyId: true,
    definitionId: true,
    versionId: true,
    strategyKey: true,
    strategyVersion: true,
    implementationId: true,
    venue: true,
    symbol: true,
    marketType: true,
    datasetId: true,
    datasetVersionId: true,
    datasetSource: true,
    datasetChecksum: true,
    granularity: true,
    windowStartMicros: true,
    windowEndMicros: true,
    eventCount: true,
    walkForwardSegment: true,
    initialCapital: true,
    makerFeeRate: true,
    takerFeeRate: true,
    slippageBps: true,
    latencyMicros: true,
    parameters: true,
    assumptions: true,
    finalEquity: true,
    netPnl: true,
    grossProfit: true,
    grossLoss: true,
    feesPaid: true,
    slippageCost: true,
    totalReturnPercent: true,
    maxDrawdown: true,
    maxDrawdownPercent: true,
    totalTrades: true,
    winningTrades: true,
    losingTrades: true,
    winRate: true,
    averageTrade: true,
    largestWin: true,
    largestLoss: true,
    profitFactor: true,
    sharpeRatio: true,
    sortinoRatio: true,
    hasSufficientObservations: true,
    exposurePercent: true,
    turnover: true,
    configurationHash: true,
    engineVersion: true,
    isReproducible: true,
    jobId: true,
    queuedAt: true,
    startedAt: true,
    completedAt: true,
    durationMs: true,
    errorCode: true,
    errorSummary: true,
  } satisfies Prisma.BacktestRunSelect;

  private static readonly SORTABLE_FIELDS = ['queuedAt', 'completedAt', 'netPnl'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: StrategyCatalogService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(BacktestService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  async submit(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    input: {
      strategyId?: string;
      definitionKey?: string;
      version?: string;
      venue: string;
      symbol: string;
      marketType?: string;
      datasetId: string;
      datasetChecksum?: string;
      /** Part 7: pin the run to an immutable registered dataset version. */
      datasetVersionId?: string;
      parameters?: Record<string, unknown>;
      initialCapital?: string;
      makerFeeRate?: string;
      takerFeeRate?: string;
      slippageBps?: string;
      latencyMicros?: number;
      walkForwardSegment?: string;
    },
  ): Promise<BacktestRunView> {
    if (!this.config.backtestEnabled) {
      throw new ConflictException(
        'Backtesting is disabled in this deployment (BACKTEST_ENABLED=false).',
        { backtestEnabled: false },
      );
    }

    const resolved = await this.resolveTarget(tenantId, input);
    const datasetVersion = await this.resolveDatasetVersion(input);

    // Assumptions are resolved here rather than in the worker so that the
    // stored row states exactly what was assumed, even if the defaults change
    // between submission and execution. A result whose costs are ambiguous is
    // not a result.
    const defaults = this.config.backtestDefaults;
    const initialCapital = input.initialCapital ?? defaults.initialCapital;
    const makerFeeRate = input.makerFeeRate ?? defaults.makerFee;
    const takerFeeRate = input.takerFeeRate ?? defaults.takerFee;
    const slippageBps = input.slippageBps ?? defaults.slippageBps;

    if (Number.parseFloat(initialCapital) <= 0) {
      throw new ValidationException([
        {
          field: 'initialCapital',
          constraint: 'positive',
          message: 'initialCapital must be greater than zero.',
        },
      ]);
    }

    // A queued run has no engine-assigned identifier yet: that id is derived
    // deterministically by the engine from the configuration and the dataset,
    // and inventing one here would mean writing an id that the reproducibility
    // check later disagrees with. A placeholder is used until the worker
    // reports the real one.
    const placeholderIdentifier = `pending-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const created = await this.prisma.backtestRun.create({
      data: {
        tenantId,
        requestedByUserId: actor.userId,
        strategyId: resolved.strategyId,
        definitionId: resolved.definitionId,
        versionId: resolved.versionId,
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        implementationId: resolved.implementationId,
        status: 'QUEUED',
        venue: input.venue as never,
        symbol: input.symbol,
        marketType: (input.marketType ?? 'SPOT') as never,
        datasetId: datasetVersion?.canonicalId ?? input.datasetId,
        datasetSource: datasetVersion ? 'HISTORICAL_REGISTRY' : 'STORED',
        datasetChecksum: datasetVersion
          ? datasetVersion.contentChecksum
          : (input.datasetChecksum ?? null),
        datasetVersionId: datasetVersion?.id ?? null,
        windowStartMicros: BigInt(0),
        windowEndMicros: BigInt(0),
        initialCapital,
        makerFeeRate,
        takerFeeRate,
        slippageBps,
        latencyMicros: BigInt(input.latencyMicros ?? 0),
        parameters: (input.parameters ?? resolved.parameters) as Prisma.InputJsonValue,
        assumptions: {
          minimumFillQuantity: null,
          partialFillsEnabled: true,
          source: 'api-submission',
        } as Prisma.InputJsonValue,
        walkForwardSegment: input.walkForwardSegment ?? null,
        // Filled in by the worker from the engine's own deterministic values.
        runIdentifier: placeholderIdentifier,
        configurationHash: '',
        engineVersion: '0.6.0',
        isReproducible: Boolean(
          datasetVersion ? datasetVersion.contentChecksum : input.datasetChecksum,
        ),
      },
      select: BacktestService.RUN_SELECT,
    });

    let jobId: string;
    try {
      jobId = await this.queue.enqueueOrThrow(QUEUE_NAMES.STRATEGY_CONTROL, JOB_NAMES.RUN_BACKTEST, {
        tenantId,
        backtestRunId: created.id,
        requestedByUserId: actor.userId,
        requestedAt: new Date().toISOString(),
      });
    } catch (error) {
      // The row is marked FAILED rather than left QUEUED forever. A queued
      // backtest that nothing will ever pick up is worse than a failed one: it
      // looks like it is about to produce an answer.
      await this.prisma.backtestRun.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorSummary: 'The strategy control queue was unavailable at submission time.',
          completedAt: new Date(),
        },
      });

      this.logger.error(
        {
          event: 'backtest.enqueue_failed',
          tenantId,
          backtestRunId: created.id,
          message: (error as Error).message,
        },
        'Failed to queue backtest',
      );

      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the backtest could not be scheduled.',
        (error as Error).message,
      );
    }

    const withJob = await this.prisma.backtestRun.update({
      where: { id: created.id },
      data: { jobId },
      select: BacktestService.RUN_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.BACKTEST_SUBMITTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'backtest_run',
      resourceId: created.id,
      description: sanitiseForLog(
        `Backtest of ${resolved.strategyKey}@${resolved.strategyVersion} on ${input.symbol}`,
        500,
      ),
      metadata: {
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        symbol: input.symbol,
        venue: input.venue,
        datasetId: datasetVersion?.canonicalId ?? input.datasetId,
        datasetVersionId: datasetVersion?.id ?? null,
        datasetChecksum: datasetVersion
          ? datasetVersion.contentChecksum
          : (input.datasetChecksum ?? null),
        initialCapital,
        makerFeeRate,
        takerFeeRate,
        slippageBps,
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'backtest.submitted',
        tenantId,
        backtestRunId: created.id,
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        symbol: input.symbol,
        datasetId: input.datasetId,
        actorId: actor.userId,
      },
      'Backtest submitted',
    );

    return toBacktestRunView(withJob as BacktestRunRow);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    strategyId?: string;
    symbol?: string;
    configurationHash?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<BacktestRunView>> {
    const pagination = normalisePagination(filter, BacktestService.SORTABLE_FIELDS);

    const where: Prisma.BacktestRunWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
      ...(filter.symbol ? { symbol: filter.symbol } : {}),
      ...(filter.configurationHash ? { configurationHash: filter.configurationHash } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.backtestRun.findMany({
        where,
        select: BacktestService.RUN_SELECT,
        orderBy: { [pagination.sortBy ?? 'queuedAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.backtestRun.count({ where }),
    ]);

    return {
      items: rows.map((row) => toBacktestRunView(row as BacktestRunRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, id: string): Promise<BacktestRunView> {
    const row = await this.prisma.backtestRun.findFirst({
      where: { id, tenantId },
      select: BacktestService.RUN_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Backtest run');
    }

    return toBacktestRunView(row as BacktestRunRow);
  }

  async listMetrics(tenantId: string, id: string): Promise<BacktestMetricView[]> {
    await this.get(tenantId, id);

    const rows = await this.prisma.backtestMetric.findMany({
      where: { tenantId, backtestRunId: id },
      select: {
        name: true,
        value: true,
        unit: true,
        observationCount: true,
        isSufficient: true,
        note: true,
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => toBacktestMetricView(row as BacktestMetricRow));
  }

  async listTrades(
    tenantId: string,
    id: string,
    filter: { page?: number; limit?: number },
  ): Promise<PaginatedResult<BacktestTradeView>> {
    await this.get(tenantId, id);
    const pagination = normalisePagination(filter, ['sequence']);

    const where: Prisma.BacktestTradeWhereInput = { tenantId, backtestRunId: id };

    const [rows, total] = await Promise.all([
      this.prisma.backtestTrade.findMany({
        where,
        select: {
          sequence: true,
          symbol: true,
          direction: true,
          quantity: true,
          entryPrice: true,
          exitPrice: true,
          grossPnl: true,
          fees: true,
          netPnl: true,
          isWin: true,
          openedAtMicros: true,
          closedAtMicros: true,
          holdingMicros: true,
        },
        orderBy: { sequence: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.backtestTrade.count({ where }),
    ]);

    return {
      items: rows.map((row) => toBacktestTradeView(row as BacktestTradeRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Validate the cited dataset version, if any, and derive the run's dataset
   * identity from the REGISTRY row rather than from the request.
   *
   * Four refusals, in order, each guarding one failure mode a result could
   * otherwise carry silently:
   *
   *   1. no version cited in a BACKTEST_DATASET_REQUIRED deployment - the
   *      run must pin immutable data or not run; the error names the way to
   *      comply rather than merely saying no;
   *   2. the version does not exist or is not VALID (INVALID, QUARANTINED,
   *      ARCHIVED, still INGESTING) - an unvalidated or withdrawn dataset is
   *      never silently consumed, mirroring the reader-side rule in
   *      wlct_trading.datasets so the boundary holds at BOTH doors;
   *   3. venue/symbol mismatch between request and version - a run labeled
   *      BTC-USDT computed over ETH-USDT files is a mislabeled result, and
   *      the label is the only part of a result most readers ever look at;
   *   4. a caller-supplied datasetId or datasetChecksum that disagrees with
   *      the registry row - the registry is right by construction (the
   *      checksum is over the canonical events, recomputed at finalisation),
   *      so a disagreement is a stale client, and a stale client must be
   *      told rather than indulged.
   *
   * The returned canonicalId (`hst-<key>@v<n>`) is what gets STORED as the
   * run's dataset identity: every result names the exact version of the
   * exact dataset, and the "latest" pointer never exists anywhere - latest
   * is a query, never a foreign key.
   */
  private async resolveDatasetVersion(input: {
    datasetId: string;
    datasetChecksum?: string;
    datasetVersionId?: string;
    venue: string;
    symbol: string;
  }): Promise<{ id: string; contentChecksum: string; canonicalId: string } | null> {
    if (!input.datasetVersionId) {
      if (this.config.backtestDatasetRequired) {
        throw new ValidationException(
          [
            {
              field: 'datasetVersionId',
              constraint: 'required',
              message:
                'This deployment requires backtests to cite a registered dataset ' +
                'version (BACKTEST_DATASET_REQUIRED=true). List GET /datasets/' +
                '<key>/versions?usableOnly=true, or queue an ingestion job.',
            },
          ],
          'A backtest without a pinned, checksummed dataset version is not a reproducible experiment.',
        );
      }
      return null;
    }

    const version = await this.prisma.historicalDatasetVersion.findFirst({
      where: { id: input.datasetVersionId },
      select: {
        id: true,
        version: true,
        status: true,
        contentChecksum: true,
        dataset: { select: { datasetKey: true, venue: true, symbols: true } },
      },
    });
    if (!version) {
      throw new NotFoundException('Dataset version', input.datasetVersionId);
    }
    if (version.status !== 'VALID') {
      throw new ConflictException(
        `Dataset version ${version.dataset.datasetKey}@v${version.version} has status ` +
          `${version.status}; only VALIDATED versions can be replayed. A result over ` +
          'unvalidated data is indistinguishable from a result over corrupt data, which ' +
          'is the one distinction the whole point of this API exists to make.',
        { status: version.status },
      );
    }
    if (version.dataset.venue !== input.venue) {
      throw new ValidationException(
        [
          {
            field: 'venue',
            constraint: 'datasetVenueMatch',
            message: `The dataset version covers ${version.dataset.venue}; the run requests ${input.venue}.`,
          },
        ],
      );
    }
    if (!version.dataset.symbols.includes(input.symbol)) {
      throw new ValidationException(
        [
          {
            field: 'symbol',
            constraint: 'datasetSymbolCoverage',
            message:
              `The dataset version covers ${version.dataset.symbols.join(', ')}; ` +
              `${input.symbol} is not among them.`,
          },
        ],
      );
    }

    const canonicalId = `${version.dataset.datasetKey}@v${version.version}`;
    if (input.datasetChecksum && input.datasetChecksum !== version.contentChecksum) {
      throw new ConflictException(
        `The expected dataset checksum disagrees with the registry's for ${canonicalId}. ` +
          'The registry checksum was computed over the canonical events at finalisation; a ' +
          'client citing a different one is citing different data. Refusing rather than ' +
          'choosing for it.',
        { expected: input.datasetChecksum.slice(0, 16), registered: version.contentChecksum.slice(0, 16) },
      );
    }
    if (input.datasetId && input.datasetId !== canonicalId) {
      // Accepted-but-corrected would let a stale client keep citing an old
      // label while the row says otherwise; refusing makes the client see the
      // canonical identity once and use it thereafter.
      throw new ValidationException(
        [
          {
            field: 'datasetId',
            constraint: 'matchesDatasetVersion',
            message: `datasetId must equal the canonical identity ${canonicalId} for the cited version.`,
          },
        ],
      );
    }
    return { id: version.id, contentChecksum: version.contentChecksum, canonicalId };
  }

  private async resolveTarget(
    tenantId: string,
    input: { strategyId?: string; definitionKey?: string; version?: string },
  ): Promise<{
    strategyId: string | null;
    definitionId: string | null;
    versionId: string | null;
    strategyKey: string;
    strategyVersion: string;
    implementationId: string;
    parameters: Record<string, unknown>;
  }> {
    if (input.strategyId) {
      const instance = await this.prisma.strategy.findFirst({
        where: { id: input.strategyId, tenantId, deletedAt: null },
        select: {
          id: true,
          kind: true,
          version: true,
          definitionId: true,
          versionId: true,
          configurations: {
            where: { isActive: true },
            select: { parameters: true },
            take: 1,
          },
        },
      });

      if (!instance) {
        throw new NotFoundException('Strategy instance');
      }

      const runnable = await this.catalog.resolveRunnableVersion(instance.kind, instance.version);

      return {
        strategyId: instance.id,
        definitionId: instance.definitionId ?? runnable.definitionId,
        versionId: instance.versionId ?? runnable.versionId,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        implementationId: runnable.implementationId,
        parameters: (instance.configurations[0]?.parameters ?? {}) as Record<string, unknown>,
      };
    }

    if (!input.definitionKey || !input.version) {
      throw new ValidationException([
        {
          field: 'strategyId',
          constraint: 'oneOfRequired',
          message:
            'Provide either strategyId, or definitionKey together with version. A backtest ' +
            'has to know exactly which code it is running, or its result means nothing.',
        },
      ]);
    }

    const runnable = await this.catalog.resolveRunnableVersion(
      input.definitionKey,
      input.version,
    );

    return {
      strategyId: null,
      definitionId: runnable.definitionId,
      versionId: runnable.versionId,
      strategyKey: input.definitionKey,
      strategyVersion: input.version,
      implementationId: runnable.implementationId,
      parameters: (runnable.defaultParameters ?? {}) as Record<string, unknown>,
    };
  }
}
