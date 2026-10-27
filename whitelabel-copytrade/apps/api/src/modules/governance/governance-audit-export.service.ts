// # Builds tenant-scoped, bounded, verifiable governance audit exports.
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';
import { AuditExportIntentStore, type StoredQueuedIntent } from './audit-export-intent.store';
import { QueueService } from '../queue/queue.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceActionType, type GovernanceAuditEvent } from './governance.types';

export type AuditEntityType = 'REQUEST' | 'REPORT' | 'EVIDENCE_PACKAGE' | 'LEGAL_HOLD' | 'RETENTION_CANDIDATE' | 'CONSENT';
export interface AuditExportFilters { actorId?: string; actionType?: GovernanceActionType; subjectUserId?: string; entityType?: AuditEntityType; entityId?: string; outcome?: string; }
export interface AuditExportJobPayload { tenantId: string; periodStart: string; periodEnd: string; correlationId: string; operatorId: string; filters?: AuditExportFilters; keyHash?: string; requestHash?: string; jobId?: string; }
export interface AuditExportRow { id: string; actionType: GovernanceActionType; actorReference: string; subjectReference: string | null; state: string; result: string; correlationId: string; createdAt: string; safeEvidence: Record<string, unknown>; previousHash: string; rowHash: string; }
export interface AuditExportManifest { format: string; sha256: string; rowCount: number; chainTip: string; tenantId: string; periodStart: string; periodEndExclusive: string; filters: AuditExportFilters; }
export interface AuditExport { id: string; tenantId: string; fileHash: string; fileContents: string; recordCount: number; filtersApplied: AuditExportFilters; manifest: AuditExportManifest; rows: AuditExportRow[]; }
export interface AuditExportQueued { id: string; tenantId: string; status: 'QUEUED'; statusPath: string; submittedAt: string; }
const SYNC_LIMIT = 2_000;
const HARD_LIMIT = 20_000;
const ENTITIES: Record<AuditEntityType, keyof GovernanceAuditEvent> = { REQUEST: 'requestId', REPORT: 'reportId', EVIDENCE_PACKAGE: 'evidencePackageId', LEGAL_HOLD: 'legalHoldId', RETENTION_CANDIDATE: 'retentionCandidateId', CONSENT: 'consentId' };
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
// JSONB does not preserve property order. Hash a fixed field order both before
// persistence and after replay instead of depending on object insertion order.
function requestDigest(input: AuditExportJobPayload): string {
  const filters = input.filters ?? {};
  return digest(JSON.stringify({ tenantId: input.tenantId, periodStart: input.periodStart, periodEnd: input.periodEnd,
    correlationId: input.correlationId, operatorId: input.operatorId, filters: { actorId: filters.actorId, actionType: filters.actionType,
      subjectUserId: filters.subjectUserId, entityType: filters.entityType, entityId: filters.entityId, outcome: filters.outcome } }));
}

@Injectable()
export class GovernanceAuditExportService {
  private readonly logger = new Logger(GovernanceAuditExportService.name);
  private relayRunning = false;
  private tenantCursor: string | undefined;
  constructor(private readonly audit: GovernanceAuditService, private readonly policyService: GovernancePolicyService, private readonly queues: QueueService, private readonly intents: AuditExportIntentStore) {}

  async exportAuditTrail(input: AuditExportJobPayload, idempotencyKey: string): Promise<AuditExport | AuditExportQueued> {
    const params = this.validate(input);
    const requestHash = requestDigest(params);
    const result = await this.intents.execute(params.tenantId, idempotencyKey, requestHash, async (tx, keyHash) => {
      const events = await this.query(params, SYNC_LIMIT + 1, tx);
      if (events.length > SYNC_LIMIT) {
        // A fresh intent epoch gets a fresh job id, even if the same key is
        // deliberately reused after expiry and an old Redis job still exists.
        const id = `audit-${digest(`${params.tenantId}:${keyHash}:${randomUUID()}`)}`;
        const payload: AuditExportJobPayload = { ...params, keyHash, requestHash, jobId: id };
        await this.intents.stageQueued(tx, params.tenantId, keyHash, payload);
        return { id, tenantId: params.tenantId, status: 'QUEUED', statusPath: `/v1/governance/audit/export/${encodeURIComponent(id)}`, submittedAt: new Date().toISOString() };
      }
      return this.render(params, events, tx);
    });
    if ('status' in result) {
      // The SQL transaction is committed before enqueue, so a fast worker can
      // never observe an uncommitted intent. The relay repairs a crash here.
      const stored = await this.intents.findQueued(params.tenantId, result.id);
      if (!stored) throw new ServiceUnavailableException('Audit export intent is unavailable');
      if (!stored.queuedResult) {
        try { await this.ensureQueued(params.tenantId, stored); }
        catch { throw new ServiceUnavailableException('Audit export queue is unavailable; retry with the same request key'); }
      }
    }
    return result;
  }

