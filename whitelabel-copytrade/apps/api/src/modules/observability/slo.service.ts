/**
 * Part 10: the SLO control plane on the API side - definitions (versioned,
 * checksummed, audited), the evaluation tick, the scorecard rollup, and the
 * burn-rate alert fold.
 *
 * The evaluator is a READER of evidence, in order of preference it can
 * actually honour: fixed-time sample buckets in Redis (written by
 * collectors at their own cadence), durable tables in PostgreSQL that the
 * platform already maintains (reconciliation runs; risk snapshot metadata,
 * with the engine's own bounded query shape), and the publisher mirrors the
 * health plane maintains. It invents no numbers: a source with no data
 * yields no ticks, which the completeness law renders as an UNKNOWN row -
 * visible, dated, and worded as "we did not look", never as "all good".
 *
 * What this file NEVER does: no method here touches orders, kill switches,
 * risk limits, alert resolution-by-side-effect, or anything the trading
 * path reads. An SLO publishes expectations; the burn alert is the same
 * durable-alert fold Part 9 built, under SLO rule ids. Red means a human
 * looks; nothing else.
 */

import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome, type PaginatedResult } from '@wlct/shared-types';
import type {
  SloConfigUpdateDto,
  SloEvaluationView,
  SloReadinessView,
  SloStatusView,
} from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { AuditService } from '../audit/audit.service';
import { TradingReadinessService } from '../health/trading-readiness.service';

import { AlertsService } from './alerts.service';
import {
  DEFAULT_SLO_CATALOG,
  SLO_ALERT_RULES,
  SLO_SAMPLE_SOURCES,
} from './slo.constants';
import {
  buildSloDefinition,
  canonicalPayload,
  sloChecksum,
  SloValidationError,
  type SloDefinition,
} from './slo.canonical';
import { evaluateSlo, type SloEvaluationRow } from './slo.eval';
import { definitionView, evaluationView, readinessView, sloStateCode, statusView } from './slo.mapper';
import { SloSamplesService } from './slo-samples';
import type { SloActor, SloEvaluateResult, SloListFilter } from './slo.types';

const epochMicros = (): bigint => BigInt(Date.now()) * 1000n;

