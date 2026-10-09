// # Responsibility: records who brought a tenant in, durably and idempotently, and refuses to answer when it cannot prove it.
//
// An attribution decides who gets paid. That makes three properties non-negotiable, and the previous
// implementation held none of them:
//
//   1. The row in the database is the record. This service used to keep two process-local Maps as
//      the source of truth (`inMemory`, `tenantPrimary`), write to them *before* attempting
//      persistence, and treat the write as optional (`?.create?.()` with the failure swallowed at
//      debug level). A database outage therefore produced a success response, an audit entry, and an
//      attribution that vanished on the next deploy - the affiliate is paid on the strength of a
//      claim that no longer exists.
//   2. Idempotency is a database constraint, not a dictionary lookup. The retry key is
//      `idempotencyKey`, which the schema declares `@unique`; the previous in-memory `find` could
//      only ever see the keys this one process happened to write, so a retry after a restart or
//      through a second replica created a duplicate attribution. The lookup is now scoped by
//      `tenantId` as well, because a client-supplied key must never reach across tenants.
//   3. A failure to read is not an answer. Every read here used to be wrapped in `catch {}` and
//      fall through to `null` / `[]` / `NotFoundException`, which asserts "this tenant has no
//      partner" at the exact moment the service is unable to know that. Unavailable is now
//      `ServiceUnavailableException` (503), and a missing row stays a 404.
//
// The `?.` guards on the Prisma delegates were the mechanism of the old failure: `findMany?.()`
// returns `undefined` rather than throwing when the delegate is absent, so the duplicate-primary
// check silently passed and two primary attributions were created for one tenant.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PartnerAttribution, PartnerAttributionState, PartnerAuditAction } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerReferralService } from './partner-referral.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** The attribution ledger could not be reached, so every answer it would give is unknown. */
const ATTRIBUTION_LEDGER_UNAVAILABLE = 'The partner attribution ledger is unavailable.';

/** A write that did not land. Distinct from the read failure above: reads may still be served. */
const ATTRIBUTION_NOT_DURABLY_RECORDED = 'Partner attribution could not be durably recorded.';

/**
 * The fields this service reads off a `PartnerAttribution` row. Declared rather than inferred from
 * the Prisma delegate: `Awaited<ReturnType<typeof this.prisma.partnerAttribution.findFirst>>` is an
 * inference bomb that drags the whole generated client into every call site.
 */
interface PartnerAttributionRow {
  id: string;
  partnerId: string;
  tenantId: string | null;
  campaignId: string | null;
  referralCode: string | null;
  referralToken: string | null;
  attributionSource: string;
  attributionWindowHours: number;
  capturedAt: Date | string;
  effectiveAt: Date | string;
  expiresAt: Date | string;
  agreementVersion: string;
  policyVersion: string;
  state: string;
  isPrimary: boolean;
  idempotencyKey: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

@Injectable()
export class PartnerAttributionService {
  private readonly logger = new Logger(PartnerAttributionService.name);

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly agreementService: PartnerAgreementService,
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly referralService: PartnerReferralService,
    private readonly tenantService: PartnerTenantService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The attribution table, under one name. Every read and write goes through here, so the
   * persistence boundary is greppable and the `?.`-guarded delegate lookups that produced the
   * fail-open behaviour cannot reappear scattered through the file.
   */
  private get attributionModel() {
    return this.prisma.partnerAttribution;
  }