  async processQueuedExport(input: AuditExportJobPayload): Promise<AuditExport> {
    const { keyHash, requestHash, jobId, ...original } = input;
    const params = this.validate(original);
    if (!keyHash || !requestHash || !jobId || requestDigest(params) !== requestHash) throw new BadRequestException('Invalid queued audit export');
    return this.intents.executeQueued(params.tenantId, keyHash, requestHash, jobId, async (tx) => {
      const events = await this.query(params, HARD_LIMIT + 1, tx);
      if (events.length > HARD_LIMIT) throw new BadRequestException('Audit export exceeds the maximum size; choose a narrower period or filters.');
      return this.render(params, events, tx);
    });
  }

  async getJob(tenantId: string, id: string): Promise<{ id: string; tenantId: string; state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'; result?: AuditExport; failureReason?: string }> {
    if (!tenantId || !/^audit-[a-f0-9]{64}$/.test(id)) throw new NotFoundException('Audit export job not found');
    const stored = await this.intents.findQueued(tenantId, id);
    if (!stored || stored.response?.tenantId !== tenantId || stored.response.id !== id) throw new NotFoundException('Audit export job not found');
    // PostgreSQL is authoritative for the whole seven-day intent lifetime,
    // even if BullMQ has evicted its completed result or Redis is unavailable.
    if (stored.queuedResult) {
      const result = stored.queuedResult;
      if (result.tenantId !== tenantId || typeof result.fileContents !== 'string') throw new Error('Invalid audit export result');
      return { id, tenantId, state: 'completed', result };
    }
    const job = await this.queues.getQueue(QUEUE_NAMES.AUDIT).getJob(id);
    if (!job) return { id, tenantId, state: 'unknown' }; // the durable relay will re-enqueue it
    const payload = job.data as AuditExportJobPayload;
    if (job.name !== 'governance-audit-export' || payload.tenantId !== tenantId || payload.jobId !== id || payload.keyHash !== stored.keyHash || payload.requestHash !== stored.requestHash) throw new NotFoundException('Audit export job not found');
    const raw = await job.getState();
    const state = (['waiting', 'active', 'completed', 'failed', 'delayed'] as const).find((v) => v === raw) ?? 'unknown';
    if (state === 'completed') {
      // The worker may have committed between the first SQL read and the Redis read.
      const fresh = await this.intents.findQueued(tenantId, id);
      if (!fresh?.queuedResult || fresh.queuedResult.tenantId !== tenantId || typeof fresh.queuedResult.fileContents !== 'string') throw new Error('Audit export result was not durably committed');
      return { id, tenantId, state, result: fresh.queuedResult };
    }
    return { id, tenantId, state, ...(state === 'failed' ? { failureReason: 'Export failed. Try a narrower period or contact an administrator.' } : {}) };
  }

  /** Recover staged jobs after process/Redis failures; visits bounded tenant/job pages. */
  async relayPendingExports(): Promise<void> {
    if (this.relayRunning) return;
    this.relayRunning = true;
    try {
      const tenants = await this.intents.tenantPage(this.tenantCursor, 16);
      if (!tenants.length) { this.tenantCursor = undefined; return; }
      this.tenantCursor = tenants[tenants.length - 1];
      for (const tenantId of tenants) {
        const pending = await this.intents.pending(tenantId, 20);
        for (const intent of pending) {
          try { await this.ensureQueued(tenantId, intent); }
          catch (error) { this.logger.warn(`Audit export relay deferred (${error instanceof Error ? error.name : 'unknown'})`); }
          finally { await this.intents.markQueueChecked(tenantId, intent.keyHash); }
        }
      }
    } catch (error) { this.logger.warn(`Audit export relay cycle failed (${error instanceof Error ? error.name : 'unknown'})`); }
    finally { this.relayRunning = false; }
  }

