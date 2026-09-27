import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PartnerAttribution, PartnerAttributionState, PartnerAuditAction } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerReferralService } from './partner-referral.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerAttributionService {
  private readonly logger = new Logger(PartnerAttributionService.name);
  private readonly inMemory: Map<string, PartnerAttribution> = new Map();
  private readonly tenantPrimary: Map<string, string> = new Map(); // tenantId -> attributionId

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly agreementService: PartnerAgreementService,
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly referralService: PartnerReferralService,
    private readonly tenantService: PartnerTenantService,
    private readonly prisma: PrismaService,
  ) {}

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
    if (!params.referralCode && !params.referralToken && !['TENANT_PROVISIONING', 'CAMPAIGN', 'MANUAL_APPROVED'].includes(params.attributionSource)) {
      throw new BadRequestException('attribution requires referral evidence or approved provisioning source');
    }

    await this.profileService.getProfile(params.partnerId);
    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) throw new BadRequestException(`no active agreement for partner ${params.partnerId}`);

    // Idempotency
    const existingByIdem = [...this.inMemory.values()].find(a => a.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) return existingByIdem;

    // Self-referral protection
    const tenantPrimary = await this.tenantService.getPrimaryPartnerForTenant(params.tenantId);
    if (tenantPrimary && tenantPrimary.partnerId === params.partnerId) {
      // Check if tenant owner is partner owner?
      try {
        const profile = await this.profileService.getProfile(params.partnerId);
        const tenant = await (this.prisma as any).tenant?.findUnique?.({ where: { id: params.tenantId }, select: { ownerUserId: true } });
        if (tenant && tenant.ownerUserId === profile.ownerUserId) {
          throw new BadRequestException('self-referral not allowed');
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
    }

    // Check existing primary attribution conflict
    const isPrimary = params.isPrimary ?? true;
    if (isPrimary) {
      const existingPrimaryId = this.tenantPrimary.get(params.tenantId);
      if (existingPrimaryId) {
        const existing = this.inMemory.get(existingPrimaryId);
        if (existing && existing.partnerId !== params.partnerId && existing.state === PartnerAttributionState.ACTIVE) {
          throw new ConflictException(`tenant ${params.tenantId} already attributed to partner ${existing.partnerId}`);
        }
      }
      try {
        const rows = await (this.prisma as any).partnerAttribution?.findMany?.({ where: { tenantId: params.tenantId, isPrimary: true, state: 'ACTIVE' } });
        if (rows && rows.length > 0) {
          const conflict = rows.find((r: any) => r.partnerId !== params.partnerId);
          if (conflict) throw new ConflictException(`tenant ${params.tenantId} already has primary attribution to partner ${conflict.partnerId}`);
        }
      } catch (e) {
        if (e instanceof ConflictException) throw e;
      }
    }

    // Validate referral if provided
    let referralValid = false;
    if (params.referralCode) {
      try {
        const referral = await this.referralService.getByCode(params.referralCode);
        if (referral.partnerId !== params.partnerId) throw new BadRequestException('referral code belongs to different partner');
        if (referral.state !== 'ACTIVE') throw new BadRequestException(`referral code state ${referral.state} not active`);
        if (referral.expiresAt && new Date(referral.expiresAt) < new Date()) throw new BadRequestException('referral code expired');
        referralValid = true;
      } catch (e) {
        if (e instanceof BadRequestException || e instanceof ConflictException) throw e;
        throw new BadRequestException(`invalid referral code ${params.referralCode}`);
      }
    }
    if (params.referralToken) {
      try {
        const referral = await this.referralService.getByToken(params.referralToken);
        if (referral.partnerId !== params.partnerId) throw new BadRequestException('referral token belongs to different partner');
        if (referral.state !== 'ACTIVE') throw new BadRequestException(`referral token state ${referral.state} not active`);
        referralValid = true;
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException('invalid referral token');
      }
    }

    const capturedAt = new Date(params.capturedAt);
    if (isNaN(capturedAt.getTime())) throw new BadRequestException('invalid capturedAt');

    const policy = agreement.commissionPolicy;
    const windowHours = policy.attributionWindowHours;
    const effectiveAt = capturedAt;
    const expiresAt = new Date(capturedAt.getTime() + windowHours * 3600000);

    // Attribution window enforcement
    if (new Date() > expiresAt) throw new BadRequestException('attribution window expired at capture time');

    const attribution: PartnerAttribution = {
      id: `pattr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      campaignId: params.campaignId ?? null,
      referralCode: params.referralCode ?? null,
      referralToken: params.referralToken ?? null,
      attributionSource: params.attributionSource,
      attributionWindowHours: windowHours,
      capturedAt: capturedAt.toISOString(),
      effectiveAt: effectiveAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      agreementVersion: params.agreementVersion ?? `v${agreement.version}`,
      policyVersion: policy.policyVersion,
      state: PartnerAttributionState.ACTIVE,
      isPrimary,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
    };

    this.inMemory.set(attribution.id, attribution);
    if (isPrimary) this.tenantPrimary.set(params.tenantId, attribution.id);

    try {
      await (this.prisma as any).partnerAttribution?.create?.({
        data: {
          id: attribution.id,
          partnerId: attribution.partnerId,
          tenantId: attribution.tenantId,
          campaignId: attribution.campaignId,
          referralCode: attribution.referralCode,
          referralToken: attribution.referralToken,
          attributionSource: attribution.attributionSource,
          attributionWindowHours: attribution.attributionWindowHours,
          capturedAt: new Date(attribution.capturedAt),
          effectiveAt: new Date(attribution.effectiveAt),
          expiresAt: new Date(attribution.expiresAt),
          agreementVersion: attribution.agreementVersion,
          policyVersion: attribution.policyVersion,
          state: attribution.state,
          isPrimary: attribution.isPrimary,
          createdAt: new Date(attribution.createdAt),
          updatedAt: new Date(attribution.updatedAt),
          idempotencyKey: attribution.idempotencyKey,
        },
      });
    } catch {
      this.logger.debug(`attribution persist skipped id=${attribution.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      actorId: params.createdBy,
      action: PartnerAuditAction.REFERRAL_ATTRIBUTED,
      source: 'PARTNER_ATTRIBUTION_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: attribution.agreementVersion,
      policyVersion: attribution.policyVersion,
      safeEvidence: { attributionId: attribution.id, source: attribution.attributionSource, isPrimary, referralCode: attribution.referralCode },
    });

    this.logger.log(`attribution created id=${attribution.id} partner=${params.partnerId} tenant=${params.tenantId} corr=${params.correlationId}`);
    return attribution;
  }

  async getAttribution(attributionId: string, partnerId: string): Promise<PartnerAttribution> {
    const mem = this.inMemory.get(attributionId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerAttribution?.findUnique?.({ where: { id: attributionId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        return this.mapRow(row);
      }
    } catch {}
    throw new NotFoundException(`attribution ${attributionId} not found`);
  }

  async listAttributionsForPartner(partnerId: string): Promise<PartnerAttribution[]> {
    let list = [...this.inMemory.values()].filter(a => a.partnerId === partnerId);
    try {
      const rows = await (this.prisma as any).partnerAttribution?.findMany?.({ where: { partnerId }, take: 500 });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async getPrimaryAttributionForTenant(tenantId: string): Promise<PartnerAttribution | null> {
    const id = this.tenantPrimary.get(tenantId);
    if (id) {
      const mem = this.inMemory.get(id);
      if (mem) return mem;
    }
    try {
      const row = await (this.prisma as any).partnerAttribution?.findFirst?.({ where: { tenantId, isPrimary: true, state: 'ACTIVE' } });
      if (row) return this.mapRow(row);
    } catch {}
    return null;
  }

  async checkAttributionExpired(attributionId: string, partnerId: string): Promise<boolean> {
    const attr = await this.getAttribution(attributionId, partnerId);
    return new Date(attr.expiresAt) < new Date();
  }

  private mapRow(row: any): PartnerAttribution {
    return {
      id: row.id,
      partnerId: row.partnerId,
      tenantId: row.tenantId,
      campaignId: row.campaignId ?? null,
      referralCode: row.referralCode ?? null,
      referralToken: row.referralToken ?? null,
      attributionSource: row.attributionSource,
      attributionWindowHours: row.attributionWindowHours,
      capturedAt: row.capturedAt instanceof Date ? row.capturedAt.toISOString() : row.capturedAt,
      effectiveAt: row.effectiveAt instanceof Date ? row.effectiveAt.toISOString() : row.effectiveAt,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
      agreementVersion: row.agreementVersion,
      policyVersion: row.policyVersion,
      state: row.state,
      isPrimary: !!row.isPrimary,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    };
  }
}