  async attributeTenant(params: {
    partnerId: string;
    tenantId: string;
    campaignId?: string | null;
    referralCode?: string | null;
    referralToken?: string | null;
    attributionSource: string;
    capturedAt: string;
    agreementVersion?: string;
    createdBy: string;
    correlationId: string;
    idempotencyKey: string;
    isPrimary?: boolean;
  }): Promise<PartnerAttribution> {
    if (!params.partnerId || !params.tenantId || !params.attributionSource || !params.idempotencyKey) {
      throw new BadRequestException('partnerId, tenantId, attributionSource, idempotencyKey required');
    }

    // Never allow client-supplied trusted partnerId without evidence
    // Must have referral evidence or explicit provisioning source
    if (
      !params.referralCode &&
      !params.referralToken &&
      !['TENANT_PROVISIONING', 'CAMPAIGN', 'MANUAL_APPROVED'].includes(params.attributionSource)
    ) {
      throw new BadRequestException('attribution requires referral evidence or approved provisioning source');
    }

    await this.profileService.getProfile(params.partnerId);
    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) throw new BadRequestException(`no active agreement for partner ${params.partnerId}`);

    // Idempotency, against the durable record and scoped to this tenant. The tenant is part of the
    // key: a client that reuses a key across tenants must not be handed another tenant's row.
    const replay = await this.findByIdempotencyKey(params.tenantId, params.idempotencyKey);
    if (replay) return replay;

    // Self-referral protection, against the tenant's current primary partner.
    const tenantPrimary = await this.tenantService.getPrimaryPartnerForTenant(params.tenantId);
    if (tenantPrimary && tenantPrimary.partnerId === params.partnerId) {
      const profile = await this.profileService.getProfile(params.partnerId);
      const tenant = await this.readTenantOwner(params.tenantId);
      if (tenant && tenant.ownerUserId === profile.ownerUserId) {
        throw new BadRequestException('self-referral not allowed');
      }
    }

    // One primary attribution per tenant. Read from the table, not from a Map: the Map was
    // per-process, so a second replica could not see the first one's primary and created a rival.
    const isPrimary = params.isPrimary ?? true;
    if (isPrimary) {
      const conflicting = await this.findConflictingPrimary(params.tenantId, params.partnerId);
      if (conflicting) {
        throw new ConflictException(
          `tenant ${params.tenantId} already has primary attribution to partner ${conflicting.partnerId}`,
        );
      }
    }

    // Validate referral if provided
    if (params.referralCode) {
      let referral;
      try {
        referral = await this.referralService.getByCode(params.referralCode);
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
        throw new BadRequestException(`invalid referral code ${params.referralCode}`);
      }
      if (referral.partnerId !== params.partnerId) throw new BadRequestException('referral code belongs to different partner');
      if (referral.state !== 'ACTIVE') throw new BadRequestException(`referral code state ${referral.state} not active`);
      if (referral.expiresAt && new Date(referral.expiresAt) < new Date()) throw new BadRequestException('referral code expired');
    }
    if (params.referralToken) {
      let referral;
      try {
        referral = await this.referralService.getByToken(params.referralToken);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('invalid referral token');
      }
      if (referral.partnerId !== params.partnerId) throw new BadRequestException('referral token belongs to different partner');
      if (referral.state !== 'ACTIVE') throw new BadRequestException(`referral token state ${referral.state} not active`);
    }

