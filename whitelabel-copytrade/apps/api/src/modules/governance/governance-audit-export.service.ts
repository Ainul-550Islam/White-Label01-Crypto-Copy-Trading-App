// # Responsibility: builds deterministic, hash-chained governance audit exports synchronously up to a size cap and on the durable audit queue beyond it, and answers tenant-scoped polls for queued jobs.
import * as crypto from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QUEUE_NAMES } from '@wlct/config';

import { QueueService } from '../queue/queue.service';
import {
  auditExportResultSchema,
  type AuditExportEntityType,
  type AuditExportFiltersDto,
  type AuditExportJobStateDto,
  type AuditExportJobStateName,
  type AuditExportResultDto,
} from './dto/audit-export-job-state.dto';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceActionType, type GovernanceAuditEvent } from './governance.types';

/**
 * Governance audit export.
 *
 * The export is evidence, so it is built like evidence:
 *
 * - Rows are deterministically ordered (createdAt, then id) and hash-chained:
 *   each row carries sha256(previousHash + "\n" + canonical row) and the
 *   manifest carries sha256 of the whole canonical document, so a one-byte
 *   edit anywhere in the downloaded file fails verification in the console.
 * - Raw actor and subject user ids never enter the file. They are replaced
 *   by one-way tenant-scoped SHA-256 references, which keeps rows joinable
 *   inside one export without making the export a user-id directory.
 * - The read is tenant-bound twice: the source query is tenant-filtered and
 *   any foreign-tenant row that still appears aborts the export, because a
 *   source that can hand back another tenant's row cannot be trusted to
 *   have filtered anything else either.
 * - Small exports are built on the request path. Anything beyond the
 *   synchronous cap is queued on the durable audit queue and the caller
 *   polls `GET audit/export/:jobId`; the queued job runs the SAME builder
 *   through `processQueuedExport`, so the two paths cannot drift.
 * - Every completed export writes its own AUDIT_EXPORT audit event: the
 *   act of exporting the audit trail is itself part of the audit trail.
 */

export interface AuditExportFilters {
  actorId?: string;
  actionType?: GovernanceActionType;
  subjectUserId?: string;
  entityType?: AuditExportEntityType;
  entityId?: string;
  outcome?: string;
}

export interface AuditExportRow {
  id: string;
  tenantId: string;
  actionType: GovernanceActionType;
  state: string;
  result: string;
  reason: string | null;
  correlationId: string;
  createdAt: string;
  actorReference: string;
  subjectReference: string | null;
  entityType: AuditExportEntityType | null;
  entityId: string | null;
  safeEvidence: Record<string, unknown>;
  previousHash: string;
  rowHash: string;
}

export interface AuditExportManifest {
  format: string;
  sha256: string;
  rowCount: number;
  chainTip: string;
  tenantId: string;
  periodStart: string;
  periodEndExclusive: string;
  filters: AuditExportFiltersDto;
}

export interface AuditExport {
  id: string;
  tenantId: string;
  exportVersion: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  dataAsOf: string;
  recordCount: number;
  sourceReferences: string[];
  fileLocation: string;
  fileHash: string;
  fileContents: string;
  rows: AuditExportRow[];
  manifest: AuditExportManifest;
  methodology: string;
  policyVersion: string;
  correlationId: string;
  isDeterministic: boolean;
  filtersApplied: AuditExportFiltersDto;
}

export interface AuditExportQueued {
  id: string;
  tenantId: string;
  status: 'QUEUED';
  statusPath: string;
  submittedAt: string;
}

export interface AuditExportJobPayload {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  correlationId: string;
  operatorId: string;
  filters?: AuditExportFilters;
}

interface AuditExportParams extends AuditExportJobPayload {}

/** Rows one request may build inline. Beyond this the export is queued. */
const SYNC_ROW_CAP = 2_000;
/** Rows one queued job may build. A larger ask must be narrowed, not streamed unbounded through one job. */
const QUEUED_ROW_CAP = 100_000;
const EXPORT_JOB_NAME = 'governance-audit-export';
const EXPORT_FORMAT = 'wlct-governance-audit-export/v1';
const GENESIS_HASH = '0'.repeat(64);
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const ENTITY_FIELDS: ReadonlyArray<{
  type: AuditExportEntityType;
  field: 'requestId' | 'reportId' | 'evidencePackageId' | 'legalHoldId' | 'retentionCandidateId' | 'consentId';
}> = [
  { type: 'REQUEST', field: 'requestId' },
  { type: 'REPORT', field: 'reportId' },
  { type: 'EVIDENCE_PACKAGE', field: 'evidencePackageId' },
  { type: 'LEGAL_HOLD', field: 'legalHoldId' },
  { type: 'RETENTION_CANDIDATE', field: 'retentionCandidateId' },
  { type: 'CONSENT', field: 'consentId' },
];

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

