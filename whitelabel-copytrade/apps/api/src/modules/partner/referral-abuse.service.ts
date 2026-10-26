// # Enforces deterministic self-referral and velocity risk scoring with a tenant-scoped manual-review queue.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  evaluateReferralAbuse,
  type ReferralAbuseDecision,
  type ReferralAbuseInput,
  type ReferralAbuseReason,
  type ReferralAbuseResult,
  type ReferralVelocityCounts,
} from './referral-abuse.rules';

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REFERRER_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const IDENTITY_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REVIEW_PAGE_SIZE = 200;

export type ReferralAbuseReviewState = 'REVIEW_REQUIRED' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED';
export type ReferralAbuseReviewDecision = 'APPROVE' | 'REJECT';

export interface ReferralAbuseEvaluationResult extends ReferralAbuseResult {
  caseId: string | null;
  velocity: ReferralVelocityCounts;
  evaluatedAt: string;
}

export interface ReferralAbuseReviewQueueItem {
  id: string;
  tenantId: string;
  partnerId: string;
  referrerUserId: string;
  referredUserId: string;
  referrerDeviceHash: string | null;
  referredDeviceHash: string | null;
  referrerIpHash: string | null;
  referredIpHash: string | null;
  riskScore: number;
  reasons: ReferralAbuseReason[];
  velocity: ReferralVelocityCounts;
  decision: ReferralAbuseDecision;
  state: ReferralAbuseReviewState;
  reviewerUserId: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

interface ExistingIdempotencyRow {
  id: string;
  source: 'ATTRIBUTION' | 'ABUSE_REVIEW';
}

interface VelocityCountRow {
  referrerAttemptsInWindow: number | bigint;
  deviceReferralsInWindow: number | bigint;
  ipReferralsInWindow: number | bigint;
}

interface ReviewQueueRow {
  id: string;
  tenantId: string;
  partnerId: string;
  referrerUserId: string;
  referredUserId: string;
  referrerDeviceHash: string | null;
  referredDeviceHash: string | null;
  referrerIpHash: string | null;
  referredIpHash: string | null;
  riskScore: number;
  reasons: unknown;
  velocityCounts: unknown;
  decision: ReferralAbuseDecision;
  state: ReferralAbuseReviewState;
  reviewerUserId: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return String((error as { code: unknown }).code);
}

function toCount(value: number | bigint | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function asReasons(value: unknown): ReferralAbuseReason[] {
  return Array.isArray(value) ? (value as ReferralAbuseReason[]) : [];
}

function asVelocity(value: unknown): ReferralVelocityCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { referrerAttemptsInWindow: 0, deviceReferralsInWindow: 0, ipReferralsInWindow: 0 };
  }
  const counts = value as Partial<ReferralVelocityCounts>;
  return {
    referrerAttemptsInWindow: toCount(counts.referrerAttemptsInWindow),
    deviceReferralsInWindow: toCount(counts.deviceReferralsInWindow),
    ipReferralsInWindow: toCount(counts.ipReferralsInWindow),
  };
}

function mapReviewRow(row: ReviewQueueRow): ReferralAbuseReviewQueueItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    partnerId: row.partnerId,
    referrerUserId: row.referrerUserId,
    referredUserId: row.referredUserId,
    referrerDeviceHash: row.referrerDeviceHash,
    referredDeviceHash: row.referredDeviceHash,
    referrerIpHash: row.referrerIpHash,
    referredIpHash: row.referredIpHash,
    riskScore: row.riskScore,
    reasons: asReasons(row.reasons),
    velocity: asVelocity(row.velocityCounts),
    decision: row.decision,
    state: row.state,
    reviewerUserId: row.reviewerUserId,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

