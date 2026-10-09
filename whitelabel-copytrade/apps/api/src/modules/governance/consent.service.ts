// # Responsibility: captures and withdraws consent against the durable ledger, failing closed when it cannot be proven.
//
// Consent is a compliance record, so the only honest answer to "was this consent captured?" is the
// row in the ledger. This service previously kept a process-local `Map` of consent records and wrote
// to it *before* attempting persistence, with persistence optional (`?.create?.()`), its failures
// swallowed by a `catch` that logged at debug level, and the capture audit event emitted regardless.
// A database outage therefore produced a success response and a `CONSENT_CAPTURE / CAPTURED` audit
// entry for a consent that no longer existed after the next deploy - a false compliance record, and
// the worst class of bug in this area because the audit trail is the very thing being relied on.
//
// Three rules now hold, and each is pinned by a test:
//
//   1. The ledger is the record. No in-memory cache, no read fallback. A read that cannot reach the
//      ledger is `ServiceUnavailable` (503), never an empty list and never a stale local copy:
//      `listConsents` returning `[]` during an outage would read as "this subject has consented to
//      nothing", which is a different and equally wrong claim.
//   2. Persist first, then audit. If the write fails there is no capture to report, so no audit
//      event is written and no success is returned. The order is load-bearing, not stylistic.
//   3. A withdrawal is a compare-and-set. The `update` carries `status: ACTIVE` in its `where`
//      clause, so two concurrent withdrawals cannot both match; the loser is refused rather than
//      overwriting the first one's timestamp.
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConsentRecord, ConsentState, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** The ledger could not be read, so the answer is unknown rather than negative. */
const LEDGER_UNREADABLE = 'The consent ledger is unavailable.';

/**
 * A write that did not reach the ledger. Kept separate from the read failure above on purpose: a
 * write can fail while reads still succeed - a constraint, a failing primary, a full disk - and
 * answering "the ledger is unavailable" when the ledger is demonstrably answering reads is a claim
 * this service cannot support. What it can support, and what the caller needs to know, is that the
 * consent was not durably recorded.
 */