@Injectable()
export class GovernanceAuditExportService {
  private readonly logger = new Logger(GovernanceAuditExportService.name);

  constructor(
    private readonly audit: GovernanceAuditService,
    private readonly policyService: GovernancePolicyService,
    private readonly queue: QueueService,
  ) {}

  async exportAuditTrail(params: AuditExportParams): Promise<AuditExport | AuditExportQueued> {
    const { start, end } = this.validatedPeriod(params);
    const events = await this.tenantBoundEvents(params.tenantId, params.filters, SYNC_ROW_CAP + 1);
    const filtered = this.applyFilters(events, start, end, params.filters);

    if (events.length > SYNC_ROW_CAP || filtered.length > SYNC_ROW_CAP) {
      // The synchronous read is capped on purpose: at this size the honest
      // answer is a durable job the operator can poll, not a request that
      // holds a connection open while it hashes an unbounded trail. A full
      // page also means rows may exist beyond what was read, and a silently
      // truncated export would be worse than a queued one.
      const payload: AuditExportJobPayload = {
        tenantId: params.tenantId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        correlationId: params.correlationId,
        operatorId: params.operatorId,
        filters: params.filters,
      };
      const jobId = await this.queue.enqueueOrThrow(QUEUE_NAMES.AUDIT, EXPORT_JOB_NAME, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Completed and failed jobs stay readable for a day: the poll route
        // reads the result back out of the job, and a job deleted on
        // completion would make a successful export unanswerable.
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      });
      this.logger.log(
        `audit export queued job=${jobId} tenant=${params.tenantId} corr=${params.correlationId}`,
      );
      return {
        id: jobId,
        tenantId: params.tenantId,
        status: 'QUEUED',
        statusPath: `/v1/governance/audit/export/${encodeURIComponent(jobId)}`,
        submittedAt: new Date().toISOString(),
      };
    }