@Injectable()
export class ReferralAbuseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async evaluateAttribution(
    input: ReferralAbuseInput & {
      tenantId: string;
      partnerId: string;
      correlationId: string;
      evaluatedAt?: Date;
    },
  ): Promise<ReferralAbuseEvaluationResult> {
    const normalized = this.normalizeInput(input);
    const evaluatedAt = input.evaluatedAt ?? new Date();
    if (Number.isNaN(evaluatedAt.getTime())) {
      throw new BadRequestException('The referral evaluation timestamp is invalid.');
    }

    let persisted: ReferralAbuseEvaluationResult | null = null;
    let lastConflict: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        persisted = await this.withTenantSerializable(normalized.tenantId, async (tx) => {
          const existing = await tx.$queryRaw<ExistingIdempotencyRow[]>(Prisma.sql`
            SELECT id, 'ATTRIBUTION'::text AS source
            FROM partner_attributions
            WHERE tenant_id = ${normalized.tenantId}
              AND idempotency_key = ${normalized.idempotencyKey}
            UNION ALL
            SELECT id, 'ABUSE_REVIEW'::text AS source
            FROM partner_referral_abuse_reviews
            WHERE tenant_id = ${normalized.tenantId}
              AND idempotency_key = ${normalized.idempotencyKey}
            LIMIT 1
          `);
          if (existing[0]) {
            const prior = existing[0];
            const replay = evaluateReferralAbuse({
              ...normalized.rules,
              existingAttributionId: prior.id,
            });
            return {
              ...replay,
              existingAttributionId: prior.source === 'ATTRIBUTION' ? prior.id : null,
              caseId: prior.source === 'ABUSE_REVIEW' ? prior.id : null,
              velocity: {
                referrerAttemptsInWindow: 0,
                deviceReferralsInWindow: 0,
                ipReferralsInWindow: 0,
              },
              evaluatedAt: evaluatedAt.toISOString(),
            };
          }

          const referrerWindowStart = new Date(evaluatedAt.getTime() - REFERRER_VELOCITY_WINDOW_MS);
          const identityWindowStart = new Date(evaluatedAt.getTime() - IDENTITY_VELOCITY_WINDOW_MS);
          const deviceCount = normalized.rules.referredDeviceHash
            ? Prisma.sql`(
                SELECT COUNT(*)::integer
                FROM partner_referral_abuse_reviews
                WHERE tenant_id = ${normalized.tenantId}
                  AND created_at >= ${identityWindowStart}
                  AND (referrer_device_hash = ${normalized.rules.referredDeviceHash}
                    OR referred_device_hash = ${normalized.rules.referredDeviceHash})
              )`
            : Prisma.sql`0::integer`;
          const ipCount = normalized.rules.referredIpHash
            ? Prisma.sql`(
                SELECT COUNT(*)::integer
                FROM partner_referral_abuse_reviews
                WHERE tenant_id = ${normalized.tenantId}
                  AND created_at >= ${identityWindowStart}
                  AND (referrer_ip_hash = ${normalized.rules.referredIpHash}
                    OR referred_ip_hash = ${normalized.rules.referredIpHash})
              )`
            : Prisma.sql`0::integer`;
          const countRows = await tx.$queryRaw<VelocityCountRow[]>(Prisma.sql`
            SELECT
              (
                SELECT COUNT(*)::integer
                FROM partner_referral_abuse_reviews
                WHERE tenant_id = ${normalized.tenantId}
                  AND partner_id = ${normalized.partnerId}
                  AND referrer_user_id = ${normalized.rules.referrerUserId}
                  AND created_at >= ${referrerWindowStart}
              ) AS "referrerAttemptsInWindow",
              ${deviceCount} AS "deviceReferralsInWindow",
              ${ipCount} AS "ipReferralsInWindow"
          `);
          const velocity: ReferralVelocityCounts = {
            referrerAttemptsInWindow: toCount(countRows[0]?.referrerAttemptsInWindow),
            deviceReferralsInWindow: toCount(countRows[0]?.deviceReferralsInWindow),
            ipReferralsInWindow: toCount(countRows[0]?.ipReferralsInWindow),
          };
          const result = evaluateReferralAbuse({ ...normalized.rules, velocity });
          const caseId = randomUUID().replaceAll('-', '');
          const state = this.stateFor(result.decision);
          const insertedRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            INSERT INTO partner_referral_abuse_reviews (
              id, tenant_id, partner_id, referrer_user_id, referred_user_id,
              referrer_device_hash, referred_device_hash, referrer_ip_hash, referred_ip_hash,
              idempotency_key, risk_score, reasons, velocity_counts, decision, state,
              created_at, updated_at
            ) VALUES (
              ${caseId}, ${normalized.tenantId}, ${normalized.partnerId},
              ${normalized.rules.referrerUserId}, ${normalized.rules.referredUserId},
              ${normalized.rules.referrerDeviceHash || null}, ${normalized.rules.referredDeviceHash || null},
              ${normalized.rules.referrerIpHash || null}, ${normalized.rules.referredIpHash || null},
              ${normalized.idempotencyKey}, ${result.riskScore}, ${JSON.stringify(result.reasons)}::jsonb,
              ${JSON.stringify(velocity)}::jsonb, ${result.decision}, ${state},
              ${evaluatedAt}, ${evaluatedAt}
            )
            RETURNING id
          `);
          if (!insertedRows[0]) throw new Error('Referral-abuse insert returned no review record.');
          return {
            ...result,
            caseId: insertedRows[0].id,
            velocity,
            evaluatedAt: evaluatedAt.toISOString(),
          };
        });
        break;
      } catch (error) {
        const code = errorCode(error);
        if (code === 'P2034' || code === 'P2002') {
          lastConflict = error;
          continue;
        }
        if (error instanceof BadRequestException) throw error;
        throw new ServiceUnavailableException(
          'The referral-abuse ledger is unavailable; no new attribution was accepted.',
        );
      }
    }
    if (!persisted) {
      throw new ServiceUnavailableException(
        errorCode(lastConflict) === 'P2002'
          ? 'The referral idempotency record could not be resolved safely.'
          : 'The referral-abuse ledger remained contended; retry with the same idempotency key.',
      );
    }

    if (persisted.decision === 'REFUSE' || persisted.decision === 'REVIEW') {
      const isRefusal = persisted.decision === 'REFUSE';
      await this.audit.recordImmediate({
        tenantId: normalized.tenantId,
        actorType: AuditActorType.USER,
        actorId: normalized.rules.referrerUserId || null,
        action: isRefusal
          ? 'PARTNER_REFERRAL_ABUSE_BLOCKED'
          : 'PARTNER_REFERRAL_ABUSE_REVIEW_QUEUED',
        outcome: isRefusal ? AuditOutcome.DENIED : AuditOutcome.SUCCESS,
        resourceType: 'PartnerReferralAbuseReview',
        resourceId: persisted.caseId,
        description: isRefusal
          ? 'Referral attribution refused by deterministic abuse controls.'
          : 'Referral attribution queued for human abuse review.',
        requestId: input.correlationId,
        metadata: {
          decision: persisted.decision,
          riskScore: persisted.riskScore,
          reasons: persisted.reasons,
          velocity: persisted.velocity,
          referrerDeviceHash: normalized.rules.referrerDeviceHash || null,
          referredDeviceHash: normalized.rules.referredDeviceHash || null,
          referrerIpHash: normalized.rules.referrerIpHash || null,
          referredIpHash: normalized.rules.referredIpHash || null,
        },
      });
    }
    return persisted;
  }

  async listReviewQueue(tenantId: string, limit = 50): Promise<ReferralAbuseReviewQueueItem[]> {
    this.assertTenant(tenantId);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REVIEW_PAGE_SIZE) {
      throw new BadRequestException(
        `Review queue limit must be an integer from 1 to ${MAX_REVIEW_PAGE_SIZE}.`,
      );
    }
    try {
      const rows = await this.withTenantSerializable(tenantId, (tx) =>
        tx.$queryRaw<ReviewQueueRow[]>(Prisma.sql`
          SELECT
            id,
            tenant_id::text AS "tenantId",
            partner_id AS "partnerId",
            referrer_user_id AS "referrerUserId",
            referred_user_id AS "referredUserId",
            referrer_device_hash AS "referrerDeviceHash",
            referred_device_hash AS "referredDeviceHash",
            referrer_ip_hash AS "referrerIpHash",
            referred_ip_hash AS "referredIpHash",
            risk_score AS "riskScore",
            reasons,
            velocity_counts AS "velocityCounts",
            decision,
            state,
            reviewer_user_id AS "reviewerUserId",
            resolution_note AS "resolutionNote",
            created_at AS "createdAt",
            reviewed_at AS "reviewedAt"
          FROM partner_referral_abuse_reviews
          WHERE tenant_id = ${tenantId}
            AND state = 'REVIEW_REQUIRED'
          ORDER BY risk_score DESC, created_at ASC, id ASC
          LIMIT ${limit}
        `),
      );
      return rows.map(mapReviewRow);
    } catch {
      throw new ServiceUnavailableException('The referral-abuse review queue is unavailable.');
    }
  }

  async resolveReview(input: {
    tenantId: string;
    caseId: string;
    reviewerUserId: string;
    decision: ReferralAbuseReviewDecision;
    note?: string;
    correlationId: string;
  }): Promise<ReferralAbuseReviewQueueItem> {
    this.assertTenant(input.tenantId);
    if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
      throw new BadRequestException('Review decision must be APPROVE or REJECT.');
    }
    if (!input.caseId.trim() || !input.reviewerUserId.trim() || !input.correlationId.trim()) {
      throw new BadRequestException('Case, reviewer, and correlation identifiers are required.');
    }
    const note = input.note?.trim() || null;
    if (note && note.length > 1000) {
      throw new BadRequestException('Review notes must not exceed 1000 characters.');
    }
    const nextState: ReferralAbuseReviewState =
      input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED';

    let updated: ReviewQueueRow | undefined;
    try {
      const rows = await this.withTenantSerializable(input.tenantId, (tx) =>
        tx.$queryRaw<ReviewQueueRow[]>(Prisma.sql`
          UPDATE partner_referral_abuse_reviews
          SET state = ${nextState},
              reviewer_user_id = ${input.reviewerUserId},
              resolution_note = ${note},
              reviewed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${input.tenantId}
            AND id = ${input.caseId}
            AND state = 'REVIEW_REQUIRED'
          RETURNING
            id,
            tenant_id::text AS "tenantId",
            partner_id AS "partnerId",
            referrer_user_id AS "referrerUserId",
            referred_user_id AS "referredUserId",
            referrer_device_hash AS "referrerDeviceHash",
            referred_device_hash AS "referredDeviceHash",
            referrer_ip_hash AS "referrerIpHash",
            referred_ip_hash AS "referredIpHash",
            risk_score AS "riskScore",
            reasons,
            velocity_counts AS "velocityCounts",
            decision,
            state,
            reviewer_user_id AS "reviewerUserId",
            resolution_note AS "resolutionNote",
            created_at AS "createdAt",
            reviewed_at AS "reviewedAt"
        `),
      );
      updated = rows[0];
    } catch {
      throw new ServiceUnavailableException('The referral-abuse review could not be saved.');
    }

    if (!updated) {
      const queue = await this.listReviewById(input.tenantId, input.caseId);
      if (!queue) throw new NotFoundException('Referral-abuse review case was not found.');
      throw new ConflictException('Referral-abuse review case has already been resolved.');
    }

    await this.audit.recordImmediate({
      tenantId: input.tenantId,
      actorType: AuditActorType.USER,
      actorId: input.reviewerUserId,
      action: 'PARTNER_REFERRAL_ABUSE_REVIEWED',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'PartnerReferralAbuseReview',
      resourceId: input.caseId,
      description: `Referral-abuse case resolved as ${input.decision}.`,
      requestId: input.correlationId,
      metadata: { decision: input.decision, state: nextState, noteProvided: Boolean(note) },
    });
    return mapReviewRow(updated);
  }

  private normalizeInput(
    input: ReferralAbuseInput & { tenantId: string; partnerId: string; correlationId: string },
  ): {
    tenantId: string;
    partnerId: string;
    idempotencyKey: string;
    rules: ReferralAbuseInput;
  } {
    this.assertTenant(input.tenantId);
    const partnerId = input.partnerId.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    const rules: ReferralAbuseInput = {
      referrerUserId: input.referrerUserId.trim(),
      referredUserId: input.referredUserId.trim(),
      referrerDeviceHash: input.referrerDeviceHash.trim(),
      referredDeviceHash: input.referredDeviceHash.trim(),
      referrerIpHash: input.referrerIpHash.trim(),
      referredIpHash: input.referredIpHash.trim(),
      idempotencyKey,
    };
    if (!partnerId || partnerId.length > 64 || !idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'Partner and idempotency identifiers are required and must be within their storage limits.',
      );
    }
    if (!input.correlationId.trim()) {
      throw new BadRequestException('A request correlation identifier is required.');
    }
    for (const [name, value] of Object.entries({
      referrerUserId: rules.referrerUserId,
      referredUserId: rules.referredUserId,
    })) {
      if (value.length > 64)
        throw new BadRequestException(`${name} exceeds the supported identifier length.`);
    }
    for (const [name, value] of Object.entries({
      referrerDeviceHash: rules.referrerDeviceHash,
      referredDeviceHash: rules.referredDeviceHash,
      referrerIpHash: rules.referrerIpHash,
      referredIpHash: rules.referredIpHash,
    })) {
      if (value.length > 128)
        throw new BadRequestException(`${name} exceeds the supported hash length.`);
    }
    return { tenantId: input.tenantId, partnerId, idempotencyKey, rules };
  }

  private assertTenant(tenantId: string): void {
    if (!TENANT_UUID.test(tenantId)) {
      throw new BadRequestException(
        'A canonical tenant UUID is required for referral-abuse operations.',
      );
    }
  }

  private stateFor(decision: ReferralAbuseDecision): string {
    switch (decision) {
      case 'ALLOW':
        return 'ALLOWED';
      case 'REVIEW':
        return 'REVIEW_REQUIRED';
      case 'REFUSE':
        return 'BLOCKED';
      case 'IDEMPOTENT_REPLAY':
        throw new BadRequestException('An idempotent replay must not create a new review record.');
    }
  }

  private async withTenantSerializable<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    this.assertTenant(tenantId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async listReviewById(tenantId: string, caseId: string): Promise<ReviewQueueRow | null> {
    try {
      const rows = await this.withTenantSerializable(tenantId, (tx) =>
        tx.$queryRaw<ReviewQueueRow[]>(Prisma.sql`
          SELECT
            id,
            tenant_id::text AS "tenantId",
            partner_id AS "partnerId",
            referrer_user_id AS "referrerUserId",
            referred_user_id AS "referredUserId",
            referrer_device_hash AS "referrerDeviceHash",
            referred_device_hash AS "referredDeviceHash",
            referrer_ip_hash AS "referrerIpHash",
            referred_ip_hash AS "referredIpHash",
            risk_score AS "riskScore",
            reasons,
            velocity_counts AS "velocityCounts",
            decision,
            state,
            reviewer_user_id AS "reviewerUserId",
            resolution_note AS "resolutionNote",
            created_at AS "createdAt",
            reviewed_at AS "reviewedAt"
          FROM partner_referral_abuse_reviews
          WHERE tenant_id = ${tenantId} AND id = ${caseId}
          LIMIT 1
        `),
      );
      return rows[0] ?? null;
    } catch {
      throw new ServiceUnavailableException('The referral-abuse review queue is unavailable.');
    }
  }
}