    const capturedAt = new Date(params.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new BadRequestException('invalid capturedAt');

    const policy = agreement.commissionPolicy;
    const windowHours = policy.attributionWindowHours;
    const effectiveAt = capturedAt;
    const expiresAt = new Date(capturedAt.getTime() + windowHours * 3600000);
    const now = new Date();

    // Attribution window enforcement
    if (now > expiresAt) throw new BadRequestException('attribution window expired at capture time');

    // randomUUID rather than a timestamp-and-Math.random id: this identifier appears in commission
    // records and in the audit trail, so it must not be guessable or collision-prone.
    const id = `pattr_${randomUUID()}`;

    let row: PartnerAttributionRow;
    try {
      row = (await this.attributionModel.create({
        data: {
          id,
          partnerId: params.partnerId,
          tenantId: params.tenantId,
          campaignId: params.campaignId ?? null,
          referralCode: params.referralCode ?? null,
          referralToken: params.referralToken ?? null,
          attributionSource: params.attributionSource,
          attributionWindowHours: windowHours,
          capturedAt,
          effectiveAt,
          expiresAt,
          agreementVersion: params.agreementVersion ?? `v${agreement.version}`,
          policyVersion: policy.policyVersion,
          state: PartnerAttributionState.ACTIVE,
          isPrimary,
          idempotencyKey: params.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
      })) as unknown as PartnerAttributionRow;
    } catch (error) {
      // A unique-constraint violation on `idempotencyKey` means a competing request won the race
      // between the check above and this insert. That is a replay, not a failure: the winner's row
      // is the record, so read it back and return it. The write itself succeeded; only one of the
      // two callers gets to write it.
      if (this.isUniqueConstraintViolation(error)) {
        const winner = await this.findByIdempotencyKey(params.tenantId, params.idempotencyKey);
        if (winner) return winner;
        // The row exists (the constraint proved it) but cannot be read. Returning the id we minted
        // would be returning an attribution the database rejected.
        this.logger.error(
          `attribution replay unreadable tenant=${params.tenantId} corr=${params.correlationId} reason=${this.safeReason(error)}`,
        );
        throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
      }
      // Fail closed. Not returning the attribution is the whole point: a caller that receives one
      // will bill against it, and there is nothing to bill against.
      this.logger.error(
        `attribution persist failed tenant=${params.tenantId} partner=${params.partnerId} corr=${params.correlationId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(ATTRIBUTION_NOT_DURABLY_RECORDED);
    }

    const attribution = this.mapRow(row);

    // Reached only after the ledger holds the row, so this event describes something that exists.
    await this.audit.recordEvent({
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      actorId: params.createdBy,
      action: PartnerAuditAction.REFERRAL_ATTRIBUTED,
      source: 'PARTNER_ATTRIBUTION_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: attribution.agreementVersion,
      policyVersion: attribution.policyVersion,
      safeEvidence: {
        attributionId: attribution.id,
        source: attribution.attributionSource,
        isPrimary,
        referralCode: attribution.referralCode,
      },
    });

    this.logger.log(
      `attribution created id=${attribution.id} partner=${params.partnerId} tenant=${params.tenantId} corr=${params.correlationId}`,
    );
    return attribution;
  }

  /**
   * Reads one attribution and enforces partner isolation. A missing row and an unreachable ledger
   * are different answers and are not collapsed: the first is a 404, the second a 503.
   */
  async getAttribution(attributionId: string, partnerId: string): Promise<PartnerAttribution> {
    let row: PartnerAttributionRow | null;
    try {
      row = (await this.attributionModel.findUnique({
        where: { id: attributionId },
      })) as unknown as PartnerAttributionRow | null;
    } catch (error) {
      this.logger.error(
        `attribution read failed id=${attributionId} partner=${partnerId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }

    if (!row) throw new NotFoundException(`attribution ${attributionId} not found`);
    if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
    return this.mapRow(row);
  }

  /**
   * Lists a partner's attributions from the ledger. An empty result is a real answer - this partner
   * has no attributions - but an unreachable ledger is not, so an outage is a 503 rather than `[]`.
   */
  async listAttributionsForPartner(partnerId: string): Promise<PartnerAttribution[]> {
    let rows: PartnerAttributionRow[];
    try {
      rows = (await this.attributionModel.findMany({
        where: { partnerId },
        take: 500,
      })) as unknown as PartnerAttributionRow[];
    } catch (error) {
      this.logger.error(`attribution list failed partner=${partnerId} reason=${this.safeReason(error)}`);
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }

    return rows.map((row) => this.mapRow(row));
  }

  /** The tenant's active primary attribution, or null when the ledger says there is none. */
  async getPrimaryAttributionForTenant(tenantId: string): Promise<PartnerAttribution | null> {
    let row: PartnerAttributionRow | null;
    try {
      row = (await this.attributionModel.findFirst({
        where: { tenantId, isPrimary: true, state: PartnerAttributionState.ACTIVE },
      })) as unknown as PartnerAttributionRow | null;
    } catch (error) {
      // Returning null here would assert that this tenant has no partner, which is exactly what
      // this service is unable to determine while the ledger is unreachable.
      this.logger.error(`primary attribution read failed tenant=${tenantId} reason=${this.safeReason(error)}`);
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }

    return row ? this.mapRow(row) : null;
  }

  async checkAttributionExpired(attributionId: string, partnerId: string): Promise<boolean> {
    const attr = await this.getAttribution(attributionId, partnerId);
    return new Date(attr.expiresAt) < new Date();
  }

  /**
   * The durable idempotency check. Tenant-scoped on purpose: the same client-supplied key sent by a
   * different tenant is a different request and must not return this tenant's row.
   */
  private async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PartnerAttribution | null> {
    let row: PartnerAttributionRow | null;
    try {
      row = (await this.attributionModel.findFirst({
        where: { tenantId, idempotencyKey },
      })) as unknown as PartnerAttributionRow | null;
    } catch (error) {
      // No write is attempted after this: a request whose idempotency cannot be checked cannot be
      // safely applied, because applying it twice is the failure mode idempotency exists to prevent.
      this.logger.error(
        `attribution idempotency lookup failed tenant=${tenantId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }

    return row ? this.mapRow(row) : null;
  }

  /** The rival primary attribution for this tenant, if the ledger holds one. */
  private async findConflictingPrimary(
    tenantId: string,
    partnerId: string,
  ): Promise<PartnerAttribution | null> {
    let rows: PartnerAttributionRow[];
    try {
      rows = (await this.attributionModel.findMany({
        where: { tenantId, isPrimary: true, state: PartnerAttributionState.ACTIVE },
      })) as unknown as PartnerAttributionRow[];
    } catch (error) {
      // Previously `findMany?.()` returned undefined here and the conflict check passed by default,
      // which is how a tenant could end up with two primary partners. An unreadable ledger is a
      // refusal to write, not a reason to skip the check.
      this.logger.error(
        `primary attribution conflict check failed tenant=${tenantId} reason=${this.safeReason(error)}`,
      );
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }

    const conflict = rows.find((row) => row.partnerId !== partnerId);
    return conflict ? this.mapRow(conflict) : null;
  }

  /** The tenant owner, for the self-referral comparison. Only called when a primary partner exists. */
  private async readTenantOwner(tenantId: string): Promise<{ ownerUserId: string | null } | null> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { ownerUserId: true },
      });
      return tenant ? { ownerUserId: tenant.ownerUserId ?? null } : null;
    } catch (error) {
      // Self-referral cannot be ruled out without this, so the attribution is refused rather than
      // granted on an unverified claim.
      this.logger.error(`tenant owner read failed tenant=${tenantId} reason=${this.safeReason(error)}`);
      throw new ServiceUnavailableException(ATTRIBUTION_LEDGER_UNAVAILABLE);
    }
  }

  private mapRow(row: PartnerAttributionRow): PartnerAttribution {
    return {
      id: row.id,
      partnerId: row.partnerId,
      tenantId: row.tenantId ?? '',
      campaignId: row.campaignId ?? null,
      referralCode: row.referralCode ?? null,
      referralToken: row.referralToken ?? null,
      attributionSource: row.attributionSource,
      attributionWindowHours: row.attributionWindowHours,
      capturedAt: this.toIso(row.capturedAt),
      effectiveAt: this.toIso(row.effectiveAt),
      expiresAt: this.toIso(row.expiresAt),
      agreementVersion: row.agreementVersion,
      policyVersion: row.policyVersion,
      state: row.state as PartnerAttributionState,
      isPrimary: Boolean(row.isPrimary),
      createdAt: this.toIso(row.createdAt),
      updatedAt: this.toIso(row.updatedAt),
      idempotencyKey: row.idempotencyKey,
    };
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }

  /** Prisma's "unique constraint failed" code, raised by the `idempotency_key` unique index. */
  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'P2002'
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