    return this.buildExport(params, filtered, start, end);
  }

  /** The queued path: identical builder, larger bounded read. */
  async processQueuedExport(payload: AuditExportJobPayload): Promise<AuditExport> {
    const { start, end } = this.validatedPeriod(payload);
    const events = await this.tenantBoundEvents(payload.tenantId, payload.filters, QUEUED_ROW_CAP + 1);
    const filtered = this.applyFilters(events, start, end, payload.filters);
    if (events.length > QUEUED_ROW_CAP || filtered.length > QUEUED_ROW_CAP) {
      throw new BadRequestException(
        `Audit export exceeds the ${QUEUED_ROW_CAP} row ceiling for one job; narrow the period or filters and resubmit`,
      );
    }
    return this.buildExport(payload, filtered, start, end);
  }

  /**
   * Poll one queued export. Tenant-scoped absolutely: a job that belongs to
   * another tenant, a job of another name sharing the audit queue, and a job
   * that does not exist are the same 404, so the route cannot be used to
   * enumerate other tenants' export activity.
   */
  async getExportJob(tenantId: string, jobId: string): Promise<AuditExportJobStateDto> {
    if (!tenantId || typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) {
      throw new NotFoundException('Audit export job not found');
    }
    const job = await this.queue.getQueue(QUEUE_NAMES.AUDIT).getJob(jobId);
    if (!job || job.name !== EXPORT_JOB_NAME) {
      throw new NotFoundException('Audit export job not found');
    }
    const payload = (job.data ?? {}) as Partial<AuditExportJobPayload>;
    if (payload.tenantId !== tenantId) {
      throw new NotFoundException('Audit export job not found');
    }

    const rawState = await job.getState().catch(() => 'unknown');
    const state = this.mapJobState(rawState);
    const view: AuditExportJobStateDto = { id: String(job.id), tenantId, state };

    if (state === 'completed') {
      const result = this.toResultDto(job.returnvalue as AuditExport | undefined);
      if (result) {
        view.result = result;
      } else {
        // A finished job whose result cannot be read back is not a success
        // the console can verify; report it as failed rather than handing
        // back "completed" with nothing to download.
        view.state = 'failed';
        view.failureReason = 'Audit export job completed without a readable result; resubmit the export.';
      }
    }
    if (state === 'failed') {
      const reason = typeof job.failedReason === 'string' ? job.failedReason.trim() : '';
      view.failureReason = reason ? reason.slice(0, 500) : 'Audit export job failed.';
    }
    return view;
  }

  private validatedPeriod(params: AuditExportParams): { start: Date; end: Date } {
    if (!params.tenantId || !params.periodStart || !params.periodEnd) {
      throw new BadRequestException('tenantId, periodStart, periodEnd required');
    }
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('invalid period dates');
    if (start >= end) throw new BadRequestException('periodStart must be before periodEnd');
    return { start, end };
  }

  private async tenantBoundEvents(
    tenantId: string,
    filters: AuditExportFilters | undefined,
    take: number,
  ): Promise<GovernanceAuditEvent[]> {
    // Non-mutating: only reads, never modifies audit rows.
    const events = await this.audit.listEvents(tenantId, {
      actionType: filters?.actionType,
      subjectUserId: filters?.subjectUserId,
      take,
    });
    for (const event of events) {
      if (event.tenantId !== tenantId) {
        throw new ForbiddenException(
          'Audit export refused: the source returned a row outside the authenticated tenant',
        );
      }
    }
    return events;
  }

  private applyFilters(
    events: GovernanceAuditEvent[],
    start: Date,
    end: Date,
    filters: AuditExportFilters | undefined,
  ): GovernanceAuditEvent[] {
    const filtered = events.filter((event) => {
      const created = new Date(event.createdAt);
      // Period end is exclusive: the console asks for [start, end) days, and
      // the manifest names the bound periodEndExclusive so the file says so.
      if (!(created >= start && created < end)) return false;
      if (filters?.actorId !== undefined && event.createdBy !== filters.actorId) return false;
      if (filters?.actionType !== undefined && event.actionType !== filters.actionType) return false;
      if (filters?.subjectUserId !== undefined && event.subjectUserId !== filters.subjectUserId) return false;
      if (filters?.outcome !== undefined && event.result !== filters.outcome) return false;
      if (filters?.entityType !== undefined || filters?.entityId !== undefined) {
        const wanted = ENTITY_FIELDS.filter(
          (entry) => filters.entityType === undefined || entry.type === filters.entityType,
        );
        const matches = wanted.some((entry) => {
          const value = event[entry.field];
          if (value === null || value === undefined) return false;
          return filters.entityId === undefined || value === filters.entityId;
        });
        if (!matches) return false;
      }
      return true;
    });
    // Deterministic sort: the hash chain and the manifest digest are only
    // reproducible if the row order is a function of the rows, not of the
    // order the store happened to return them in.
    filtered.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });
    return filtered;
  }

  private reference(tenantId: string, kind: 'actor' | 'subject', rawId: string): string {
    return sha256(`${kind}:${tenantId}:${rawId}`);
  }

  /** Filters as the operator supplied them (the API echo; never enters the file verbatim when it names a user). */
  private filtersApplied(filters: AuditExportFilters | undefined): AuditExportFiltersDto {
    const out: AuditExportFiltersDto = {};
    if (filters?.actorId !== undefined) out.actorId = filters.actorId;
    if (filters?.actionType !== undefined) out.actionType = filters.actionType;
    if (filters?.subjectUserId !== undefined) out.subjectUserId = filters.subjectUserId;
    if (filters?.entityType !== undefined) out.entityType = filters.entityType;
    if (filters?.entityId !== undefined) out.entityId = filters.entityId;
    if (filters?.outcome !== undefined) out.outcome = filters.outcome;
    return out;
  }

  /** Filters as recorded inside the exported file: user ids replaced by their one-way references. */
  private manifestFilters(tenantId: string, filters: AuditExportFilters | undefined): AuditExportFiltersDto {
    const out = this.filtersApplied(filters);
    if (out.actorId !== undefined) out.actorId = `sha256:${this.reference(tenantId, 'actor', out.actorId)}`;
    if (out.subjectUserId !== undefined) {
      out.subjectUserId = `sha256:${this.reference(tenantId, 'subject', out.subjectUserId)}`;
    }
    return out;
  }

  private async buildExport(
    params: AuditExportParams,
    filtered: GovernanceAuditEvent[],
    start: Date,
    end: Date,
  ): Promise<AuditExport> {
    const rows: AuditExportRow[] = [];
    let previousHash = GENESIS_HASH;
    for (const event of filtered) {
      const entity = ENTITY_FIELDS.find((entry) => event[entry.field] !== null && event[entry.field] !== undefined);
      const base = {
        id: event.id,
        tenantId: event.tenantId,
        actionType: event.actionType,
        state: event.state,
        result: event.result,
        reason: event.reason ?? null,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
        actorReference: this.reference(params.tenantId, 'actor', event.createdBy),
        subjectReference: event.subjectUserId
          ? this.reference(params.tenantId, 'subject', event.subjectUserId)
          : null,
        entityType: entity ? entity.type : null,
        entityId: entity ? String(event[entity.field]) : null,
        safeEvidence: event.safeEvidence,
      };
      const rowHash = sha256(`${previousHash}\n${JSON.stringify(base)}`);
      rows.push({ ...base, previousHash, rowHash });
      previousHash = rowHash;
    }

    const manifestFilters = this.manifestFilters(params.tenantId, params.filters);
    const canonical = JSON.stringify({
      tenantId: params.tenantId,
      periodStart: start.toISOString(),
      periodEndExclusive: end.toISOString(),
      filters: manifestFilters,
      rows,
    });
    const fileHash = sha256(canonical);
    const manifest: AuditExportManifest = {
      format: EXPORT_FORMAT,
      sha256: fileHash,
      rowCount: rows.length,
      chainTip: previousHash,
      tenantId: params.tenantId,
      periodStart: start.toISOString(),
      periodEndExclusive: end.toISOString(),
      filters: manifestFilters,
    };
    const fileContents = JSON.stringify({ manifest, rows });
    const exportedAt = new Date();
    const policyVersion = this.policyService.getPolicyVersion();

    const exportRecord: AuditExport = {
      id: `aexp_${exportedAt.getTime()}_${crypto.randomBytes(4).toString('hex')}`,
      tenantId: params.tenantId,
      exportVersion: `v${policyVersion}_${exportedAt.toISOString().slice(0, 10)}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      generatedAt: exportedAt.toISOString(),
      dataAsOf: exportedAt.toISOString(),
      recordCount: rows.length,
      sourceReferences: [...new Set(filtered.map((e) => `${e.actionType}:${e.correlationId}`))].sort(),
      fileLocation: `governance/audit-exports/${params.tenantId}/${exportedAt.getTime()}.json`,
      fileHash,
      fileContents,
      rows,
      manifest,
      methodology: `NON_MUTATING_AUDIT_EXPORT_DETERMINISTIC_SORTED_POLICY_${policyVersion}`,
      policyVersion,
      correlationId: params.correlationId,
      isDeterministic: true,
      filtersApplied: this.filtersApplied(params.filters),
    };

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.AUDIT_EXPORT,
      state: 'EXPORTED',
      result: 'SUCCESS',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { exportId: exportRecord.id, recordCount: exportRecord.recordCount, fileHash },
    });

    this.logger.log(
      `audit export generated id=${exportRecord.id} tenant=${params.tenantId} records=${exportRecord.recordCount} corr=${params.correlationId}`,
    );
    return exportRecord;
  }

  private toResultDto(record: AuditExport | undefined): AuditExportResultDto | null {
    if (!record || typeof record !== 'object') return null;
    const candidate: AuditExportResultDto = {
      id: record.id,
      tenantId: record.tenantId,
      fileHash: record.fileHash,
      fileContents: record.fileContents,
      recordCount: record.recordCount,
      filtersApplied: record.filtersApplied ?? {},
      manifest: record.manifest,
    };
    const parsed = auditExportResultSchema.safeParse(candidate);
    return parsed.success ? candidate : null;
  }

  private mapJobState(rawState: string): AuditExportJobStateName {
    switch (rawState) {
      case 'waiting':
      case 'prioritized':
      case 'paused':
      case 'waiting-children':
        return 'waiting';
      case 'active':
        return 'active';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'delayed':
        return 'delayed';
      default:
        return 'unknown';
    }
  }
}