  private async ensureQueued(tenantId: string, stored: StoredQueuedIntent): Promise<void> {
    const payload = stored.jobPayload;
    const id = stored.response?.id;
    if (!payload || !id || !/^audit-[a-f0-9]{64}$/.test(id) || stored.response.tenantId !== tenantId ||
        payload.tenantId !== tenantId || payload.jobId !== id || payload.keyHash !== stored.keyHash || payload.requestHash !== stored.requestHash) {
      throw new Error('Invalid staged audit export');
    }
    const { keyHash: _keyHash, requestHash: _requestHash, jobId: _jobId, ...original } = payload;
    if (requestDigest(this.validate(original)) !== stored.requestHash) throw new Error('Invalid staged audit export');
    const queue = this.queues.getQueue(QUEUE_NAMES.AUDIT);
    let job = await queue.getJob(id);
    if (!job) {
      const accepted = await this.queues.enqueueOrThrow(QUEUE_NAMES.AUDIT, 'governance-audit-export', payload, {
        jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 7 * 86_400 },
      });
      if (accepted !== id) throw new Error('Audit export queue returned an unexpected job');
      job = await queue.getJob(id);
    }
    const data = job?.data as AuditExportJobPayload | undefined;
    if (!job || job.name !== 'governance-audit-export' || data?.tenantId !== tenantId || data.jobId !== id ||
        data.keyHash !== stored.keyHash || data.requestHash !== stored.requestHash) throw new Error('Audit export queue identity mismatch');
  }

  private validate(input: AuditExportJobPayload): AuditExportJobPayload {
    if (!input.tenantId || !input.operatorId || !input.correlationId || input.correlationId.length > 255) throw new BadRequestException('Tenant, operator and correlation are required');
    const start = new Date(input.periodStart), end = new Date(input.periodEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new BadRequestException('Invalid audit export period');
    const filters = input.filters ?? {};
    if (filters.entityId && !filters.entityType) throw new BadRequestException('Entity type is required when filtering by entity');
    if (filters.entityType && !(filters.entityType in ENTITIES)) throw new BadRequestException('Invalid audit entity type');
    return { ...input, periodStart: start.toISOString(), periodEnd: end.toISOString(), filters };
  }

  private async query(params: AuditExportJobPayload, take: number, transaction?: Prisma.TransactionClient): Promise<GovernanceAuditEvent[]> {
    const filters = params.filters ?? {};
    const events = await this.audit.listEvents(params.tenantId, { ...filters, periodStart: params.periodStart, periodEnd: params.periodEnd, take }, transaction);
    if (events.some((event) => event.tenantId !== params.tenantId)) throw new Error('Audit source returned a row outside the authenticated tenant');
    // Apply the same predicates defensively if an alternate implementation is injected.
    return events.filter((event) => event.createdAt >= params.periodStart && event.createdAt < params.periodEnd && (!filters.actorId || event.createdBy === filters.actorId) && (!filters.actionType || event.actionType === filters.actionType) && (!filters.subjectUserId || event.subjectUserId === filters.subjectUserId) && (!filters.outcome || event.result === filters.outcome) && (!filters.entityType || (!!event[ENTITIES[filters.entityType]] && (!filters.entityId || event[ENTITIES[filters.entityType]] === filters.entityId))));
  }

  private async render(params: AuditExportJobPayload, events: GovernanceAuditEvent[], transaction?: Prisma.TransactionClient): Promise<AuditExport> {
    events.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let previous = '0'.repeat(64);
    const rows: AuditExportRow[] = events.map((event) => {
      const base = { id: event.id, actionType: event.actionType, actorReference: digest(`${params.tenantId}:actor:${event.createdBy}`), subjectReference: event.subjectUserId ? digest(`${params.tenantId}:subject:${event.subjectUserId}`) : null, state: event.state, result: event.result, correlationId: event.correlationId, createdAt: event.createdAt, safeEvidence: event.safeEvidence };
      const rowHash = digest(`${previous}\n${JSON.stringify(base)}`);
      const row = { ...base, previousHash: previous, rowHash }; previous = rowHash; return row;
    });
    const filters = params.filters ?? {};
    const canonical = JSON.stringify({ tenantId: params.tenantId, periodStart: params.periodStart, periodEndExclusive: params.periodEnd, filters, rows });
    const sha256 = digest(canonical);
    const manifest: AuditExportManifest = { format: 'wlct.audit.v1', sha256, rowCount: rows.length, chainTip: previous, tenantId: params.tenantId, periodStart: params.periodStart, periodEndExclusive: params.periodEnd, filters };
    const id = randomUUID();
    const result: AuditExport = { id, tenantId: params.tenantId, fileHash: sha256, fileContents: JSON.stringify({ manifest, rows }), recordCount: rows.length, filtersApplied: filters, manifest, rows };
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.AUDIT_EXPORT, state: 'EXPORTED', result: 'SUCCESS', correlationId: params.correlationId, createdBy: params.operatorId, safeEvidence: { exportId: id, recordCount: rows.length, fileHash: sha256, policyVersion: this.policyService.getPolicyVersion() } }, transaction);
    return result;
  }
}
