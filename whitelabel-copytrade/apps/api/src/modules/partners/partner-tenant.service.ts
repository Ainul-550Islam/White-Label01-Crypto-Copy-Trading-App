import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PartnerTenantRelationship, PartnerTenantRelationshipType, PartnerTenantRelationshipState, PartnerAuditAction } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerTenantService {
  private readonly logger = new Logger(PartnerTenantService.name);
  private readonly inMemory: Map<string, PartnerTenantRelationship> = new Map();
  private readonly tenantPrimaryIndex: Map<string, string> = new Map(); // tenantId -> relationshipId (primary)

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly prisma: PrismaService,
  ) {}

  async assignTenant(params: {
    partnerId: string;
    tenantId: string;
    relationshipType: PartnerTenantRelationshipType;
    assignedBy: string;
    correlationId: string;
    idempotencyKey: string;
    isPrimary?: boolean;
    campaignId?: string;
    referralCode?: string;
    attributionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PartnerTenantRelationship> {
    if (!params.partnerId || !params.tenantId || !params.relationshipType || !params.idempotencyKey) {
      throw new BadRequestException('partnerId, tenantId, relationshipType, idempotencyKey required');
    }

    await this.profileService.getProfile(params.partnerId);

    // Idempotency
    const existingByIdem = [...this.inMemory.values()].find(r => r.idempotencyKey === params.idempotencyKey);
    if (existingByIdem) {
      this.logger.log(`tenant assign idempotent hit key=${params.idempotencyKey}`);
      return existingByIdem;
    }
    try {
      const row = await (this.prisma as any).partnerTenantRelationship?.findFirst?.({ where: { idempotencyKey: params.idempotencyKey } });
      if (row) return this.mapRow(row);
    } catch {}

    // Prevent duplicate primary ownership
    const isPrimary = params.isPrimary ?? true;
    if (isPrimary) {
      const existingPrimary = this.tenantPrimaryIndex.get(params.tenantId);
      if (existingPrimary) {
        const existingRel = this.inMemory.get(existingPrimary);
        if (existingRel && existingRel.partnerId !== params.partnerId && existingRel.state === PartnerTenantRelationshipState.ACTIVE) {
          throw new ConflictException(`tenant ${params.tenantId} already has primary partner ${existingRel.partnerId}, transfer required`);
        }
      }
      try {
        const primaryRows = await (this.prisma as any).partnerTenantRelationship?.findMany?.({ where: { tenantId: params.tenantId, isPrimary: true, state: 'ACTIVE' } });
        if (primaryRows && primaryRows.length > 0) {
          const other = primaryRows.find((r: any) => r.partnerId !== params.partnerId);
          if (other) throw new ConflictException(`tenant ${params.tenantId} already has primary partner ${other.partnerId}`);
        }
      } catch (e) {
        if (e instanceof ConflictException) throw e;
      }
    }

    const relationship: PartnerTenantRelationship = {
      id: `ptrel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      relationshipType: params.relationshipType,
      state: PartnerTenantRelationshipState.ACTIVE,
      attributionId: params.attributionId ?? null,
      campaignId: params.campaignId ?? null,
      referralCode: params.referralCode ?? null,
      assignedAt: new Date().toISOString(),
      assignedBy: params.assignedBy,
      activatedAt: new Date().toISOString(),
      terminatedAt: null,
      isPrimary,
      metadata: params.metadata ?? null,
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.inMemory.set(relationship.id, relationship);
    if (isPrimary) this.tenantPrimaryIndex.set(params.tenantId, relationship.id);

    try {
      await (this.prisma as any).partnerTenantRelationship?.create?.({
        data: {
          id: relationship.id,
          partnerId: relationship.partnerId,
          tenantId: relationship.tenantId,
          relationshipType: relationship.relationshipType,
          state: relationship.state,
          attributionId: relationship.attributionId,
          campaignId: relationship.campaignId,
          referralCode: relationship.referralCode,
          assignedAt: new Date(relationship.assignedAt),
          assignedBy: relationship.assignedBy,
          activatedAt: relationship.activatedAt ? new Date(relationship.activatedAt) : null,
          isPrimary: relationship.isPrimary,
          metadata: relationship.metadata as any,
          idempotencyKey: relationship.idempotencyKey,
          createdAt: new Date(relationship.createdAt),
          updatedAt: new Date(relationship.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`tenant relationship persist skipped id=${relationship.id}`);
    }

    // Delegate actual tenant creation to existing SaaS tenant provisioning service - we only record relationship
    // No fake tenant creation - relationship is derivative

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      actorId: params.assignedBy,
      action: PartnerAuditAction.TENANT_ASSIGNED,
      source: 'PARTNER_TENANT_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { relationshipType: params.relationshipType, isPrimary, tenantId: params.tenantId },
    });

    this.logger.log(`tenant assigned partner=${params.partnerId} tenant=${params.tenantId} corr=${params.correlationId}`);
    return relationship;
  }

  async transferTenant(params: {
    tenantId: string;
    fromPartnerId: string;
    toPartnerId: string;
    transferredBy: string;
    correlationId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<PartnerTenantRelationship> {
    if (!params.tenantId || !params.fromPartnerId || !params.toPartnerId) throw new BadRequestException('tenantId, fromPartnerId, toPartnerId required');
    if (params.fromPartnerId === params.toPartnerId) throw new BadRequestException('cannot transfer to same partner');

    const fromRel = [...this.inMemory.values()].find(r => r.tenantId === params.tenantId && r.partnerId === params.fromPartnerId && r.isPrimary && r.state === PartnerTenantRelationshipState.ACTIVE);
    if (!fromRel) throw new NotFoundException(`primary relationship for tenant ${params.tenantId} with partner ${params.fromPartnerId} not found`);

    // Terminate old
    fromRel.state = PartnerTenantRelationshipState.TERMINATED;
    fromRel.terminatedAt = new Date().toISOString();
    fromRel.updatedAt = new Date().toISOString();
    this.inMemory.set(fromRel.id, fromRel);
    this.tenantPrimaryIndex.delete(params.tenantId);

    try {
      await (this.prisma as any).partnerTenantRelationship?.update?.({ where: { id: fromRel.id }, data: { state: fromRel.state, terminatedAt: new Date(fromRel.terminatedAt), updatedAt: new Date(fromRel.updatedAt) } });
    } catch {}

    // Create new primary
    const newRel = await this.assignTenant({
      partnerId: params.toPartnerId,
      tenantId: params.tenantId,
      relationshipType: fromRel.relationshipType,
      assignedBy: params.transferredBy,
      correlationId: params.correlationId,
      idempotencyKey: params.idempotencyKey,
      isPrimary: true,
      metadata: { transferredFrom: params.fromPartnerId, reason: params.reason },
    });

    await this.audit.recordEvent({
      partnerId: params.toPartnerId,
      tenantId: params.tenantId,
      actorId: params.transferredBy,
      action: PartnerAuditAction.TENANT_TRANSFERRED,
      source: 'PARTNER_TENANT_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { fromPartnerId: params.fromPartnerId, toPartnerId: params.toPartnerId, tenantId: params.tenantId, reason: params.reason },
    });

    return newRel;
  }

  async unassignTenant(params: { relationshipId: string; partnerId: string; unassignedBy: string; correlationId: string; reason: string }): Promise<PartnerTenantRelationship> {
    const rel = await this.getRelationship(params.relationshipId, params.partnerId);
    if (rel.state === PartnerTenantRelationshipState.TERMINATED) throw new BadRequestException('already terminated');
    rel.state = PartnerTenantRelationshipState.TERMINATED;
    rel.terminatedAt = new Date().toISOString();
    rel.updatedAt = new Date().toISOString();
    this.inMemory.set(rel.id, rel);
    if (rel.isPrimary) this.tenantPrimaryIndex.delete(rel.tenantId);
    try {
      await (this.prisma as any).partnerTenantRelationship?.update?.({ where: { id: rel.id }, data: { state: rel.state, terminatedAt: new Date(rel.terminatedAt), updatedAt: new Date(rel.updatedAt) } });
    } catch {}
    await this.audit.recordEvent({
      partnerId: params.partnerId,
      tenantId: rel.tenantId,
      actorId: params.unassignedBy,
      action: PartnerAuditAction.TENANT_UNASSIGNED,
      source: 'PARTNER_TENANT_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { relationshipId: rel.id, tenantId: rel.tenantId, reason: params.reason },
    });
    return rel;
  }

  async getRelationship(relationshipId: string, partnerId: string): Promise<PartnerTenantRelationship> {
    const mem = this.inMemory.get(relationshipId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerTenantRelationship?.findUnique?.({ where: { id: relationshipId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        return this.mapRow(row);
      }
    } catch {}
    throw new NotFoundException(`relationship ${relationshipId} not found`);
  }

  async listTenantsForPartner(partnerId: string, filters?: { state?: PartnerTenantRelationshipState; relationshipType?: PartnerTenantRelationshipType }): Promise<PartnerTenantRelationship[]> {
    let list = [...this.inMemory.values()].filter(r => r.partnerId === partnerId);
    if (filters?.state) list = list.filter(r => r.state === filters.state);
    if (filters?.relationshipType) list = list.filter(r => r.relationshipType === filters.relationshipType);
    try {
      const where: any = { partnerId };
      if (filters?.state) where.state = filters.state;
      if (filters?.relationshipType) where.relationshipType = filters.relationshipType;
      const rows = await (this.prisma as any).partnerTenantRelationship?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  async getPrimaryPartnerForTenant(tenantId: string): Promise<PartnerTenantRelationship | null> {
    const id = this.tenantPrimaryIndex.get(tenantId);
    if (id) {
      const mem = this.inMemory.get(id);
      if (mem) return mem;
    }
    try {
      const row = await (this.prisma as any).partnerTenantRelationship?.findFirst?.({ where: { tenantId, isPrimary: true, state: 'ACTIVE' } });
      if (row) return this.mapRow(row);
    } catch {}
    return null;
  }

  private mapRow(row: any): PartnerTenantRelationship {
    return {
      id: row.id,
      partnerId: row.partnerId,
      tenantId: row.tenantId,
      relationshipType: row.relationshipType,
      state: row.state,
      attributionId: row.attributionId ?? null,
      campaignId: row.campaignId ?? null,
      referralCode: row.referralCode ?? null,
      assignedAt: row.assignedAt instanceof Date ? row.assignedAt.toISOString() : row.assignedAt,
      assignedBy: row.assignedBy,
      activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : null,
      terminatedAt: row.terminatedAt ? (row.terminatedAt instanceof Date ? row.terminatedAt.toISOString() : row.terminatedAt) : null,
      isPrimary: !!row.isPrimary,
      metadata: row.metadata ?? null,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }
}
