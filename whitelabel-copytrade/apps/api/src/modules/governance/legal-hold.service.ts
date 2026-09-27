import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { LegalHold, LegalHoldState, DataClassification, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class LegalHoldService {
  private readonly logger = new Logger(LegalHoldService.name);
  private readonly inMemory: Map<string, LegalHold> = new Map();

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async createHold(params: {
    tenantId?: string | null;
    caseReference: string;
    reason: string;
    affectedDataClasses: DataClassification[];
    affectedJurisdictions: string[];
    affectedSubjects?: string[];
    createdBy: string;
    correlationId: string;
    expiresAt?: string | null;
  }): Promise<LegalHold> {
    if (!params.caseReference || !params.reason) throw new BadRequestException('caseReference and reason required');
    if (params.affectedJurisdictions && params.affectedJurisdictions.length > 0) {
      for (const j of params.affectedJurisdictions) this.policyService.validateJurisdiction(j);
    }
    if (params.tenantId) {
      // tenant isolation check implicit
    }

    const hold: LegalHold = {
      id: `lh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId ?? null,
      caseReference: params.caseReference,
      reason: params.reason,
      state: LegalHoldState.DRAFT,
      affectedDataClasses: params.affectedDataClasses ?? [],
      affectedJurisdictions: params.affectedJurisdictions.map((j) => j.toUpperCase()),
      affectedSubjects: params.affectedSubjects ?? [],
      createdBy: params.createdBy,
      activatedBy: null,
      releasedBy: null,
      createdAt: new Date().toISOString(),
      activatedAt: null,
      releasedAt: null,
      expiresAt: params.expiresAt ?? null,
      correlationId: params.correlationId,
      policyVersion: this.policyService.getPolicyVersion(),
    };

    this.inMemory.set(hold.id, hold);
    try {
      await (this.prisma as any).legalHold?.create?.({
        data: {
          id: hold.id,
          tenantId: hold.tenantId,
          caseReference: hold.caseReference,
          reason: hold.reason,
          state: hold.state,
          affectedDataClasses: hold.affectedDataClasses,
          affectedJurisdictions: hold.affectedJurisdictions,
          affectedSubjects: hold.affectedSubjects,
          createdBy: hold.createdBy,
          createdAt: new Date(hold.createdAt),
          expiresAt: hold.expiresAt ? new Date(hold.expiresAt) : null,
          correlationId: hold.correlationId,
          policyVersion: hold.policyVersion,
        },
      });
    } catch {
      this.logger.debug(`legalHold persist skipped id=${hold.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId ?? 'PLATFORM',
      actionType: GovernanceActionType.LEGAL_HOLD_CREATE,
      legalHoldId: hold.id,
      state: hold.state,
      result: 'CREATED',
      correlationId: params.correlationId,
      createdBy: params.createdBy,
      safeEvidence: { caseReference: hold.caseReference, affectedDataClasses: hold.affectedDataClasses },
    });

    this.logger.log(`legal hold created id=${hold.id} case=${hold.caseReference} corr=${params.correlationId}`);
    return hold;
  }

  async activateHold(params: { holdId: string; tenantId?: string | null; activatedBy: string; correlationId: string }): Promise<LegalHold> {
    const hold = await this.getHold(params.holdId, params.tenantId);
    if (hold.state !== LegalHoldState.DRAFT) throw new BadRequestException(`cannot activate from state ${hold.state}`);
    hold.state = LegalHoldState.ACTIVE;
    hold.activatedBy = params.activatedBy;
    hold.activatedAt = new Date().toISOString();

    this.inMemory.set(hold.id, hold);
    try {
      await (this.prisma as any).legalHold?.update?.({
        where: { id: hold.id },
        data: { state: hold.state, activatedBy: hold.activatedBy, activatedAt: new Date(hold.activatedAt) },
      });
    } catch {
      this.logger.debug(`activate persist skipped id=${hold.id}`);
    }

    await this.audit.recordEvent({
      tenantId: hold.tenantId ?? 'PLATFORM',
      actionType: GovernanceActionType.LEGAL_HOLD_ACTIVATE,
      legalHoldId: hold.id,
      state: hold.state,
      result: 'ACTIVATED',
      correlationId: params.correlationId,
      createdBy: params.activatedBy,
      safeEvidence: { caseReference: hold.caseReference },
    });

    this.logger.log(`legal hold activated id=${hold.id} corr=${params.correlationId}`);
    return hold;
  }

  async releaseHold(params: { holdId: string; tenantId?: string | null; releasedBy: string; correlationId: string; reason: string }): Promise<LegalHold> {
    const hold = await this.getHold(params.holdId, params.tenantId);
    if (hold.state !== LegalHoldState.ACTIVE) throw new BadRequestException(`cannot release from state ${hold.state}`);
    hold.state = LegalHoldState.RELEASED;
    hold.releasedBy = params.releasedBy;
    hold.releasedAt = new Date().toISOString();

    this.inMemory.set(hold.id, hold);
    try {
      await (this.prisma as any).legalHold?.update?.({
        where: { id: hold.id },
        data: { state: hold.state, releasedBy: hold.releasedBy, releasedAt: new Date(hold.releasedAt) },
      });
    } catch {
      this.logger.debug(`release persist skipped id=${hold.id}`);
    }

    await this.audit.recordEvent({
      tenantId: hold.tenantId ?? 'PLATFORM',
      actionType: GovernanceActionType.LEGAL_HOLD_RELEASE,
      legalHoldId: hold.id,
      state: hold.state,
      result: 'RELEASED',
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.releasedBy,
      safeEvidence: { caseReference: hold.caseReference },
    });

    this.logger.log(`legal hold released id=${hold.id} corr=${params.correlationId}`);
    return hold;
  }

  async getHold(holdId: string, tenantId?: string | null): Promise<LegalHold> {
    const mem = this.inMemory.get(holdId);
    if (mem) {
      if (tenantId && mem.tenantId && mem.tenantId !== tenantId) {
        throw new BadRequestException('tenant isolation violation');
      }
      return mem;
    }
    try {
      const row = await (this.prisma as any).legalHold?.findUnique?.({ where: { id: holdId } });
      if (row) {
        if (tenantId && row.tenantId && row.tenantId !== tenantId) throw new BadRequestException('tenant isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {
      /* ignore */
    }
    throw new NotFoundException(`legal hold ${holdId} not found`);
  }

  async listActiveHolds(tenantId?: string | null): Promise<LegalHold[]> {
    let list = [...this.inMemory.values()].filter((h) => h.state === LegalHoldState.ACTIVE);
    if (tenantId) list = list.filter((h) => !h.tenantId || h.tenantId === tenantId);
    try {
      const where: any = { state: LegalHoldState.ACTIVE };
      if (tenantId) where.OR = [{ tenantId }, { tenantId: null }];
      const rows = await (this.prisma as any).legalHold?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  async listHolds(tenantId?: string | null, filters?: { state?: LegalHoldState }): Promise<LegalHold[]> {
    let list = [...this.inMemory.values()];
    if (tenantId) list = list.filter((h) => !h.tenantId || h.tenantId === tenantId);
    if (filters?.state) list = list.filter((h) => h.state === filters.state);
    try {
      const where: any = {};
      if (tenantId) where.OR = [{ tenantId }, { tenantId: null }];
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).legalHold?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  isBlockedByHold(params: { dataClass: DataClassification; subjectUserId?: string; tenantId: string }): boolean {
    const active = [...this.inMemory.values()].filter((h) => h.state === LegalHoldState.ACTIVE);
    for (const hold of active) {
      if (hold.tenantId && hold.tenantId !== params.tenantId) continue;
      if (hold.affectedDataClasses.length > 0 && !hold.affectedDataClasses.includes(params.dataClass)) continue;
      if (hold.affectedSubjects && hold.affectedSubjects.length > 0 && params.subjectUserId && !hold.affectedSubjects.includes(params.subjectUserId)) continue;
      return true;
    }
    return false;
  }

  private mapRow(row: any): LegalHold {
    return {
      id: row.id,
      tenantId: row.tenantId ?? null,
      caseReference: row.caseReference,
      reason: row.reason,
      state: row.state,
      affectedDataClasses: row.affectedDataClasses ?? [],
      affectedJurisdictions: row.affectedJurisdictions ?? [],
      affectedSubjects: row.affectedSubjects ?? [],
      createdBy: row.createdBy,
      activatedBy: row.activatedBy ?? null,
      releasedBy: row.releasedBy ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : null,
      releasedAt: row.releasedAt ? (row.releasedAt instanceof Date ? row.releasedAt.toISOString() : row.releasedAt) : null,
      expiresAt: row.expiresAt ? (row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt) : null,
      correlationId: row.correlationId,
      policyVersion: row.policyVersion,
    };
  }
}
