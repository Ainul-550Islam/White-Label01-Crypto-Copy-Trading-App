import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PartnerUserRole, PartnerUserState, PartnerAuditAction } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface PartnerUser {
  id: string;
  partnerId: string;
  userId: string;
  role: PartnerUserRole;
  state: PartnerUserState;
  invitedBy: string;
  invitedAt: string;
  activatedAt?: string | null;
  suspendedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
}

@Injectable()
export class PartnerUserService {
  private readonly logger = new Logger(PartnerUserService.name);
  private readonly inMemory: Map<string, PartnerUser> = new Map();

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly prisma: PrismaService,
  ) {}

  async inviteUser(params: {
    partnerId: string;
    userId: string;
    role: PartnerUserRole;
    invitedBy: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<PartnerUser> {
    if (!params.partnerId || !params.userId || !params.role || !params.idempotencyKey) throw new BadRequestException('partnerId, userId, role, idempotencyKey required');
    if (!Object.values(PartnerUserRole).includes(params.role)) throw new BadRequestException(`invalid role ${params.role}`);

    await this.profileService.getProfile(params.partnerId);

    const existingByIdem = [...this.inMemory.values()].find(u => u.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) return existingByIdem;

    const duplicate = [...this.inMemory.values()].find(u => u.partnerId === params.partnerId && u.userId === params.userId && u.state !== PartnerUserState.DEACTIVATED);
    if (duplicate) throw new BadRequestException(`user ${params.userId} already has role in partner ${params.partnerId}`);

    const partnerUser: PartnerUser = {
      id: `puser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      userId: params.userId,
      role: params.role,
      state: PartnerUserState.INVITED,
      invitedBy: params.invitedBy,
      invitedAt: new Date().toISOString(),
      activatedAt: null,
      suspendedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
    };

    this.inMemory.set(partnerUser.id, partnerUser);
    try {
      await (this.prisma as any).partnerUser?.create?.({
        data: {
          id: partnerUser.id,
          partnerId: partnerUser.partnerId,
          userId: partnerUser.userId,
          role: partnerUser.role,
          state: partnerUser.state,
          invitedBy: partnerUser.invitedBy,
          invitedAt: new Date(partnerUser.invitedAt),
          createdAt: new Date(partnerUser.createdAt),
          updatedAt: new Date(partnerUser.updatedAt),
          idempotencyKey: partnerUser.idempotencyKey,
        },
      });
    } catch {
      this.logger.debug(`partner user persist skipped id=${partnerUser.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.invitedBy,
      action: PartnerAuditAction.PARTNER_USER_INVITED,
      source: 'PARTNER_USER_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { userId: params.userId, role: params.role },
    });

    this.logger.log(`partner user invited partner=${params.partnerId} user=${params.userId} role=${params.role} corr=${params.correlationId}`);
    return partnerUser;
  }

  async activateUser(params: { partnerUserId: string; partnerId: string; activatedBy: string; correlationId: string }): Promise<PartnerUser> {
    const pu = await this.getPartnerUser(params.partnerUserId, params.partnerId);
    if (pu.state !== PartnerUserState.INVITED && pu.state !== PartnerUserState.SUSPENDED) throw new BadRequestException(`cannot activate from state ${pu.state}`);
    pu.state = PartnerUserState.ACTIVE;
    pu.activatedAt = new Date().toISOString();
    pu.updatedAt = new Date().toISOString();
    this.inMemory.set(pu.id, pu);
    try {
      await (this.prisma as any).partnerUser?.update?.({ where: { id: pu.id }, data: { state: pu.state, activatedAt: new Date(pu.activatedAt), updatedAt: new Date(pu.updatedAt) } });
    } catch {}
    return pu;
  }

  async suspendUser(params: { partnerUserId: string; partnerId: string; suspendedBy: string; correlationId: string; reason: string }): Promise<PartnerUser> {
    const pu = await this.getPartnerUser(params.partnerUserId, params.partnerId);
    if (pu.state !== PartnerUserState.ACTIVE) throw new BadRequestException(`cannot suspend from state ${pu.state}`);
    pu.state = PartnerUserState.SUSPENDED;
    pu.suspendedAt = new Date().toISOString();
    pu.updatedAt = new Date().toISOString();
    this.inMemory.set(pu.id, pu);
    try {
      await (this.prisma as any).partnerUser?.update?.({ where: { id: pu.id }, data: { state: pu.state, suspendedAt: new Date(pu.suspendedAt), updatedAt: new Date(pu.updatedAt) } });
    } catch {}
    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.suspendedBy,
      action: PartnerAuditAction.PARTNER_USER_SUSPENDED,
      source: 'PARTNER_USER_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { userId: pu.userId, reason: params.reason },
    });
    return pu;
  }

  async changeRole(params: { partnerUserId: string; partnerId: string; newRole: PartnerUserRole; changedBy: string; correlationId: string }): Promise<PartnerUser> {
    const pu = await this.getPartnerUser(params.partnerUserId, params.partnerId);
    if (!Object.values(PartnerUserRole).includes(params.newRole)) throw new BadRequestException(`invalid role ${params.newRole}`);
    if (pu.state !== PartnerUserState.ACTIVE) throw new BadRequestException('only active users can change role');
    pu.role = params.newRole;
    pu.updatedAt = new Date().toISOString();
    this.inMemory.set(pu.id, pu);
    try {
      await (this.prisma as any).partnerUser?.update?.({ where: { id: pu.id }, data: { role: pu.role, updatedAt: new Date(pu.updatedAt) } });
    } catch {}
    return pu;
  }

  async getPartnerUser(partnerUserId: string, partnerId: string): Promise<PartnerUser> {
    const mem = this.inMemory.get(partnerUserId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerUser?.findUnique?.({ where: { id: partnerUserId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`partner user ${partnerUserId} not found`);
  }

  async listUsersForPartner(partnerId: string): Promise<PartnerUser[]> {
    let list = [...this.inMemory.values()].filter(u => u.partnerId === partnerId);
    try {
      const rows = await (this.prisma as any).partnerUser?.findMany?.({ where: { partnerId }, take: 500 });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async assertUserHasPartnerAccess(userId: string, partnerId: string, requiredRoles?: PartnerUserRole[]): Promise<PartnerUser> {
    const pu = [...this.inMemory.values()].find(u => u.userId === userId && u.partnerId === partnerId && u.state === PartnerUserState.ACTIVE);
    if (!pu) {
      try {
        const row = await (this.prisma as any).partnerUser?.findFirst?.({ where: { userId, partnerId, state: 'ACTIVE' } });
        if (row) return this.mapRow(row);
      } catch {}
      throw new BadRequestException(`user ${userId} has no active access to partner ${partnerId}`);
    }
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(pu.role)) {
      throw new BadRequestException(`user role ${pu.role} not authorized, required ${requiredRoles.join(',')}`);
    }
    return pu;
  }

  private mapRow(row: any): PartnerUser {
    return {
      id: row.id,
      partnerId: row.partnerId,
      userId: row.userId,
      role: row.role,
      state: row.state,
      invitedBy: row.invitedBy,
      invitedAt: row.invitedAt instanceof Date ? row.invitedAt.toISOString() : row.invitedAt,
      activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : null,
      suspendedAt: row.suspendedAt ? (row.suspendedAt instanceof Date ? row.suspendedAt.toISOString() : row.suspendedAt) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    };
  }
}
