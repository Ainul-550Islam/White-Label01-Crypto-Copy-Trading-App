import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome, type PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { incidentRowToView } from './observability.mapper';
import type {
  OpsActor,
  OpsIncidentView,
  PublishedAlertRecord,
} from './observability.types';

/**
 * Incidents: one story, several correlated records, links only.
 *
 * Mirrors the engine-side `wlct_trading.observability.incidents` design
 * exactly, and for the same reasons. An incident row owns NO copies of the
 * events it explains - links are (kind, targetId) pairs into the tables that
 * hold the truth - so it cannot drift from its evidence and cannot become a
 * secret-bearing shadow log. Grouping prefers `correlation:<id>` (the chain
 * the correlation headers carry) and falls back to a digest of the link set,
 * so the same evidence folds to the same incident without anyone declaring
 * it once at creation time.
 *
 * Who writes: only the alert fold (`linkAlert`, called by AlertsService)
 * creates rows here, plus explicit operator status moves. There is no
 * generic "create incident" endpoint on purpose: an incident nobody observed
 * is a rumor, and the platform prefers rumors to be alerts first.
 */
@Injectable()
export class IncidentsService {
  private static readonly MAX_LINKS_PER_INCIDENT = 512;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(IncidentsService.name) private readonly logger: PinoLogger,
  ) {}

  async list(
    callerTenant: string | null | undefined,
    filter: { page: number; limit: number; status?: 'OPEN' | 'REVIEWING' | 'CLOSED' },
  ): Promise<PaginatedResult<OpsIncidentView>> {
    const pagination = normalisePagination(filter, ['openedAt']);
    const where: Prisma.OpsIncidentWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      // Tenant scoping matches alerts: platform rows (null) are readable by
      // any operations reader; another tenant's rows are invisible, not 403.
      ...(callerTenant === null || callerTenant === undefined
        ? { tenantId: null }
        : { OR: [{ tenantId: callerTenant }, { tenantId: null }] }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opsIncident.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'openedAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
        include: { links: { orderBy: [{ kind: 'asc' }, { targetId: 'asc' }] } },
      }),
      this.prisma.opsIncident.count({ where }),
    ]);

    return {
      items: rows.map((row) => incidentRowToView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(callerTenant: string | null | undefined, id: string): Promise<OpsIncidentView> {
    const row = await this.prisma.opsIncident.findUnique({
      where: { id },
      include: { links: { orderBy: [{ kind: 'asc' }, { targetId: 'asc' }] } },
    });
    if (row === null || (row.tenantId !== null && row.tenantId !== callerTenant)) {
      throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'No such incident.' });
    }
    return incidentRowToView(row);
  }

  /** Operator status transition. Closing REQUIRES a note - an incident that
   *  ends without saying why is the "silently marked resolved" failure, one
   *  abstraction level up. */
  async setStatus(
    actor: OpsActor,
    incidentId: string,
    status: 'OPEN' | 'REVIEWING' | 'CLOSED',
    note: string | undefined,
  ): Promise<OpsIncidentView> {
    const row = await this.prisma.opsIncident.findUnique({
      where: { id: incidentId },
      include: { links: true },
    });
    if (row === null || (row.tenantId !== null && row.tenantId !== actor.tenantId)) {
      throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'No such incident.' });
    }
    if (row.tenantId === null && !actor.platform) {
      throw new BadRequestException({
        code: 'PLATFORM_INCIDENT_REQUIRES_PLATFORM_ROLE',
        message: 'Platform-infrastructure incidents change status under the platform role.',
      });
    }
    if (status === 'CLOSED' && (note === undefined || note.trim().length < 10)) {
      throw new BadRequestException({
        code: 'CLOSE_NOTE_REQUIRED',
        message: 'Closing an incident requires a note of at least 10 characters.',
      });
    }

    const updated = await this.prisma.opsIncident.update({
      where: { id: row.id },
      data: {
        status,
        closedAt: status === 'CLOSED' ? new Date() : null,
        closeNote: status === 'CLOSED' ? sanitiseForLog(note ?? '', 500) : null,
      },
      include: { links: true },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.OPS_INCIDENT_STATUS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'ops_incident',
      resourceId: row.id,
      description: sanitiseForLog(note ?? `status -> ${status}`, 500),
      metadata: { from: row.status, to: status },
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
    });

    return incidentRowToView(updated);
  }

  /**
   * The fold path: for one alert record just synced, upsert the incident its
   * correlation id names (or its dedupe key when it carries no correlation)
   * and link the alert + every risk-event link the publisher recorded.
   * Returns how many incident rows changed (0 or 1 - the link inserts fold
   * against their own unique constraint).
   */
  async linkAlert(record: PublishedAlertRecord, dedupeKey: string, service: string): Promise<number> {
    const correlationId = record.links['correlation_id'] ?? null;
    const operationId = record.links['operation_id'] ?? null;
    const groupingKey = correlationId !== null ? `correlation:${correlationId}` : `links:${digestOf(dedupeKey)}`;
    const incidentId = `inc_${digestOf(`${groupingKey}|${Math.floor(record.firstSeenAtMicros / 86_400_000_000_000)}`)}`;
    const openedAt = new Date(Math.round(record.firstSeenAtMicros / 1000));

    const existing = await this.prisma.opsIncident.findUnique({ where: { groupingKey } });
    const incident =
      existing ??
      (await this.prisma.opsIncident.create({
        data: {
          incidentId,
          groupingKey,
          title: sanitiseForLog(`Alerted operations context: ${record.title}`, 200),
          status: 'OPEN',
          severity: record.severity,
          correlationId,
          operationId,
          openedAt,
        },
      }));

    const links: { kind: 'ALERT' | 'RISK_EVENT'; targetId: string; note: string | null }[] = [
      { kind: 'ALERT', targetId: dedupeKey, note: service },
    ];
    const riskEvent = record.links['risk_event'];
    if (riskEvent !== undefined && riskEvent !== '') {
      links.push({ kind: 'RISK_EVENT', targetId: riskEvent, note: null });
    }
    // The budget check is per-write, not per-load: counting an incident's
    // existing links on every fold would query the link table to protect a
    // table nobody is reading in bulk. 512 links per incident is the engine
    // contract; anything past it is refused upstream by the same rule.
    if (links.length > IncidentsService.MAX_LINKS_PER_INCIDENT) {
      return 0;
    }
    for (const link of links) {
      await this.prisma.opsIncidentLink.upsert({
        where: {
          incidentId_kind_targetId: {
            incidentId: incident.id,
            kind: link.kind,
            targetId: link.targetId.slice(0, 128),
          },
        },
        create: {
          incidentId: incident.id,
          kind: link.kind,
          targetId: link.targetId.slice(0, 128),
          note: link.note === null ? null : link.note.slice(0, 255),
        },
        update: {},
      });
    }

    if (existing === null) {
      this.logger.info(
        { event: 'ops.incident_opened', groupingKey, service },
        'Incident opened from correlated alert evidence',
      );
      return 1;
    }
    return 0;
  }
}

const digestOf = (value: string): string => {
  // Small, dependency-free, deterministic digest for grouping keys. This is
  // a fold key, not a security primitive, so FNV over the string is enough
  // - and stating WHICH it is matters more than pretending it is strong.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
};
