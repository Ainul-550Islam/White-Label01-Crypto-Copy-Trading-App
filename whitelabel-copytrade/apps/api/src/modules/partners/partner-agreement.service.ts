import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PartnerAgreement, PartnerAgreementState, PARTNER_AGREEMENT_TRANSITIONS, PartnerAuditAction, PartnerPolicy } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerAgreementService {
  private readonly logger = new Logger(PartnerAgreementService.name);
  private readonly inMemory: Map<string, PartnerAgreement> = new Map();

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly prisma: PrismaService,
  ) {}

  async createAgreement(params: {
    partnerId: string;
    commissionPolicy: PartnerPolicy;
    pricingRules: any[];
    payoutTerms: any;
    attributionRules: any[];
    effectiveFrom: string;
    effectiveTo?: string | null;
    jurisdiction?: string | null;
    responsibilities: string[];
    terminationClause?: string | null;
    createdBy: string;
    correlationId: string;
  }): Promise<PartnerAgreement> {
    if (!params.partnerId || !params.commissionPolicy || !params.effectiveFrom) {
      throw new BadRequestException('partnerId, commissionPolicy, effectiveFrom required');
    }

    const profile = await this.profileService.getProfile(params.partnerId);
    // Historical agreements immutable - new version
    const existingActive = [...this.inMemory.values()].filter(a => a.partnerId === params.partnerId && a.state === PartnerAgreementState.ACTIVE);
    const nextVersion = existingActive.length > 0 ? Math.max(...[...this.inMemory.values()].filter(a => a.partnerId === params.partnerId).map(a => a.version), 0) + 1 : 1;

    try {
      const rows = await (this.prisma as any).partnerAgreement?.findMany?.({ where: { partnerId: params.partnerId }, orderBy: { version: 'desc' }, take: 1 });
      if (rows && rows.length > 0) {
        const maxV = rows[0].version;
        if (maxV >= nextVersion) {
          // adjust
        }
      }
    } catch {}

    const effectiveFrom = new Date(params.effectiveFrom);
    if (isNaN(effectiveFrom.getTime())) throw new BadRequestException('invalid effectiveFrom');
    if (params.effectiveTo) {
      const effectiveTo = new Date(params.effectiveTo);
      if (isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom) throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    if (!params.commissionPolicy.commissionRates || params.commissionPolicy.commissionRates.length === 0) {
      throw new BadRequestException('commissionRates required - never invent rates');
    }

    const agreement: PartnerAgreement = {
      id: `pagr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      version: nextVersion,
      state: PartnerAgreementState.DRAFT,
      commissionPolicy: params.commissionPolicy,
      pricingRules: params.pricingRules ?? [],
      payoutTerms: params.payoutTerms,
      attributionRules: params.attributionRules ?? [],
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: params.effectiveTo ? new Date(params.effectiveTo).toISOString() : null,
      jurisdiction: params.jurisdiction ?? null,
      responsibilities: params.responsibilities,
      terminationClause: params.terminationClause ?? null,
      createdBy: params.createdBy,
      approvedBy: null,
      activatedAt: null,
      supersededAt: null,
      terminatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previousVersionId: existingActive.length > 0 ? existingActive[0].id : null,
      isImmutable: false,
    };

    this.inMemory.set(agreement.id, agreement);
    try {
      await (this.prisma as any).partnerAgreement?.create?.({
        data: {
          id: agreement.id,
          partnerId: agreement.partnerId,
          version: agreement.version,
          state: agreement.state,
          commissionPolicy: agreement.commissionPolicy as any,
          pricingRules: agreement.pricingRules as any,
          payoutTerms: agreement.payoutTerms as any,
          attributionRules: agreement.attributionRules as any,
          effectiveFrom: new Date(agreement.effectiveFrom),
          effectiveTo: agreement.effectiveTo ? new Date(agreement.effectiveTo) : null,
          jurisdiction: agreement.jurisdiction,
          responsibilities: agreement.responsibilities,
          terminationClause: agreement.terminationClause,
          createdBy: agreement.createdBy,
          createdAt: new Date(agreement.createdAt),
          updatedAt: new Date(agreement.updatedAt),
          previousVersionId: agreement.previousVersionId,
          isImmutable: false,
        },
      });
    } catch {
      this.logger.debug(`agreement persist skipped id=${agreement.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.createdBy,
      action: PartnerAuditAction.AGREEMENT_CREATED,
      source: 'PARTNER_AGREEMENT_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: `v${agreement.version}`,
      policyVersion: params.commissionPolicy.policyVersion,
      safeEvidence: { version: agreement.version, state: agreement.state },
    });

    this.logger.log(`agreement created id=${agreement.id} partner=${params.partnerId} v=${agreement.version} corr=${params.correlationId}`);
    return agreement;
  }

  async transitionState(params: {
    agreementId: string;
    partnerId: string;
    targetState: PartnerAgreementState;
    correlationId: string;
    actorId: string;
    actorRole?: string;
  }): Promise<PartnerAgreement> {
    const agreement = await this.getAgreement(params.agreementId, params.partnerId);
    if (agreement.isImmutable && params.targetState !== PartnerAgreementState.TERMINATED && params.targetState !== PartnerAgreementState.SUPERSEDED) {
      throw new BadRequestException('historical agreement immutable');
    }
    const allowed = PARTNER_AGREEMENT_TRANSITIONS[agreement.state];
    if (!allowed.includes(params.targetState)) throw new BadRequestException(`invalid transition ${agreement.state} -> ${params.targetState}`);

    const prev = agreement.state;
    agreement.state = params.targetState;
    agreement.updatedAt = new Date().toISOString();

    if (params.targetState === PartnerAgreementState.APPROVED) agreement.approvedBy = params.actorId;
    if (params.targetState === PartnerAgreementState.ACTIVE) {
      agreement.activatedAt = new Date().toISOString();
      agreement.isImmutable = false;
      // Supersede previous active agreements
      for (const other of [...this.inMemory.values()].filter(a => a.partnerId === params.partnerId && a.id !== agreement.id && a.state === PartnerAgreementState.ACTIVE)) {
        other.state = PartnerAgreementState.SUPERSEDED;
        other.supersededAt = new Date().toISOString();
        other.isImmutable = true;
        other.updatedAt = new Date().toISOString();
        this.inMemory.set(other.id, other);
        try {
          await (this.prisma as any).partnerAgreement?.update?.({ where: { id: other.id }, data: { state: other.state, supersededAt: new Date(other.supersededAt), isImmutable: true, updatedAt: new Date(other.updatedAt) } });
        } catch {}
      }
    }
    if (params.targetState === PartnerAgreementState.SUPERSEDED) {
      agreement.supersededAt = new Date().toISOString();
      agreement.isImmutable = true;
    }
    if (params.targetState === PartnerAgreementState.TERMINATED) {
      agreement.terminatedAt = new Date().toISOString();
      agreement.isImmutable = true;
    }

    this.inMemory.set(agreement.id, agreement);
    try {
      await (this.prisma as any).partnerAgreement?.update?.({
        where: { id: agreement.id },
        data: {
          state: agreement.state,
          approvedBy: agreement.approvedBy,
          activatedAt: agreement.activatedAt ? new Date(agreement.activatedAt) : null,
          supersededAt: agreement.supersededAt ? new Date(agreement.supersededAt) : null,
          terminatedAt: agreement.terminatedAt ? new Date(agreement.terminatedAt) : null,
          isImmutable: agreement.isImmutable,
          updatedAt: new Date(agreement.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`agreement transition persist skipped id=${agreement.id}`);
    }

    const auditMap: Record<PartnerAgreementState, PartnerAuditAction> = {
      [PartnerAgreementState.DRAFT]: PartnerAuditAction.AGREEMENT_CREATED,
      [PartnerAgreementState.REVIEW]: PartnerAuditAction.AGREEMENT_CREATED,
      [PartnerAgreementState.APPROVED]: PartnerAuditAction.AGREEMENT_APPROVED,
      [PartnerAgreementState.ACTIVE]: PartnerAuditAction.AGREEMENT_ACTIVATED,
      [PartnerAgreementState.SUPERSEDED]: PartnerAuditAction.AGREEMENT_SUPERSEDED,
      [PartnerAgreementState.TERMINATED]: PartnerAuditAction.AGREEMENT_TERMINATED,
    };

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: auditMap[params.targetState],
      source: 'PARTNER_AGREEMENT_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: `v${agreement.version}`,
      policyVersion: agreement.commissionPolicy.policyVersion,
      safeEvidence: { from: prev, to: params.targetState, version: agreement.version },
    });

    this.logger.log(`agreement transition id=${agreement.id} ${prev} -> ${params.targetState} corr=${params.correlationId}`);
    return agreement;
  }

  async getAgreement(agreementId: string, partnerId: string): Promise<PartnerAgreement> {
    const mem = this.inMemory.get(agreementId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerAgreement?.findUnique?.({ where: { id: agreementId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`agreement ${agreementId} not found`);
  }

  async getActiveAgreement(partnerId: string): Promise<PartnerAgreement | null> {
    const active = [...this.inMemory.values()].find(a => a.partnerId === partnerId && a.state === PartnerAgreementState.ACTIVE);
    if (active) return active;
    try {
      const row = await (this.prisma as any).partnerAgreement?.findFirst?.({ where: { partnerId, state: 'ACTIVE' }, orderBy: { version: 'desc' } });
      if (row) return this.mapRow(row);
    } catch {}
    return null;
  }

  async listAgreements(partnerId: string): Promise<PartnerAgreement[]> {
    let list = [...this.inMemory.values()].filter(a => a.partnerId === partnerId);
    list = list.sort((a, b) => b.version - a.version);
    try {
      const rows = await (this.prisma as any).partnerAgreement?.findMany?.({ where: { partnerId }, orderBy: { version: 'desc' }, take: 100 });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  private mapRow(row: any): PartnerAgreement {
    return {
      id: row.id,
      partnerId: row.partnerId,
      version: row.version,
      state: row.state,
      commissionPolicy: row.commissionPolicy,
      pricingRules: row.pricingRules ?? [],
      payoutTerms: row.payoutTerms,
      attributionRules: row.attributionRules ?? [],
      effectiveFrom: row.effectiveFrom instanceof Date ? row.effectiveFrom.toISOString() : row.effectiveFrom,
      effectiveTo: row.effectiveTo ? (row.effectiveTo instanceof Date ? row.effectiveTo.toISOString() : row.effectiveTo) : null,
      jurisdiction: row.jurisdiction ?? null,
      responsibilities: row.responsibilities ?? [],
      terminationClause: row.terminationClause ?? null,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy ?? null,
      activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : null,
      supersededAt: row.supersededAt ? (row.supersededAt instanceof Date ? row.supersededAt.toISOString() : row.supersededAt) : null,
      terminatedAt: row.terminatedAt ? (row.terminatedAt instanceof Date ? row.terminatedAt.toISOString() : row.terminatedAt) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      previousVersionId: row.previousVersionId ?? null,
      isImmutable: !!row.isImmutable,
    };
  }
}
