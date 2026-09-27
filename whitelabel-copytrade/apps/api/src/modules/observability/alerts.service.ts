import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome, type PaginatedResult } from '@wlct/shared-types';
import { ALERT_FORCE_RESOLVE_PHRASE, OBS_PUBLISHER_SERVICES } from '@wlct/config';
import type { Prisma } from '@prisma/client';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';

import { ALERT_RULE_CATALOG } from './alert.constants';
import { alertRowToView, parseAlertsDocument } from './observability.mapper';
import type {
  AlertMutationResult,
  AlertSyncResult,
  ListOpsAlertsFilter,
  OpsActor,
  OpsAlertView,
  PublishedAlertRecord,
} from './observability.types';
import { IncidentsService } from './incidents.service';

/**
 * The durable alert fold: Redis mirrors in, PostgreSQL rows out, one writer.
 *
 * Why the API writes and the engine does not: the engine owns the LIVE
 * judgement (dedupe windows, occurrence counting, recovery observation) in
 * the only place it can do so cheaply - its own memory. The API owns the
 * durable record because it owns PostgreSQL, RBAC and the audit trail. The
 * mirror is the seam, and like every Part 5-8 seam it is unidirectional:
 * this service never writes anything an engine reads for enforcement.
 *
 * Three invariants the sync job upholds, each tested:
 *
 * 1. FOLD, DON'T FLOOD. A publisher re-reporting an alert for the same
 *    dedupe key updates the row (occurrences jump to the publisher's
 *    cumulative count, lastSeenAt moves); it never inserts. A night of
 *    ten thousand identical stale-feed ticks is one row with 10_000 on it.
 *
 * 2. ABSENCE IS NOT RECOVERY. An alert row is auto-resolved only when the
 *    PUBLISHING service's alert mirror is present AND the record is gone
 *    from it - i.e. the publisher looked and saw nothing. A missing or
 *    expired mirror (publisher down, Redis blip) leaves rows exactly as
 *    they are: the publisher being unreachable is an availability event
 *    for its health component, never an alibi that cleared its alerts.
 *
 * 3. ACKNOWLEDGE NEVER RESOLVES. The state machine here is the engine's
 *    OPEN -> ACKNOWLEDGED -> RESOLVED, and the resolve edge has exactly two
 *    doors: the observed recovery above, or an operator force-resolve
 *    quoting the typed phrase - audited per row, never a delete.
 *
 * Pruning is retention bookkeeping and follows its own rule: only RESOLVED
 * rows older than ALERT_RETENTION_DAYS may go. An alert nobody resolved is
 * the most important row in the table, not the first deletion candidate.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly incidents: IncidentsService,
    @InjectPinoLogger(AlertsService.name) private readonly logger: PinoLogger,
  ) {}

  // ------------------------------------------------------------------
  // reads (tenant-scoped by the caller's context; see controller)
  // ------------------------------------------------------------------
  async list(filter: ListOpsAlertsFilter): Promise<PaginatedResult<OpsAlertView>> {
    const pagination = normalisePagination(filter, ['lastSeenAt', 'severity', 'occurrences']);
    const where: Prisma.OpsAlertWhereInput = {
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.component ? { component: filter.component } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opsAlert.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'lastSeenAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.opsAlert.count({ where }),
    ]);

    return {
      items: rows.map((row) => alertRowToView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantScope: string | null | undefined, alertId: string): Promise<OpsAlertView> {
    const row = await this.prisma.opsAlert.findUnique({ where: { id: alertId } });
    if (row === null) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    this.assertReadable(row.tenantId, tenantScope);
    return alertRowToView(row);
  }

  // ------------------------------------------------------------------
  // mutations - narrow, explicit, audited
  // ------------------------------------------------------------------
  async acknowledge(actor: OpsActor, alertId: string, reason: string): Promise<AlertMutationResult> {
    const alert = await this.requireMutable(actor, alertId);
    if (alert.state !== 'OPEN') {
      throw new ConflictException({
        code: 'ALERT_NOT_OPEN',
        message: `Only OPEN alerts are acknowledged; this one is ${alert.state}. Acknowledgement is not resolution.`,
      });
    }

    const updated = await this.prisma.opsAlert.update({
      where: { id: alert.id },
      data: {
        state: 'ACKNOWLEDGED',
        acknowledgedBy: actor.userId,
        acknowledgedAt: new Date(),
      },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.OPS_ALERT_ACKNOWLEDGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'ops_alert',
      resourceId: alert.id,
      description: sanitiseForLog(reason, 500),
      metadata: { ruleId: alert.ruleId, component: alert.component, scope: alert.scope },
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
    });

    return { accepted: true, alert: alertRowToView(updated) };
  }

  async forceResolve(actor: OpsActor, alertId: string, reason: string, confirmPhrase: string): Promise<AlertMutationResult> {
    if (confirmPhrase !== ALERT_FORCE_RESOLVE_PHRASE) {
      throw new ConflictException({
        code: 'CONFIRMATION_PHRASE_REQUIRED',
        message:
          `Force-resolving without an observed recovery must quote "${ALERT_FORCE_RESOLVE_PHRASE}" ` +
          'verbatim. If the condition really has ended, the publisher will report the recovery and ' +
          'the alert resolves itself on the next sync.',
      });
    }
    const alert = await this.requireMutable(actor, alertId);
    if (alert.state === 'RESOLVED') {
      throw new ConflictException({
        code: 'ALERT_ALREADY_RESOLVED',
        message: 'This alert is already resolved.',
      });
    }

    const updated = await this.prisma.opsAlert.update({
      where: { id: alert.id },
      data: {
        state: 'RESOLVED',
        resolvedAt: new Date(),
        resolution: sanitiseForLog(`force-resolved by ${actor.userId}: ${reason}`, 500),
      },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.OPS_ALERT_FORCE_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'ops_alert',
      resourceId: alert.id,
      description: sanitiseForLog(reason, 500),
      metadata: { ruleId: alert.ruleId, component: alert.component, scope: alert.scope },
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
    });

    return { accepted: true, alert: alertRowToView(updated) };
  }

  // ------------------------------------------------------------------
  // the fold (maintenance queue calls this; safe to call any time)
  // ------------------------------------------------------------------
  async syncFromMirrors(): Promise<AlertSyncResult> {
    const result: AlertSyncResult = {
      services: [...OBS_PUBLISHER_SERVICES],
      inserted: 0,
      folded: 0,
      resolved: 0,
      incidentsFolded: 0,
      mirrorPresent: {},
    };

    for (const service of OBS_PUBLISHER_SERVICES) {
      const key = this.alertsMirrorKey(service);
      let raw: string | null = null;
      try {
        raw = await this.redis.client.get(key);
      } catch (error) {
        this.logger.warn(
          { event: 'ops.mirror_read_failed', service, errorType: (error as Error).name },
          'Operational alerts mirror unreadable; rows stay as they are (absence is not recovery)',
        );
        result.mirrorPresent[service] = false;
        continue;
      }
      if (raw === null) {
        result.mirrorPresent[service] = false;
        continue;
      }
      const document = parseAlertsDocument(raw);
      if (document === null) {
        this.logger.warn(
          { event: 'ops.mirror_unparseable', service },
          'Operational alerts mirror present but unparseable; treated as unreadable, never as empty',
        );
        result.mirrorPresent[service] = false;
        continue;
      }
      result.mirrorPresent[service] = true;

      const seenKeys = new Set<string>();
      for (const record of document.active) {
        const dedupeKey = this.dedupeKeyFor(record);
        seenKeys.add(dedupeKey);
        const folded = await this.foldAlert(record, dedupeKey, service);
        if (folded === 'inserted') {
          result.inserted += 1;
        } else {
          result.folded += 1;
        }
        result.incidentsFolded += await this.incidents.linkAlert(record, dedupeKey, service);
      }

      result.resolved += await this.resolveRecovered(service, seenKeys);
    }

    return result;
  }

  /** Retention: RESOLVED rows beyond the window, and their incident links'
   *  incidents when those are CLOSED beyond theirs. Unresolved rows are
   *  never touched regardless of age - that guard is the where clause, not
   *  a comment. */
  async prune(): Promise<{ alerts: number }> {
    const alertCutoff = new Date(
      Date.now() - this.config.alertRetentionDays * 86_400_000,
    );
    const deleted = await this.prisma.opsAlert.deleteMany({
      where: { state: 'RESOLVED', resolvedAt: { lt: alertCutoff } },
    });
    return { alerts: deleted.count };
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private alertsMirrorKey(service: string): string {
    return `wlct:trading:ops:alerts:${service}`;
  }

  private dedupeKeyFor(record: PublishedAlertRecord): string {
    return `${record.ruleId}|${record.component}|${record.scope ?? 'platform'}`;
  }

  private async foldAlert(
    record: PublishedAlertRecord,
    dedupeKey: string,
    service: string,
  ): Promise<'inserted' | 'folded'> {
    const rule = ALERT_RULE_CATALOG.find((candidate) => candidate.ruleId === record.ruleId);
    const firstSeen = new Date(Math.round(record.firstSeenAtMicros / 1000));
    const lastSeen = new Date(Math.round(record.lastSeenAtMicros / 1000));

    const existing = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
    if (existing === null) {
      await this.prisma.opsAlert.create({
        data: {
          dedupeKey,
          ruleId: record.ruleId,
          component: record.component,
          scope: record.scope,
          severity: record.severity,
          state: record.state,
          title: record.title,
          // The publisher's condition text can carry an operator note; it is
          // bounded and sanitised exactly like an audit description.
          condition: sanitiseForLog(record.condition, 500),
          message: record.message === null ? null : sanitiseForLog(record.message, 500),
          observedValue: record.observedValue,
          thresholdValue: record.thresholdValue,
          occurrences: record.occurrences,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
          acknowledgedBy: record.acknowledgedBy,
          acknowledgedAt:
            record.acknowledgedAtMicros === null ? null : new Date(Math.round(record.acknowledgedAtMicros / 1000)),
          links: { ...record.links, publisher: service } as Prisma.InputJsonValue,
        },
      });
      this.logger.info(
        { event: 'ops.alert_opened', ruleId: record.ruleId, component: record.component, service },
        'Operational alert opened from publisher mirror',
      );
      return 'inserted';
    }

    // FOLD semantics: occurrences is the publisher's cumulative count for
    // this active record, so the row MIRRORS it (max-guards against a
    // publisher restart resetting the count, which is not an event to
    // forget history over). State only advances OPEN -> ACKNOWLEDGED when
    // the publisher itself says ACKNOWLEDGED; it never moves backwards, and
    // a resolved row never reopens in place - a re-fire inserts a new row
    // under the same key after the old one is resolved-and-pruned... the
    // unique key would collide, so on collision with a RESOLVED row we
    // re-arm by clearing the resolution fields. That IS the "fresh record
    // after resolution" behaviour from the engine, mirrored durably.
    const reopening = existing.state === 'RESOLVED';
    await this.prisma.opsAlert.update({
      where: { id: existing.id },
      data: {
        state: reopening ? record.state : existing.state === 'OPEN' ? record.state : existing.state,
        severity: rule?.severity ?? record.severity,
        occurrences: Math.max(existing.occurrences, record.occurrences),
        lastSeenAt: lastSeen < existing.lastSeenAt ? existing.lastSeenAt : lastSeen,
        observedValue: record.observedValue ?? existing.observedValue,
        thresholdValue: record.thresholdValue ?? existing.thresholdValue,
        message: record.message === null ? existing.message : sanitiseForLog(record.message, 500),
        links: { ...record.links, publisher: service } as Prisma.InputJsonValue,
        ...(reopening
          ? {
              resolvedAt: null,
              resolution: null,
              acknowledgedAt: null,
              acknowledgedBy: null,
              firstSeenAt: firstSeen,
            }
          : {}),
      },
    });
    return 'folded';
  }

  /** Publisher mirror present, record no longer listed => recovery was
   *  OBSERVED by the thing that knows. Resolve with that as the resolution
   *  text. Only rows belonging to this publisher (by component namespace
   *  recorded in `links.publisher`) and not operator-held are touched. */
  private async resolveRecovered(service: string, seenKeys: ReadonlySet<string>): Promise<number> {
    const open = await this.prisma.opsAlert.findMany({
      where: { state: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      take: 500,
    });
    let resolved = 0;
    for (const row of open) {
      if (seenKeys.has(row.dedupeKey)) {
        continue;
      }
      const publisher = (row.links as Record<string, unknown> | null)?.publisher;
      if (publisher !== service) {
        continue; // another publisher's row; its own sync pass handles it
      }
      await this.prisma.opsAlert.update({
        where: { id: row.id },
        data: {
          state: 'RESOLVED',
          resolvedAt: new Date(),
          resolution: 'recovered (observed by publisher mirror)',
        },
      });
      resolved += 1;
      this.logger.info(
        { event: 'ops.alert_resolved', ruleId: row.ruleId, component: row.component, service },
        'Operational alert resolved on observed recovery',
      );
    }
    return resolved;
  }

  /**
   * Queue-alert policy, evaluated by the API because the queue backend is
   * the API's to see. Each sample says whether a queue's oldest pending job
   * is past the alert age; the EXECUTION queue fires at HALF the age with
   * the CRITICAL rule - a control-queue backlog is paperwork piling up, an
   * execution backlog while trading is on means live orders are waiting on
   * us, and the policy is the part that must differ.
   *
   * The API is its own publisher here (links.publisher = "api"), so an
   * absent condition on the next sample IS the observed recovery.
   */
  async applyQueueAlerts(samples: ReadonlyArray<{
    queue: string;
    oldestWaitingAgeMs: number | null;
    alerting: boolean;
    critical: boolean;
  }>): Promise<void> {
    const now = new Date();
    const nowMicros = now.getTime() * 1000;
    for (const sample of samples) {
      const ruleId = sample.critical ? 'EXECUTION_QUEUE_BACKLOG' : 'QUEUE_BACKLOG';
      const dedupeKey = `${ruleId}|queues|${sample.queue}`;
      if (!sample.alerting) {
        // Recovery observed (or never needed): close any open row for this
        // queue/rule pair, nothing more.
        const open = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
        if (open !== null && open.state !== 'RESOLVED' && (open.links as Record<string, unknown> | null)?.publisher === 'api') {
          await this.prisma.opsAlert.update({
            where: { id: open.id },
            data: { state: 'RESOLVED', resolvedAt: now, resolution: 'recovered (queue age back within policy)' },
          });
        }
        continue;
      }
      const title = sample.critical
        ? `Execution queue backlog on ${sample.queue}`
        : `Queue backlog on ${sample.queue}`;
      await this.prisma.opsAlert.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          ruleId,
          component: 'queues',
          scope: sample.queue,
          severity: sample.critical ? 'CRITICAL' : 'WARNING',
          state: 'OPEN',
          title,
          condition:
            `oldest pending job exceeded ${sample.critical ? 'half of ' : ''}` +
            `${this.config.queueAlertAgeMs}ms (QUEUE_ALERT_AGE_MS)`,
          message: `oldest waiting job: ${sample.oldestWaitingAgeMs ?? 'unknown'}ms`,
          observedValue: sample.oldestWaitingAgeMs === null ? null : String(sample.oldestWaitingAgeMs),
          thresholdValue: String(sample.critical ? Math.floor(this.config.queueAlertAgeMs / 2) : this.config.queueAlertAgeMs),
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          links: { publisher: 'api', firstObservedMicros: String(nowMicros) },
        },
        update: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          message: `oldest waiting job: ${sample.oldestWaitingAgeMs ?? 'unknown'}ms`,
          observedValue: sample.oldestWaitingAgeMs === null ? undefined : String(sample.oldestWaitingAgeMs),
          // A queue alert whose row was force-resolved but is firing again
          // re-arms; see foldAlert for the same discipline on the engine side.
          ...(await this.isResolvedRecently(dedupeKey))
            ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
            : {},
        },
      });
    }
  }

  /**
   * Part 10: the SLO evaluator's alert fold, same discipline as the queue
   * fold above it - a paging objective UPSERTs its row (occurrences grow,
   * never multiply), and an objective that stopped paging closes only
   * because the evaluator OBSERVED the burn verdict gone this tick.
   * `coveredSloIds` is the guard rail: recovery resolution only ever
   * touches SLOs the evaluation actually saw this tick. An evaluation that
   * crashed midway (or never ran) must not resolve anyone's evidence.
   */
  async applySloAlerts(
    rows: ReadonlyArray<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }>,
    coveredSloIds: ReadonlySet<string>,
  ): Promise<void> {
    const now = new Date();
    const nowMicros = now.getTime() * 1000;
    const openKeys = new Set(rows.map((row) => `${row.ruleId}|slo:${row.sloId}`));
    for (const row of rows) {
      const dedupeKey = `${row.ruleId}|slo:${row.sloId}`;
      await this.prisma.opsAlert.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          ruleId: row.ruleId,
          component: 'slo',
          scope: row.sloId,
          severity: row.severity,
          state: 'OPEN',
          title: row.title.slice(0, 255),
          condition: row.condition.slice(0, 500),
          message: row.message.slice(0, 500),
          observedValue: row.observedValue,
          thresholdValue: row.thresholdValue,
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          links: { publisher: 'api', firstObservedMicros: String(nowMicros) },
        },
        update: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          message: row.message.slice(0, 500),
          observedValue: row.observedValue ?? undefined,
          thresholdValue: row.thresholdValue ?? undefined,
          ...(await this.isResolvedRecently(dedupeKey))
            ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
            : {},
        },
      });
    }
    if (coveredSloIds.size === 0) {
      return;
    }
    const openRows = await this.prisma.opsAlert.findMany({
      where: {
        ruleId: {
          in: ['SLO_BURN_FAST', 'SLO_BURN_SLOW', 'SLO_BUDGET_EXHAUSTED', 'SLO_TELEMETRY_GAP'],
        },
        state: { not: 'RESOLVED' },
      },
      select: { id: true, dedupeKey: true, scope: true },
    });
    for (const alert of openRows) {
      if (alert.scope === null || !coveredSloIds.has(alert.scope)) {
        continue;
      }
      if (openKeys.has(alert.dedupeKey)) {
        continue;
      }
      await this.prisma.opsAlert.update({
        where: { id: alert.id },
        data: {
          state: 'RESOLVED',
          resolvedAt: now,
          resolution: 'recovered (evaluator observed burn verdict clear)',
        },
      });
    }
  }

  /**
   * Part 10: the telemetry export outage alert, opened and closed by the
   * API process for itself (the engines page through their own mirror
   * folds; this row's publisher is the API because the API's exporter is
   * the thing failing). WARNING by catalog law: a dark platform is an
   * observability incident, not a trading one, and the message says so.
   */
  async telemetryExportFailing(
    service: string,
    failing: boolean,
    consecutive: number,
  ): Promise<void> {
    const dedupeKey = `TELEMETRY_EXPORT_FAILING|${service}|telemetry`;
    const now = new Date();
    if (!failing) {
      const open = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
      if (open !== null && open.state !== 'RESOLVED') {
        await this.prisma.opsAlert.update({
          where: { id: open.id },
          data: {
            state: 'RESOLVED',
            resolvedAt: now,
            resolution: 'recovered (export succeeded again)',
          },
        });
      }
      return;
    }
    await this.prisma.opsAlert.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        ruleId: 'TELEMETRY_EXPORT_FAILING',
        component: service,
        scope: 'telemetry',
        severity: 'WARNING',
        state: 'OPEN',
        title: `Telemetry export failing on ${service}`,
        condition: 'consecutive OTLP export failures >= 3',
        message: `${String(consecutive)} consecutive export failures; platform running darker than configured`,
        observedValue: String(consecutive),
        thresholdValue: '3',
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        links: { publisher: 'api' },
      },
      update: {
        occurrences: { increment: 1 },
        lastSeenAt: now,
        observedValue: String(consecutive),
        ...(await this.isResolvedRecently(dedupeKey))
          ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
          : {},
      },
    });
  }

  private async isResolvedRecently(dedupeKey: string): Promise<boolean> {
    const row = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
    return row !== null && row.state === 'RESOLVED';
  }

  private assertReadable(rowTenantId: string | null, callerTenant: string | null | undefined): void {
    // Platform rows (null tenant) are operation infrastructure: readable by
    // any console with the read grant. Tenant rows are visible only to that
    // tenant.
    if (rowTenantId !== null && rowTenantId !== callerTenant) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
  }

  private async requireMutable(actor: OpsActor, alertId: string): Promise<{
    id: string;
    state: string;
    ruleId: string;
    component: string;
    scope: string | null;
    tenantId: string | null;
  }> {
    const row = await this.prisma.opsAlert.findUnique({ where: { id: alertId } });
    if (row === null) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    if (row.tenantId !== null && row.tenantId !== actor.tenantId) {
      // Same code as not-found: existence of another tenant's alert is not
      // this caller's information.
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    if (row.tenantId === null && !actor.platform) {
      throw new ConflictException({
        code: 'PLATFORM_ALERT_REQUIRES_PLATFORM_ROLE',
        message:
          'This is a platform-infrastructure alert; tenant administrators read them but only the ' +
          'platform break-glass role acknowledges or resolves them.',
      });
    }
    return row;
  }
}
