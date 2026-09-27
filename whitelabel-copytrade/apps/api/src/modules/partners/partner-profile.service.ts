import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PartnerProfile, PartnerState, PartnerType, PARTNER_STATE_TRANSITIONS, PartnerAuditAction } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAuditService } from './partner-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerProfileService {
  private readonly logger = new Logger(PartnerProfileService.name);
  private readonly inMemory: Map<string, PartnerProfile> = new Map();
  private readonly codeIndex: Map<string, string> = new Map(); // code -> id

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly audit: PartnerAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async createProfile(params: {
    name: string;
    legalName?: string;
    type: PartnerType;
    ownerUserId: string;
    contactEmail: string;
    contactName?: string;
    website?: string;
    countryCode?: string;
    taxId?: string;
    billingEmail?: string;
    currency: string;
    idempotencyKey: string;
    correlationId: string;
    createdBy: string;
    code?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PartnerProfile> {
    if (!params.name || !params.type || !params.ownerUserId || !params.contactEmail || !params.idempotencyKey) {
      throw new BadRequestException('name, type, ownerUserId, contactEmail, idempotencyKey required');
    }
    if (!Object.values(PartnerType).includes(params.type)) throw new BadRequestException(`invalid partner type ${params.type}`);

    // Idempotency check
    const existingByIdem = [...this.inMemory.values()].find(p => p.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) {
      this.logger.log(`partner create idempotent hit key=${params.idempotencyKey}`);
      return existingByIdem;
    }
    try {
      const row = await (this.prisma as any).partnerProfile?.findFirst?.({ where: { idempotencyKey: params.idempotencyKey } });
      if (row) return this.mapRow(row);
    } catch {}

    const code = params.code ?? this.generateCode(params.name);
    if (this.codeIndex.has(code)) throw new ConflictException(`partner code ${code} already exists`);

    const profile: PartnerProfile = {
      id: `part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code,
      name: params.name,
      legalName: params.legalName ?? null,
      type: params.type,
      state: PartnerState.PENDING,
      ownerUserId: params.ownerUserId,
      contactEmail: params.contactEmail,
      contactName: params.contactName ?? null,
      website: params.website ?? null,
      countryCode: params.countryCode ?? null,
      taxId: params.taxId ?? null,
      billingEmail: params.billingEmail ?? null,
      currency: params.currency.toUpperCase(),
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activatedAt: null,
      suspendedAt: null,
      terminatedAt: null,
      metadata: params.metadata ?? null,
      policyVersion: this.policyService.getPolicyVersion(),
      agreementVersion: null,
    };

    this.inMemory.set(profile.id, profile);
    this.codeIndex.set(code, profile.id);

    try {
      await (this.prisma as any).partnerProfile?.create?.({
        data: {
          id: profile.id,
          code: profile.code,
          name: profile.name,
          legalName: profile.legalName,
          type: profile.type,
          state: profile.state,
          ownerUserId: profile.ownerUserId,
          contactEmail: profile.contactEmail,
          contactName: profile.contactName,
          website: profile.website,
          countryCode: profile.countryCode,
          taxId: profile.taxId,
          billingEmail: profile.billingEmail,
          currency: profile.currency,
          idempotencyKey: profile.idempotencyKey,
          createdAt: new Date(profile.createdAt),
          updatedAt: new Date(profile.updatedAt),
          policyVersion: profile.policyVersion,
          metadata: profile.metadata as any,
        },
      });
    } catch {
      this.logger.debug(`partner persist skipped id=${profile.id}`);
    }

    await this.audit.recordEvent({
      partnerId: profile.id,
      actorId: params.createdBy,
      action: PartnerAuditAction.PARTNER_CREATED,
      source: 'PARTNER_PROFILE_SERVICE',
      correlationId: params.correlationId,
      policyVersion: profile.policyVersion,
      safeEvidence: { code: profile.code, type: profile.type, state: profile.state },
    });

    this.logger.log(`partner created id=${profile.id} code=${code} corr=${params.correlationId}`);
    return profile;
  }

  async transitionState(params: {
    partnerId: string;
    targetState: PartnerState;
    correlationId: string;
    actorId: string;
    actorRole?: string;
    reason?: string;
  }): Promise<PartnerProfile> {
    const profile = await this.getProfile(params.partnerId);
    const allowed = PARTNER_STATE_TRANSITIONS[profile.state];
    if (!allowed.includes(params.targetState)) {
      throw new BadRequestException(`invalid transition ${profile.state} -> ${params.targetState}`);
    }

    const prevState = profile.state;
    profile.state = params.targetState;
    profile.updatedAt = new Date().toISOString();
    if (params.targetState === PartnerState.ACTIVE) profile.activatedAt = new Date().toISOString();
    if (params.targetState === PartnerState.SUSPENDED) profile.suspendedAt = new Date().toISOString();
    if (params.targetState === PartnerState.TERMINATED) profile.terminatedAt = new Date().toISOString();

    this.inMemory.set(profile.id, profile);
    try {
      await (this.prisma as any).partnerProfile?.update?.({
        where: { id: profile.id },
        data: {
          state: profile.state,
          updatedAt: new Date(profile.updatedAt),
          activatedAt: profile.activatedAt ? new Date(profile.activatedAt) : null,
          suspendedAt: profile.suspendedAt ? new Date(profile.suspendedAt) : null,
          terminatedAt: profile.terminatedAt ? new Date(profile.terminatedAt) : null,
        },
      });
    } catch {
      this.logger.debug(`partner transition persist skipped id=${profile.id}`);
    }

    const auditAction = this.mapStateToAudit(params.targetState);
    await this.audit.recordEvent({
      partnerId: profile.id,
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: auditAction,
      source: 'PARTNER_PROFILE_SERVICE',
      correlationId: params.correlationId,
      policyVersion: profile.policyVersion,
      safeEvidence: { from: prevState, to: params.targetState, reason: params.reason },
    });

    this.logger.log(`partner transition id=${profile.id} ${prevState} -> ${params.targetState} corr=${params.correlationId}`);
    return profile;
  }

  private mapStateToAudit(state: PartnerState): PartnerAuditAction {
    switch (state) {
      case PartnerState.ACTIVE: return PartnerAuditAction.PARTNER_APPROVED;
      case PartnerState.SUSPENDED: return PartnerAuditAction.PARTNER_SUSPENDED;
      case PartnerState.TERMINATED: return PartnerAuditAction.PARTNER_TERMINATED;
      case PartnerState.REACTIVATION_REVIEW: return PartnerAuditAction.PARTNER_REACTIVATED;
      default: return PartnerAuditAction.PARTNER_APPROVED;
    }
  }

  async getProfile(partnerId: string): Promise<PartnerProfile> {
    const mem = this.inMemory.get(partnerId);
    if (mem) return mem;
    try {
      const row = await (this.prisma as any).partnerProfile?.findUnique?.({ where: { id: partnerId } });
      if (row) {
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        this.codeIndex.set(mapped.code, mapped.id);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`partner ${partnerId} not found`);
  }

  async getByCode(code: string): Promise<PartnerProfile> {
    const id = this.codeIndex.get(code);
    if (id) {
      const mem = this.inMemory.get(id);
      if (mem) return mem;
    }
    try {
      const row = await (this.prisma as any).partnerProfile?.findFirst?.({ where: { code } });
      if (row) return this.mapRow(row);
    } catch {}
    throw new NotFoundException(`partner code ${code} not found`);
  }

  async listProfiles(filters?: { state?: PartnerState; type?: PartnerType; ownerUserId?: string }): Promise<PartnerProfile[]> {
    let list = [...this.inMemory.values()];
    if (filters?.state) list = list.filter(p => p.state === filters.state);
    if (filters?.type) list = list.filter(p => p.type === filters.type);
    if (filters?.ownerUserId) list = list.filter(p => p.ownerUserId === filters.ownerUserId);
    try {
      const where: any = {};
      if (filters?.state) where.state = filters.state;
      if (filters?.type) where.type = filters.type;
      if (filters?.ownerUserId) where.ownerUserId = filters.ownerUserId;
      const rows = await (this.prisma as any).partnerProfile?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async updateProfile(partnerId: string, updates: { name?: string; legalName?: string; contactEmail?: string; contactName?: string; website?: string; billingEmail?: string; metadata?: Record<string, unknown> }, correlationId: string, actorId: string): Promise<PartnerProfile> {
    const profile = await this.getProfile(partnerId);
    if (profile.state === PartnerState.TERMINATED) throw new BadRequestException('cannot update terminated partner');

    if (updates.name) profile.name = updates.name;
    if (updates.legalName !== undefined) profile.legalName = updates.legalName || null;
    if (updates.contactEmail) profile.contactEmail = updates.contactEmail;
    if (updates.contactName !== undefined) profile.contactName = updates.contactName || null;
    if (updates.website !== undefined) profile.website = updates.website || null;
    if (updates.billingEmail !== undefined) profile.billingEmail = updates.billingEmail || null;
    if (updates.metadata) profile.metadata = { ...(profile.metadata ?? {}), ...updates.metadata };
    profile.updatedAt = new Date().toISOString();

    this.inMemory.set(profile.id, profile);
    try {
      await (this.prisma as any).partnerProfile?.update?.({
        where: { id: profile.id },
        data: {
          name: profile.name,
          legalName: profile.legalName,
          contactEmail: profile.contactEmail,
          contactName: profile.contactName,
          website: profile.website,
          billingEmail: profile.billingEmail,
          metadata: profile.metadata as any,
          updatedAt: new Date(profile.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`partner update persist skipped id=${profile.id}`);
    }

    return profile;
  }

  private generateCode(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${base}_${suffix}`.toUpperCase();
  }

  private mapRow(row: any): PartnerProfile {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      legalName: row.legalName ?? null,
      type: row.type,
      state: row.state,
      ownerUserId: row.ownerUserId,
      contactEmail: row.contactEmail,
      contactName: row.contactName ?? null,
      website: row.website ?? null,
      countryCode: row.countryCode ?? null,
      taxId: row.taxId ?? null,
      billingEmail: row.billingEmail ?? null,
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : null,
      suspendedAt: row.suspendedAt ? (row.suspendedAt instanceof Date ? row.suspendedAt.toISOString() : row.suspendedAt) : null,
      terminatedAt: row.terminatedAt ? (row.terminatedAt instanceof Date ? row.terminatedAt.toISOString() : row.terminatedAt) : null,
      metadata: row.metadata ?? null,
      policyVersion: row.policyVersion,
      agreementVersion: row.agreementVersion ?? null,
    };
  }
}
