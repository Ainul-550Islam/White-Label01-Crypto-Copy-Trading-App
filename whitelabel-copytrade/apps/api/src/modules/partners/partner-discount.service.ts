import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PartnerCampaign, PartnerCampaignState, PartnerDiscountType, PartnerAuditAction } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerDiscountService {
  private readonly logger = new Logger(PartnerDiscountService.name);
  private readonly inMemory: Map<string, PartnerCampaign> = new Map();

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly agreementService: PartnerAgreementService,
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly prisma: PrismaService,
  ) {}

  async createCampaign(params: {
    partnerId: string;
    name: string;
    code: string;
    discountType?: PartnerDiscountType;
    discountValue?: string;
    discountCurrency?: string;
    maxUses?: number;
    allowedPlans?: string[];
    attributionWindowHours: number;
    startsAt: string;
    endsAt?: string | null;
    createdBy: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<PartnerCampaign> {
    if (!params.partnerId || !params.name || !params.code || !params.startsAt || !params.idempotencyKey) {
      throw new BadRequestException('partnerId, name, code, startsAt, idempotencyKey required');
    }

    await this.profileService.getProfile(params.partnerId);
    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) throw new BadRequestException(`no active agreement for partner ${params.partnerId}`);

    // Idempotency
    const existingByIdem = [...this.inMemory.values()].find(c => c.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) return existingByIdem;

    // Code uniqueness per partner
    const existingByCode = [...this.inMemory.values()].find(c => c.partnerId === params.partnerId && c.code === params.code);
    if (existingByCode) throw new BadRequestException(`campaign code ${params.code} already exists for partner ${params.partnerId}`);

    const startsAt = new Date(params.startsAt);
    if (isNaN(startsAt.getTime())) throw new BadRequestException('invalid startsAt');
    if (params.endsAt) {
      const endsAt = new Date(params.endsAt);
      if (isNaN(endsAt.getTime()) || endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');
    }

    if (params.discountType && params.discountValue) {
      if (params.discountType === PartnerDiscountType.PERCENTAGE) {
        const bps = Math.round(parseFloat(params.discountValue) * 100);
        if (isNaN(bps) || bps <= 0 || bps > 10000) throw new BadRequestException('invalid percentage discount');
        this.policyService.validateDiscount(agreement.commissionPolicy, bps, params.discountCurrency ?? 'USD');
      } else if (params.discountType === PartnerDiscountType.FIXED_AMOUNT) {
        const amt = parseFloat(params.discountValue);
        if (isNaN(amt) || amt <= 0) throw new BadRequestException('invalid fixed discount amount');
        this.policyService.validateDiscount(agreement.commissionPolicy, 0, params.discountCurrency ?? 'USD', params.discountValue);
      }
      if (params.discountCurrency) {
        this.policyService.validateCurrency(agreement.commissionPolicy, params.discountCurrency);
      }
    }

    if (params.attributionWindowHours <= 0 || params.attributionWindowHours > 8760) {
      throw new BadRequestException('attributionWindowHours must be 1-8760');
    }

    const campaign: PartnerCampaign = {
      id: `pcamp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      name: params.name,
      code: params.code.toUpperCase(),
      state: PartnerCampaignState.DRAFT,
      discountType: params.discountType ?? null,
      discountValue: params.discountValue ?? null,
      discountCurrency: params.discountCurrency ? params.discountCurrency.toUpperCase() : null,
      maxUses: params.maxUses ?? null,
      currentUses: 0,
      allowedPlans: params.allowedPlans ?? null,
      attributionWindowHours: params.attributionWindowHours,
      startsAt: startsAt.toISOString(),
      endsAt: params.endsAt ? new Date(params.endsAt).toISOString() : null,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
    };

    this.inMemory.set(campaign.id, campaign);
    try {
      await (this.prisma as any).partnerCampaign?.create?.({
        data: {
          id: campaign.id,
          partnerId: campaign.partnerId,
          name: campaign.name,
          code: campaign.code,
          state: campaign.state,
          discountType: campaign.discountType,
          discountValue: campaign.discountValue,
          discountCurrency: campaign.discountCurrency,
          maxUses: campaign.maxUses,
          currentUses: campaign.currentUses,
          allowedPlans: campaign.allowedPlans as any,
          attributionWindowHours: campaign.attributionWindowHours,
          startsAt: new Date(campaign.startsAt),
          endsAt: campaign.endsAt ? new Date(campaign.endsAt) : null,
          createdBy: campaign.createdBy,
          createdAt: new Date(campaign.createdAt),
          updatedAt: new Date(campaign.updatedAt),
          idempotencyKey: campaign.idempotencyKey,
        },
      });
    } catch {
      this.logger.debug(`campaign persist skipped id=${campaign.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.createdBy,
      action: PartnerAuditAction.CAMPAIGN_CREATED,
      source: 'PARTNER_DISCOUNT_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: `v${agreement.version}`,
      policyVersion: agreement.commissionPolicy.policyVersion,
      safeEvidence: { campaignId: campaign.id, code: campaign.code, discountType: campaign.discountType, discountValue: campaign.discountValue },
    });

    this.logger.log(`campaign created id=${campaign.id} partner=${params.partnerId} code=${campaign.code} corr=${params.correlationId}`);
    return campaign;
  }

  async activateCampaign(params: { campaignId: string; partnerId: string; activatedBy: string; correlationId: string }): Promise<PartnerCampaign> {
    const camp = await this.getCampaign(params.campaignId, params.partnerId);
    if (camp.state !== PartnerCampaignState.DRAFT && camp.state !== PartnerCampaignState.PAUSED) throw new BadRequestException(`cannot activate from state ${camp.state}`);
    camp.state = PartnerCampaignState.ACTIVE;
    camp.updatedAt = new Date().toISOString();
    this.inMemory.set(camp.id, camp);
    try {
      await (this.prisma as any).partnerCampaign?.update?.({ where: { id: camp.id }, data: { state: camp.state, updatedAt: new Date(camp.updatedAt) } });
    } catch {}
    return camp;
  }

  async pauseCampaign(params: { campaignId: string; partnerId: string; pausedBy: string; correlationId: string }): Promise<PartnerCampaign> {
    const camp = await this.getCampaign(params.campaignId, params.partnerId);
    if (camp.state !== PartnerCampaignState.ACTIVE) throw new BadRequestException(`cannot pause from state ${camp.state}`);
    camp.state = PartnerCampaignState.PAUSED;
    camp.updatedAt = new Date().toISOString();
    this.inMemory.set(camp.id, camp);
    try {
      await (this.prisma as any).partnerCampaign?.update?.({ where: { id: camp.id }, data: { state: camp.state, updatedAt: new Date(camp.updatedAt) } });
    } catch {}
    return camp;
  }

  async getCampaign(campaignId: string, partnerId: string): Promise<PartnerCampaign> {
    const mem = this.inMemory.get(campaignId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerCampaign?.findUnique?.({ where: { id: campaignId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`campaign ${campaignId} not found`);
  }

  async listCampaigns(partnerId: string, filters?: { state?: PartnerCampaignState }): Promise<PartnerCampaign[]> {
    let list = [...this.inMemory.values()].filter(c => c.partnerId === partnerId);
    if (filters?.state) list = list.filter(c => c.state === filters.state);
    try {
      const where: any = { partnerId };
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).partnerCampaign?.findMany?.({ where, take: 200, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async incrementUsage(campaignId: string, partnerId: string): Promise<PartnerCampaign> {
    const camp = await this.getCampaign(campaignId, partnerId);
    if (camp.maxUses && camp.currentUses >= camp.maxUses) throw new BadRequestException('campaign max uses reached');
    camp.currentUses += 1;
    camp.updatedAt = new Date().toISOString();
    if (camp.maxUses && camp.currentUses >= camp.maxUses) {
      camp.state = PartnerCampaignState.EXPIRED;
    }
    this.inMemory.set(camp.id, camp);
    try {
      await (this.prisma as any).partnerCampaign?.update?.({ where: { id: camp.id }, data: { currentUses: camp.currentUses, state: camp.state, updatedAt: new Date(camp.updatedAt) } });
    } catch {}
    return camp;
  }

  private mapRow(row: any): PartnerCampaign {
    return {
      id: row.id,
      partnerId: row.partnerId,
      name: row.name,
      code: row.code,
      state: row.state,
      discountType: row.discountType ?? null,
      discountValue: row.discountValue ?? null,
      discountCurrency: row.discountCurrency ?? null,
      maxUses: row.maxUses ?? null,
      currentUses: row.currentUses ?? 0,
      allowedPlans: row.allowedPlans ?? null,
      attributionWindowHours: row.attributionWindowHours,
      startsAt: row.startsAt instanceof Date ? row.startsAt.toISOString() : row.startsAt,
      endsAt: row.endsAt ? (row.endsAt instanceof Date ? row.endsAt.toISOString() : row.endsAt) : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    };
  }
}