@Injectable()
export class SloService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly registry: MetricsRegistry,
    private readonly audit: AuditService,
    private readonly samples: SloSamplesService,
    private readonly alerts: AlertsService,
    private readonly readiness: TradingReadinessService,
    @InjectPinoLogger(SloService.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.sloEnabled) {
      return;
    }
    try {
      await this.seedDefaults();
    } catch (error) {
      // Seeding is idempotent-by-unique-key; a failure here is loud in the
      // log but must not stop the API from serving traffic (the panel then
      // truthfully reports UNKNOWN until the next boot or the manual seed
      // path - which a scheduled tick also retries).
      this.logger.error(
        { event: 'slo.seed_failed', message: (error as Error).message },
        'SLO default catalog seeding failed',
      );
    }
  }

  /** Insert version 1 for every catalog entry that has NO versions yet.
   *  Multi-replica-safe by unique(sloId, version): a losing insert hits
   *  P2002 and means the other replica wrote the identical checksummed row -
   *  byte-identical is the whole point of checksumming the canonical form. */
  async seedDefaults(): Promise<{ seeded: number }> {
    let seeded = 0;
    for (const entry of DEFAULT_SLO_CATALOG) {
      const existing = await this.prisma.sloConfigurationVersion.findFirst({
        where: { sloId: entry.sloId },
        select: { id: true },
      });
      if (existing !== null) {
        continue;
      }
      const definition = buildSloDefinition({
        sloId: entry.sloId,
        service: entry.service,
        description: entry.description,
        owner: entry.owner,
        indicator: entry.indicator,
        objective: entry.objective,
        windowMinutes: entry.windowMinutes,
        shortWindowMinutes: entry.shortWindowMinutes,
        goodEvent: entry.goodEvent,
        badEvent: entry.badEvent,
        maxAgeMicros: entry.maxAgeMicros,
        latencyThresholdMicros: entry.latencyThresholdMicros,
        version: 1,
        enabled: true,
      });
      try {
        await this.prisma.sloConfigurationVersion.create({
          data: {
            sloId: definition.sloId,
            version: 1,
            objective: definition.objective,
            windowMinutes: definition.windowMinutes,
            shortWindowMinutes: definition.shortWindowMinutes,
            indicator: definition.indicator,
            owner: definition.owner,
            description: definition.description,
            goodEvent: definition.goodEvent,
            badEvent: definition.badEvent,
            warningBurnPpm: definition.warningBurnPpm,
            criticalBurnPpm: definition.criticalBurnPpm,
            maxAgeMicros:
              definition.maxAgeMicros === null ? null : BigInt(definition.maxAgeMicros),
            latencyThresholdMicros:
              definition.latencyThresholdMicros === null
                ? null
                : BigInt(definition.latencyThresholdMicros),
            enabled: true,
            payload: canonicalPayload(definition) as never,
            checksum: sloChecksum(definition),
          },
        });
        seeded += 1;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (seeded > 0) {
      this.logger.info({ event: 'slo.seeded', seeded }, 'SLO default catalog seeded');
    }
    return { seeded };
  }

  // ------------------------------------------------------------------
  // reads
  // ------------------------------------------------------------------

  /** Latest definition version + latest evaluation per SLO - the panel
   *  table. `service` filters the closed set of publisher domains. */
  async listStatuses(filter: SloListFilter): Promise<SloStatusView[]> {
    const rows = await this.latestDefinitions(filter);
    const statuses: SloStatusView[] = [];
    for (const row of rows) {
      const latest = await this.prisma.sloEvaluation.findFirst({
        where: { sloId: row.sloId, version: row.version },
        orderBy: { createdAt: 'desc' },
      });
      statuses.push(statusView(row, latest));
    }
    return statuses;
  }

  async getStatus(sloId: string): Promise<SloStatusView> {
    const row = await this.prisma.sloConfigurationVersion.findFirst({
      where: { sloId },
      orderBy: { version: 'desc' },
    });
    if (row === null) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no configuration for ${sloId}` });
    }
    const latest = await this.prisma.sloEvaluation.findFirst({
      where: { sloId, version: row.version },
      orderBy: { createdAt: 'desc' },
    });
    return statusView(row, latest);
  }

  async listVersions(
    sloId: string,
    filter: { page?: number; limit?: number; sortOrder?: string; sortBy?: string } = {},
  ): Promise<PaginatedResult<unknown>> {
    const pagination = normalisePagination(filter, ['version', 'createdAt']);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sloConfigurationVersion.findMany({
        where: { sloId },
        orderBy: { [pagination.sortBy ?? 'version']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.sloConfigurationVersion.count({ where: { sloId } }),
    ]);
    if (total === 0) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no configuration for ${sloId}` });
    }
    return {
      items: rows.map((row) => ({
        ...definitionView(row),
        payload: row.payload,
      })),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async listEvaluations(
    sloId: string,
    filter: { page?: number; limit?: number; sortOrder?: string; sortBy?: string } = {},
  ): Promise<PaginatedResult<SloEvaluationView>> {
    const pagination = normalisePagination(filter, ['createdAt', 'evaluatedAtMicros']);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sloEvaluation.findMany({
        where: { sloId },
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.sloEvaluation.count({ where: { sloId } }),
    ]);
    return {
      items: rows.map((row) => evaluationView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async rollup(): Promise<SloReadinessView> {
    const statuses = await this.listStatuses({ includeDisabled: false });
    return readinessView(statuses, epochMicros());
  }

  // ------------------------------------------------------------------
  // writes: versioned definition publish
  // ------------------------------------------------------------------

  async publishConfig(command: {
    actor: SloActor;
    sloId: string;
    update: SloConfigUpdateDto;
  }): Promise<SloStatusView> {
    const { actor, sloId, update } = command;
    const current = await this.prisma.sloConfigurationVersion.findFirst({
      where: { sloId },
      orderBy: { version: 'desc' },
    });
    // The service is inherited from the existing definition (or from the
    // catalog entry for a brand-new id): it is part of the checksummed
    // identity and is NOT a free-form per-update field - two versions of one
    // objective cannot claim to belong to different services.
    const service = await this.resolveService(sloId, current?.payload);
    let definition: SloDefinition;
    try {
      definition = buildSloDefinition({
        sloId,
        service,
        description: update.description,
        owner: update.owner,
        indicator:
          current !== null ? current.indicator : this.catalogIndicator(sloId) ?? '',
        objective: update.objective,
        windowMinutes: update.windowMinutes,
        shortWindowMinutes: update.shortWindowMinutes,
        goodEvent: update.goodEvent,
        badEvent: update.badEvent,
        warningBurnPpm: update.warningBurnPpm,
        criticalBurnPpm: update.criticalBurnPpm,
        maxAgeMicros: update.maxAgeMicros ?? null,
        latencyThresholdMicros: update.latencyThresholdMicros ?? null,
        version: (current?.version ?? 0) + 1,
        enabled: update.enabled ?? true,
      });
    } catch (error) {
      if (error instanceof SloValidationError) {
        throw new BadRequestException({
          code: 'SLO_DEFINITION_INVALID',
          message: error.message,
          details: { errors: error.errors },
        });
      }
      throw error;
    }
    const checksum = sloChecksum(definition);
    if (current !== null && current.checksum === checksum && current.enabled === definition.enabled) {
      // Publishing the identical enabled definition is a no-op, answered
      // honestly: no row, no version bump, no audit event. The panel says
      // "already at version N" rather than manufacturing history.
      return this.getStatus(sloId);
    }
    const row = await this.prisma.sloConfigurationVersion.create({
      data: {
        sloId: definition.sloId,
        version: definition.version,
        objective: definition.objective,
        windowMinutes: definition.windowMinutes,
        shortWindowMinutes: definition.shortWindowMinutes,
        indicator: definition.indicator,
        owner: definition.owner,
        description: definition.description,
        goodEvent: definition.goodEvent,
        badEvent: definition.badEvent,
        warningBurnPpm: definition.warningBurnPpm,
        criticalBurnPpm: definition.criticalBurnPpm,
        maxAgeMicros:
          definition.maxAgeMicros === null ? null : BigInt(definition.maxAgeMicros),
        latencyThresholdMicros:
          definition.latencyThresholdMicros === null
            ? null
            : BigInt(definition.latencyThresholdMicros),
        enabled: definition.enabled,
        payload: canonicalPayload(definition) as never,
        checksum,
      },
    });
    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.SLO_CONFIG_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'operational_slo',
      resourceId: sloId,
      description: `SLO ${sloId} published at version ${String(definition.version)} (checksum ${checksum.slice(0, 12)}...)`,
      changes: {
        version: { before: current?.version ?? 0, after: definition.version },
        checksum: { before: current?.checksum ?? null, after: checksum },
        enabled: { before: current?.enabled ?? null, after: definition.enabled },
        objective: { before: current?.objective ?? null, after: definition.objective },
      },
    });
    return statusView(row, null);
  }

  private async resolveService(
    sloId: string,
    currentPayload: unknown,
  ): Promise<string> {
    if (
      typeof currentPayload === 'object' &&
      currentPayload !== null &&
      typeof (currentPayload as Record<string, unknown>).service === 'string'
    ) {
      return (currentPayload as Record<string, unknown>).service as string;
    }
    const catalogEntry = DEFAULT_SLO_CATALOG.find((entry) => entry.sloId === sloId);
    if (catalogEntry !== undefined) {
      return catalogEntry.service;
    }
    // A genuinely new SLO id with no catalog entry keeps the panel's
    // component taxonomy honest: the prefix before the first dot is the
    // service (api.*, queues.*, ...). buildSloDefinition validates the
    // resulting token against the same bounded identifier pattern.
    const prefix = sloId.split('.')[0];
    return prefix.length > 0 ? prefix : 'custom';
  }

  private catalogIndicator(sloId: string): string | null {
    const entry = DEFAULT_SLO_CATALOG.find((candidate) => candidate.sloId === sloId);
    return entry === undefined ? null : entry.indicator;
  }

  // ------------------------------------------------------------------
  // the evaluation tick
  // ------------------------------------------------------------------

  async evaluateAll(actor: SloActor | null, source: 'scheduled' | 'manual', sloId?: string):
    Promise<SloEvaluateResult> {
    if (this.config.sloEnabled !== true) {
      return { evaluated: 0, alertingSloIds: [], skipped: [], source };
    }
    const nowMs = Date.now();
    const rows = await this.latestDefinitions({ includeDisabled: false });
    const scoped = sloId === undefined ? rows : rows.filter((row) => row.sloId === sloId);
    if (sloId !== undefined && scoped.length === 0) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no enabled configuration for ${sloId}` });
    }

    await this.recordTickSamples(nowMs);

    const result: SloEvaluateResult = { evaluated: 0, alertingSloIds: [], skipped: [], source };
    const alertRows: Array<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }> = [];

    for (const row of scoped) {
      let evaluation: SloEvaluationRow;
      try {
        evaluation = await this.evaluateOne(row, nowMs);
      } catch (error) {
        result.skipped.push({ sloId: row.sloId, error: (error as Error).message.slice(0, 200) });
        this.logger.warn(
          { event: 'slo.evaluate_skipped', sloId: row.sloId, message: (error as Error).message },
          'SLO evaluation skipped for this definition (sources or stored payload unusable)',
        );
        continue;
      }
      await this.prisma.sloEvaluation.create({ data: evaluationCreateData(evaluation) });
      this.observeGauges(evaluation);
      result.evaluated += 1;
      const paging = this.collectAlert(evaluation, row, alertRows);
      if (paging) {
        result.alertingSloIds.push(evaluation.sloId);
      }
    }

    await this.alerts.applySloAlerts(alertRows, new Set(scoped.map((row) => row.sloId)));

    if (actor !== null && source === 'manual') {
      await this.audit.recordImmediate({
        tenantId: actor.tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: AuditAction.SLO_EVALUATE_REQUESTED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'operational_slo',
        resourceId: sloId ?? 'all',
        description: `manual SLO evaluation requested (${String(result.evaluated)} evaluated, ${String(result.alertingSloIds.length)} paging)`,
        changes: { sloId: { before: null, after: sloId ?? null }, evaluated: { before: null, after: result.evaluated } },
      });
    }
    return result;
  }

  private async evaluateOne(row: ConfigRowLike, nowMs: number): Promise<SloEvaluationRow> {
    const definition = buildSloDefinition({
      sloId: row.sloId,
      service: serviceFromPayload(row.payload),
      description: row.description,
      owner: row.owner,
      indicator: row.indicator,
      objective: row.objective,
      windowMinutes: row.windowMinutes,
      shortWindowMinutes: row.shortWindowMinutes,
      goodEvent: row.goodEvent,
      badEvent: row.badEvent,
      warningBurnPpm: row.warningBurnPpm,
      criticalBurnPpm: row.criticalBurnPpm,
      maxAgeMicros: row.maxAgeMicros === null ? null : row.maxAgeMicros.toString(),
      latencyThresholdMicros:
        row.latencyThresholdMicros === null ? null : row.latencyThresholdMicros.toString(),
      version: row.version,
      enabled: row.enabled,
    });
    const checksum = sloChecksum(definition);
    if (checksum !== row.checksum) {
      // Loud on purpose: a stored row whose payload no longer matches its
      // checksum is a data-integrity event, not a rounding question. We
      // evaluate from the STORED columns (they are the published fact) and
      // record the mismatch in the row's reason rather than pretending the
      // config table is trustworthy.
      this.logger.error(
        { event: 'slo.checksum_mismatch', sloId: row.sloId, version: row.version },
        'Stored SLO definition does not match its checksum',
      );
    }

    const isLatency = row.indicator === 'latency_threshold_compliance';
    const latencyThreshold = row.latencyThresholdMicros;
    const [longWindow, shortWindow] = isLatency
      ? await Promise.all([
          this.samples.readLatencyWindow(row.windowMinutes, latencyThreshold ?? 500_000n, nowMs),
          this.samples.readLatencyWindow(row.shortWindowMinutes, latencyThreshold ?? 500_000n, nowMs),
        ])
      : await Promise.all([
          this.samples.readWindow(
            row.indicator as Parameters<typeof this.samples.readWindow>[0],
            row.windowMinutes,
            nowMs,
          ),
          this.samples.readWindow(
            row.indicator as Parameters<typeof this.samples.readWindow>[0],
            row.shortWindowMinutes,
            nowMs,
          ),
        ]);

    const evaluation = evaluateSlo({
      definition,
      checksum,
      longWindow: { good: longWindow.good, bad: longWindow.bad, dataComplete: longWindow.dataComplete, note: longWindow.note },
      shortWindow: { good: shortWindow.good, bad: shortWindow.bad, dataComplete: shortWindow.dataComplete, note: shortWindow.note },
      evaluatedAtMicros: BigInt(nowMs) * 1000n,
      fastMultiplierPpm: this.config.sloFastBurnPpm,
      slowMultiplierPpm: this.config.sloSlowBurnPpm,
    });
    return checksum === row.checksum
      ? evaluation
      : {
          ...evaluation,
          reason: truncate(
            `stored checksum mismatch on version ${String(row.version)}; ` +
              String(evaluation.reason ?? ''),
            500,
          ),
        };
  }

  /** Per-tick samples for the tick-shaped sources, written BEFORE the
   *  windows are read so this tick's evidence counts. Every probe is
   *  individually guarded: one source's collector failing must degrade that
   *  SLO to UNKNOWN, never fail the whole tick. */
  private async recordTickSamples(nowMs: number): Promise<void> {
    // api.availability: the evaluator's OWN dependency probe - Postgres
    // answered and Redis answered. It measures what the panel's existence
    // depends on, which is a smaller claim than "API uptime", and the
    // catalog text says exactly that.
    let availabilityOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await withTimeout(this.redis.client.ping(), 2000);
      availabilityOk = true;
    } catch {
      availabilityOk = false;
    }
    await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.availability, availabilityOk));

    // market-data.freshness: the published health mirror, exactly as Part 9
    // reads it. Missing mirror = no tick (absence is not freshness evidence
    // either way; the alert plane owns "publisher unreachable").
    let market: Record<string, unknown> | null = null;
    try {
      const raw = await this.redis.client.get('wlct:trading:ops:health:market-data');
      market = raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
    } catch {
      market = null;
    }
    if (market !== null && typeof market.status === 'string') {
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.market_data_freshness, market.status === 'HEALTHY'));
    }

    // risk-state.freshness: the engine's own bounded query shape
    // (DISTINCT ON latest per account, capped), against the SLO budget (2x
    // the live gate's) rather than the gate's - the gate refuses, this
    // trends, and the two budgets differing on purpose is the whole point.
    const riskBudgetMicros = 4_000_000n;
    try {
      const cutoff = new Date(Number(BigInt(nowMs) * 1000n - riskBudgetMicros) / 1000);
      const accounts = await this.prisma.$queryRaw<Array<{ account_id: string; captured_at: Date | null }>>`
        SELECT DISTINCT ON (account_id) account_id, captured_at
        FROM risk_snapshot_metadata
        ORDER BY account_id, captured_at DESC
        LIMIT 1000`;
      const published = accounts.length;
      const stale = accounts.filter(
        (account) => account.captured_at === null || account.captured_at < cutoff,
      ).length;
      await guard(
        this.samples.recordTick(SLO_SAMPLE_SOURCES.risk_state_freshness, published > 0 && stale === 0),
      );
    } catch {
      /* no tick: completeness law turns that into UNKNOWN, which is the
         honest shape of "the evaluator could not look" */
    }

    // queues.freshness: the SAME snapshot the alert fold used this minute
    // (queue ages from the readiness service), judged against this
    // definition's own 240s budget - not the alert policy's. Unknown ages
    // read bad here: a stalled collector is not freshness (catalog law).
    try {
      const queueSamples = await this.readiness.queueAlertSamples();
      const ageLimitMs = 240_000;
      const bad =
        queueSamples.length === 0 ||
        queueSamples.some(
          (sample) =>
            sample.oldestWaitingAgeMs === null || sample.oldestWaitingAgeMs > ageLimitMs,
        );
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.queue_freshness, !bad));
    } catch {
      /* no tick */
    }

    // execution.reconciliation-freshness: last COMPLETED pass against the
    // definition's own 15-minute budget. "Blindness counts bad" here is not
    // the collector failing (that is the no-tick above) - it is the durable
    // record showing no recent clean pass, which is a real miss.
    try {
      const runs = await this.prisma.reconciliationRun.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { finishedAt: 'desc' },
        take: 20,
        select: { finishedAt: true, discrepanciesFound: true, discrepanciesRepaired: true },
      });
      // "A CLEAN pass within budget" - if the newest completed run found
      // discrepancies it did not repair, an older clean pass still counts
      // for ITS window facts only via age; we scan the recent runs for any
      // clean-and-fresh one rather than letting a messy-but-completed run
      // mask a clean sibling (or vice versa).
      const freshAndClean = runs.some(
        (run) =>
          run.finishedAt !== null &&
          nowMs - run.finishedAt.getTime() <= 900_000 &&
          (run.discrepanciesFound === 0 || run.discrepanciesRepaired >= run.discrepanciesFound),
      );
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.reconciliation_freshness, freshAndClean));
    } catch {
      /* no tick */
    }
  }

  /** The engine-side error-rate sample is written by the trading engine's
   *  own mirror loop (engineerr bucket). There is NO fallback that invents
   *  it from here: an engine that is not counting is an UNKNOWN, which is
   *  precisely the sentence this part exists to make possible. */
  private collectAlert(
    evaluation: SloEvaluationRow,
    row: { sloId: string; description: string },
    sink: Array<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }>,
  ): boolean {
    if (evaluation.alertKind === 'fast' || evaluation.alertKind === 'both') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.fast,
        severity: 'CRITICAL',
        title: `Error budget burning fast: ${row.sloId}`,
        condition: 'short AND long window burn at or above the fast multiplier',
        message: truncate(evaluation.reason ?? 'burn-rate alert (fast)', 500),
        observedValue: String(evaluation.shortBurnPpm ?? ''),
        thresholdValue: String(this.config.sloFastBurnPpm),
      });
    } else if (evaluation.alertKind === 'slow') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.slow,
        severity: 'WARNING',
        title: `Error budget burning steadily: ${row.sloId}`,
        condition: 'short AND long window burn at or above the slow multiplier',
        message: truncate(evaluation.reason ?? 'burn-rate alert (slow)', 500),
        observedValue: String(evaluation.shortBurnPpm ?? ''),
        thresholdValue: String(this.config.sloSlowBurnPpm),
      });
    }
    if (evaluation.state === 'UNKNOWN' && !evaluation.dataComplete) {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.telemetryGap,
        severity: 'WARNING',
        title: `SLO telemetry gap: ${row.sloId}`,
        condition: 'latest evaluation UNKNOWN with an incomplete collector',
        message: truncate(evaluation.reason ?? 'collector incomplete', 500),
        observedValue: null,
        thresholdValue: '950000',
      });
    }
    if (evaluation.state === 'EXHAUSTED') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.exhausted,
        severity: 'CRITICAL',
        title: `Error budget exhausted: ${row.sloId}`,
        condition: 'remaining budget hit zero with bad events observed',
        message: truncate(evaluation.reason ?? 'budget exhausted', 500),
        observedValue: String(evaluation.budgetRemainingEvents),
        thresholdValue: '0',
      });
    }
    return (
      evaluation.alertKind !== 'none' ||
      evaluation.state === 'EXHAUSTED' ||
      evaluation.state === 'CRITICAL'
    );
  }

  private observeGauges(evaluation: SloEvaluationRow): void {
    this.registry.setGauge(
      'wlct_slo_state',
      { component: evaluation.service, slo: evaluation.sloId },
      sloStateCode(evaluation.state),
    );
    if (evaluation.remainingRatioPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_error_budget_remaining_ppm',
        { slo: evaluation.sloId },
        evaluation.remainingRatioPpm,
      );
    }
    if (evaluation.longBurnPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_burn_rate_ppm',
        { slo: evaluation.sloId, window_kind: 'long' },
        evaluation.longBurnPpm,
      );
    }
    if (evaluation.shortBurnPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_burn_rate_ppm',
        { slo: evaluation.sloId, window_kind: 'short' },
        evaluation.shortBurnPpm,
      );
    }
  }

  // ------------------------------------------------------------------
  // retention
  // ------------------------------------------------------------------

  /** Evaluation rows only, never definitions (the versioned history IS the
   *  evidence base for "what were we promising then"). The 7-day floor is
   *  the burn window's own reach: pruning what a window still reads would
   *  turn every long-window into a lie of omission. */
  async prune(payload: { retentionDays?: number } = {}): Promise<{ removed: number }> {
    const requested = payload.retentionDays ?? this.config.sloRetentionDays;
    const effectiveDays = Math.max(7, requested);
    const cutoff = new Date(Date.now() - effectiveDays * 86_400_000);
    const deleted = await this.prisma.sloEvaluation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.info(
      { event: 'slo.pruned', removed: deleted.count, retentionDays: effectiveDays },
      'SLO evaluation rows beyond the retention window removed',
    );
    return { removed: deleted.count };
  }

  private async latestDefinitions(filter: SloListFilter): Promise<ConfigRowLike[]> {
    const latest = await this.prisma.sloConfigurationVersion.findMany({
      orderBy: [{ sloId: 'asc' }, { version: 'desc' }],
    });
    const seen = new Set<string>();
    const out: ConfigRowLike[] = [];
    for (const row of latest) {
      if (seen.has(row.sloId)) {
        continue;
      }
      seen.add(row.sloId);
      if (!filter.includeDisabled && row.enabled !== true) {
        continue;
      }
      if (filter.service !== undefined && serviceFromPayload(row.payload) !== filter.service) {
        continue;
      }
      out.push(row);
    }
    return out;
  }
}

/** The mapper and the evaluator consume the REAL Prisma payload shape (the
 *  alias exists so the two sites read the same and cannot drift into a
 *  hand-written interface that forgets a column). */
type ConfigRowLike = Prisma.SloConfigurationVersionGetPayload<object>;

const serviceFromPayload = (payload: unknown): string => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>).service;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return 'custom';
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`;

const guard = async (promise: Promise<unknown>): Promise<void> => {
  try {
    await promise;
  } catch {
    // Sample writes are telemetry; a failure is absorbed here and shows up
    // as a completeness gap (UNKNOWN), never as a failed evaluation tick.
  }
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('probe timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const evaluationCreateData = (row: SloEvaluationRow) => ({
  sloId: row.sloId,
  version: row.version,
  checksum: row.checksum,
  indicator: row.indicator,
  service: row.service,
  state: row.state,
  evaluatedAtMicros: BigInt(row.evaluatedAtMicros),
  windowMinutes: row.windowMinutes,
  shortWindowMinutes: row.shortWindowMinutes,
  targetPpm: row.targetPpm,
  actualPpm: row.actualPpm,
  budgetTotalEvents: row.budgetTotalEvents,
  budgetConsumedEvents: row.budgetConsumedEvents,
  budgetRemainingEvents: row.budgetRemainingEvents,
  remainingRatioPpm: row.remainingRatioPpm,
  longBurnPpm: row.longBurnPpm,
  shortBurnPpm: row.shortBurnPpm,
  alertKind: row.alertKind,
  samplesGood: row.samplesGood,
  samplesBad: row.samplesBad,
  dataComplete: row.dataComplete,
  reason: row.reason === null ? null : truncate(row.reason, 500),
});