const CONSENT_NOT_DURABLY_RECORDED = 'Consent could not be durably recorded.';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The consent ledger's record model, under one name. Every read and write in this service goes
   * through this accessor, so the persistence boundary is a single greppable place rather than five
   * scattered delegate lookups, and changing how the ledger is reached is a change here.
   */
  private get consentModel() {
    return this.prisma.consentRecord;
  }

  async captureConsent(params: {
    tenantId: string;
    subjectUserId: string;
    purpose: string;
    version: string;
    policyReference: string;
    source: string;
    correlationId: string;
    capturedBy: string;
    evidenceReference?: string;
  }): Promise<ConsentRecord> {
    if (!params.tenantId || !params.subjectUserId || !params.purpose || !params.version || !params.policyReference) {
      throw new BadRequestException('tenantId, subjectUserId, purpose, version, policyReference required');
    }

    const capturedAt = new Date();

    let row: Record<string, unknown>;
    try {
      row = (await this.consentModel.create({
        data: {
          // randomUUID rather than a timestamp-plus-Math.random id: this identifier is the record's
          // identity in an audit trail, so it must not be guessable or collision-prone.
          id: `cons_${randomUUID()}`,
          tenantId: params.tenantId,
          subjectUserId: params.subjectUserId,
          purpose: params.purpose,
          version: params.version,
          policyReference: params.policyReference,
          source: params.source,
          capturedAt,
          status: ConsentState.ACTIVE,
          evidenceReference: params.evidenceReference ?? null,
          correlationId: params.correlationId,
        },
      })) as unknown as Record<string, unknown>;
    } catch (error) {
      // Fail closed. Not returning the record is the whole point: a caller that receives a consent
      // record will rely on it later, and there is nothing to rely on.
      this.logger.error(
        `consent capture failed tenant=${params.tenantId} purpose=${params.purpose} corr=${params.correlationId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(CONSENT_NOT_DURABLY_RECORDED);
    }

    const record = this.mapRow(row);

    // Reached only after the ledger holds the row, so this event describes something that exists.
    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.CONSENT_CAPTURE,
      subjectUserId: params.subjectUserId,
      consentId: record.id,
      state: record.status,
      result: 'CAPTURED',
      correlationId: params.correlationId,
      createdBy: params.capturedBy,
      safeEvidence: { purpose: params.purpose, version: params.version, policyReference: params.policyReference },
    });

    this.logger.log(`consent captured id=${record.id} tenant=${params.tenantId} purpose=${params.purpose} corr=${params.correlationId}`);
    return record;
  }

  async withdrawConsent(params: {
    tenantId: string;
    consentId: string;
    subjectUserId: string;
    correlationId: string;
    withdrawnBy: string;
    reason?: string;
  }): Promise<ConsentRecord> {
    const existing = await this.getConsent(params.tenantId, params.consentId);
    if (existing.subjectUserId !== params.subjectUserId) throw new BadRequestException('subject mismatch');
    if (existing.status !== ConsentState.ACTIVE) throw new BadRequestException(`cannot withdraw from status ${existing.status}`);

    const withdrawnAt = new Date();

    let row: Record<string, unknown>;
    try {
      row = (await this.consentModel.update({
        where: {
          id: existing.id,
          tenantId: params.tenantId,
          subjectUserId: params.subjectUserId,
          // The compare-and-set. Only a still-ACTIVE row matches, so a withdrawal that races this
          // one loses here instead of silently moving the timestamp of an already-withdrawn record.
          status: ConsentState.ACTIVE,
        },
        data: { status: ConsentState.WITHDRAWN, withdrawnAt },
      })) as unknown as Record<string, unknown>;
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        // The row stopped being ACTIVE between the read and the write: a concurrent withdrawal won.
        throw new BadRequestException(`cannot withdraw from status ${ConsentState.WITHDRAWN}`);
      }
      this.logger.error(
        `consent withdrawal failed id=${existing.id} tenant=${params.tenantId} corr=${params.correlationId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(CONSENT_NOT_DURABLY_RECORDED);
    }

    // Merge rather than re-read: the update returns the persisted row, and the fields it does not
    // echo back are the ones just read and verified unchanged.
    const record: ConsentRecord = {
      ...existing,
      ...this.mapRow(row),
      id: existing.id,
      tenantId: existing.tenantId,
      subjectUserId: existing.subjectUserId,
      status: ConsentState.WITHDRAWN,
    };

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.CONSENT_WITHDRAW,
      subjectUserId: params.subjectUserId,
      consentId: record.id,
      state: record.status,
      result: 'WITHDRAWN',
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.withdrawnBy,
      safeEvidence: { purpose: existing.purpose, version: existing.version },
    });

    this.logger.log(`consent withdrawn id=${record.id} corr=${params.correlationId}`);
    return record;
  }

  /**
   * Reads one consent from the ledger. A missing row and an unreachable ledger are different
   * answers and are not collapsed: the first is a 400, the second a 503.
   */
  async getConsent(tenantId: string, consentId: string): Promise<ConsentRecord> {
    let row: Record<string, unknown> | null;
    try {
      row = (await this.consentModel.findUnique({
        where: { id: consentId, tenantId },
      })) as unknown as Record<string, unknown> | null;
    } catch (error) {
      this.logger.error(`consent read failed id=${consentId} tenant=${tenantId} reason=${this.safeReason(error)}`);
      throw new ServiceUnavailableException(LEDGER_UNREADABLE);
    }

    if (!row) throw new BadRequestException(`consent ${consentId} not found`);

    this.policyService.assertTenantIsolation(tenantId, String(row.tenantId));
    return this.mapRow(row);
  }

  /**
   * Lists a subject's consents from the ledger. No local fallback: an outage is a 503, because an
   * empty list is a factual claim about the subject's consents and this service cannot make it.
   */
  async listConsents(tenantId: string, subjectUserId: string): Promise<ConsentRecord[]> {
    let rows: Record<string, unknown>[];
    try {
      rows = (await this.consentModel.findMany({
        where: { tenantId, subjectUserId },
        take: 500,
        orderBy: { capturedAt: 'desc' },
      })) as unknown as Record<string, unknown>[];
    } catch (error) {
      this.logger.error(
        `consent list failed tenant=${tenantId} subject=${subjectUserId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(LEDGER_UNREADABLE);
    }

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): ConsentRecord {
    return {
      id: String(row.id),
      tenantId: String(row.tenantId),
      subjectUserId: String(row.subjectUserId),
      purpose: String(row.purpose),
      version: String(row.version),
      policyReference: String(row.policyReference),
      source: String(row.source),
      capturedAt: this.toIso(row.capturedAt),
      withdrawnAt: row.withdrawnAt ? this.toIso(row.withdrawnAt) : null,
      status: row.status as ConsentState,
      evidenceReference: (row.evidenceReference ?? null) as string | null,
      correlationId: String(row.correlationId),
    };
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }

  /** Prisma's "record required for the update was not found" code. */
  private isRecordNotFound(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'P2025'
    );
  }

  /** A bounded, non-echoing reason for the log: driver messages can quote the row being written. */
  private safeReason(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
    return error instanceof Error && error.name ? error.name : 'UNKNOWN';
  }
}
