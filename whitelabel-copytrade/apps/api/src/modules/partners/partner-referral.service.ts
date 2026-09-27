import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PartnerReferral, PartnerReferralState, PartnerAuditAction } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class PartnerReferralService {
  private readonly logger = new Logger(PartnerReferralService.name);
  private readonly inMemory: Map<string, PartnerReferral> = new Map();
  private readonly codeIndex: Map<string, string> = new Map(); // code -> id
  private readonly tokenIndex: Map<string, string> = new Map(); // token -> id

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly prisma: PrismaService,
  ) {}

  async createReferral(params: {
    partnerId: string;
    campaignId?: string;
    code?: string;
    maxUses?: number;
    expiresAt?: string | null;
    createdBy: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<PartnerReferral> {
    if (!params.partnerId || !params.idempotencyKey) throw new BadRequestException('partnerId, idempotencyKey required');
    await this.profileService.getProfile(params.partnerId);

    const existingByIdem = [...this.inMemory.values()].find(r => r.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) return existingByIdem;

    const code = params.code ? params.code.toUpperCase() : this.generateCode();
    const token = this.generateToken(params.partnerId, code);

    if (this.codeIndex.has(code)) throw new ConflictException(`referral code ${code} already exists`);
    if (this.tokenIndex.has(token)) throw new ConflictException(`referral token collision`);

    if (params.expiresAt) {
      const exp = new Date(params.expiresAt);
      if (isNaN(exp.getTime()) || exp <= new Date()) throw new BadRequestException('expiresAt must be future');
    }

    const referral: PartnerReferral = {
      id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      campaignId: params.campaignId ?? null,
      code,
      token,
      state: PartnerReferralState.ACTIVE,
      createdBy: params.createdBy,
      expiresAt: params.expiresAt ? new Date(params.expiresAt).toISOString() : null,
      convertedAt: null,
      convertedTenantId: null,
      maxUses: params.maxUses ?? null,
      currentUses: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
    };

    this.inMemory.set(referral.id, referral);
    this.codeIndex.set(code, referral.id);
    this.tokenIndex.set(token, referral.id);

    try {
      await (this.prisma as any).partnerReferral?.create?.({
        data: {
          id: referral.id,
          partnerId: referral.partnerId,
          campaignId: referral.campaignId,
          code: referral.code,
          token: referral.token,
          state: referral.state,
          createdBy: referral.createdBy,
          expiresAt: referral.expiresAt ? new Date(referral.expiresAt) : null,
          maxUses: referral.maxUses,
          currentUses: referral.currentUses,
          createdAt: new Date(referral.createdAt),
          updatedAt: new Date(referral.updatedAt),
          idempotencyKey: referral.idempotencyKey,
        },
      });
    } catch {
      this.logger.debug(`referral persist skipped id=${referral.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.createdBy,
      action: PartnerAuditAction.REFERRAL_CREATED,
      source: 'PARTNER_REFERRAL_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { referralId: referral.id, code: referral.code, campaignId: referral.campaignId },
    });

    this.logger.log(`referral created id=${referral.id} partner=${params.partnerId} code=${code} corr=${params.correlationId}`);
    return referral;
  }

  async getByCode(code: string): Promise<PartnerReferral> {
    const upper = code.toUpperCase();
    const id = this.codeIndex.get(upper);
    if (id) {
      const mem = this.inMemory.get(id);
      if (mem) return mem;
    }
    try {
      const row = await (this.prisma as any).partnerReferral?.findFirst?.({ where: { code: upper } });
      if (row) return this.mapRow(row);
    } catch {}
    throw new NotFoundException(`referral code ${code} not found`);
  }

  async getByToken(token: string): Promise<PartnerReferral> {
    const id = this.tokenIndex.get(token);
    if (id) {
      const mem = this.inMemory.get(id);
      if (mem) return mem;
    }
    try {
      const row = await (this.prisma as any).partnerReferral?.findFirst?.({ where: { token } });
      if (row) return this.mapRow(row);
    } catch {}
    throw new NotFoundException(`referral token not found`);
  }

  async getReferral(referralId: string, partnerId: string): Promise<PartnerReferral> {
    const mem = this.inMemory.get(referralId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerReferral?.findUnique?.({ where: { id: referralId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        return this.mapRow(row);
      }
    } catch {}
    throw new NotFoundException(`referral ${referralId} not found`);
  }

  async listReferrals(partnerId: string): Promise<PartnerReferral[]> {
    let list = [...this.inMemory.values()].filter(r => r.partnerId === partnerId);
    try {
      const rows = await (this.prisma as any).partnerReferral?.findMany?.({ where: { partnerId }, take: 500 });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async markConverted(params: { referralId: string; partnerId: string; tenantId: string; correlationId: string }): Promise<PartnerReferral> {
    const referral = await this.getReferral(params.referralId, params.partnerId);
    if (referral.state !== PartnerReferralState.ACTIVE) throw new BadRequestException(`cannot convert from state ${referral.state}`);
    if (referral.expiresAt && new Date(referral.expiresAt) < new Date()) throw new BadRequestException('referral expired');
    if (referral.maxUses && referral.currentUses >= referral.maxUses) throw new BadRequestException('referral max uses reached');

    referral.currentUses += 1;
    if (referral.maxUses && referral.currentUses >= referral.maxUses) {
      referral.state = PartnerReferralState.CONVERTED;
    }
    referral.convertedAt = new Date().toISOString();
    referral.convertedTenantId = params.tenantId;
    referral.updatedAt = new Date().toISOString();

    this.inMemory.set(referral.id, referral);
    try {
      await (this.prisma as any).partnerReferral?.update?.({
        where: { id: referral.id },
        data: {
          currentUses: referral.currentUses,
          state: referral.state,
          convertedAt: new Date(referral.convertedAt),
          convertedTenantId: referral.convertedTenantId,
          updatedAt: new Date(referral.updatedAt),
        },
      });
    } catch {}

    return referral;
  }

  async revokeReferral(params: { referralId: string; partnerId: string; revokedBy: string; correlationId: string }): Promise<PartnerReferral> {
    const referral = await this.getReferral(params.referralId, params.partnerId);
    if (referral.state !== PartnerReferralState.ACTIVE) throw new BadRequestException(`cannot revoke from state ${referral.state}`);
    referral.state = PartnerReferralState.REVOKED;
    referral.updatedAt = new Date().toISOString();
    this.inMemory.set(referral.id, referral);
    try {
      await (this.prisma as any).partnerReferral?.update?.({ where: { id: referral.id }, data: { state: referral.state, updatedAt: new Date(referral.updatedAt) } });
    } catch {}
    return referral;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  private generateToken(partnerId: string, code: string): string {
    const raw = `${partnerId}:${code}:${Date.now()}:${Math.random()}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  private mapRow(row: any): PartnerReferral {
    return {
      id: row.id,
      partnerId: row.partnerId,
      campaignId: row.campaignId ?? null,
      code: row.code,
      token: row.token,
      state: row.state,
      createdBy: row.createdBy,
      expiresAt: row.expiresAt ? (row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt) : null,
      convertedAt: row.convertedAt ? (row.convertedAt instanceof Date ? row.convertedAt.toISOString() : row.convertedAt) : null,
      convertedTenantId: row.convertedTenantId ?? null,
      maxUses: row.maxUses ?? null,
      currentUses: row.currentUses ?? 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    };
  }
}
