import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EvidencePackage, EvidenceState, GovernanceActionType, AUTHORITATIVE_SOURCE_SYSTEMS } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class EvidencePackageService {
  private readonly logger = new Logger(EvidencePackageService.name);
  private readonly inMemory: Map<string, EvidencePackage> = new Map();

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async createPackage(params: {
    tenantId: string;
    caseReference: string;
    evidenceType: string;
    sourceRecords: string[];
    sourceReferences: string[];
    redactionPolicy: string;
    generator: string;
    correlationId: string;
    createdBy: string;
    auditReference?: string;
  }): Promise<EvidencePackage> {
    if (!params.tenantId || !params.caseReference || !params.evidenceType) throw new BadRequestException('tenantId, caseReference, evidenceType required');
    if (!params.sourceRecords || params.sourceRecords.length === 0) throw new BadRequestException('sourceRecords required');

    // Validate source references come from authoritative systems
    for (const ref of params.sourceReferences) {
      const system = ref.split(':')[0];
      if (system && !AUTHORITATIVE_SOURCE_SYSTEMS.includes(system as any) && system !== 'ClientProfile' && system !== 'Users') {
        // Allow any prefix that is in authoritative list, but log warning for unknown
        this.logger.warn(`evidence source reference ${ref} not in authoritative list corr=${params.correlationId}`);
      }
    }

    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ tenantId: params.tenantId, caseReference: params.caseReference, sourceRecords: [...params.sourceRecords].sort(), policyVersion: this.policyService.getPolicyVersion() }))
      .digest('hex');

    const pkg: EvidencePackage = {
      id: `evp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      caseReference: params.caseReference,
      evidenceType: params.evidenceType,
      state: EvidenceState.DRAFT,
      sourceRecords: params.sourceRecords,
      sourceReferences: params.sourceReferences,
      recordCount: params.sourceRecords.length,
      generatedAt: new Date().toISOString(),
      finalizedAt: null,
      fileLocation: `governance/evidence/${params.tenantId}/${params.caseReference}/${Date.now()}.json`,
      fileHash: fingerprint,
      fingerprint,
      redactionPolicy: params.redactionPolicy,
      generator: params.generator,
      auditReference: params.auditReference ?? null,
      policyVersion: this.policyService.getPolicyVersion(),
      correlationId: params.correlationId,
      isImmutable: false,
    };

    this.inMemory.set(pkg.id, pkg);
    try {
      await (this.prisma as any).evidencePackage?.create?.({
        data: {
          id: pkg.id,
          tenantId: pkg.tenantId,
          caseReference: pkg.caseReference,
          evidenceType: pkg.evidenceType,
          state: pkg.state,
          sourceRecords: pkg.sourceRecords,
          sourceReferences: pkg.sourceReferences,
          recordCount: pkg.recordCount,
          generatedAt: new Date(pkg.generatedAt),
          fileLocation: pkg.fileLocation,
          fileHash: pkg.fileHash,
          fingerprint: pkg.fingerprint,
          redactionPolicy: pkg.redactionPolicy,
          generator: pkg.generator,
          auditReference: pkg.auditReference,
          policyVersion: pkg.policyVersion,
          correlationId: pkg.correlationId,
          isImmutable: pkg.isImmutable,
        },
      });
    } catch {
      this.logger.debug(`evidence persist skipped id=${pkg.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.EVIDENCE_PACKAGE_CREATE,
      evidencePackageId: pkg.id,
      state: pkg.state,
      result: 'CREATED',
      correlationId: params.correlationId,
      createdBy: params.createdBy,
      safeEvidence: { caseReference: params.caseReference, evidenceType: params.evidenceType, recordCount: pkg.recordCount, fingerprint },
    });

    this.logger.log(`evidence package created id=${pkg.id} case=${params.caseReference} corr=${params.correlationId}`);
    return pkg;
  }

  async finalizePackage(params: { tenantId: string; packageId: string; correlationId: string; operatorId: string }): Promise<EvidencePackage> {
    const pkg = await this.getPackage(params.tenantId, params.packageId);
    if (pkg.isImmutable) throw new BadRequestException('evidence package already immutable');
    if (pkg.state === EvidenceState.FINALIZED) throw new BadRequestException('already finalized');

    pkg.state = EvidenceState.FINALIZED;
    pkg.finalizedAt = new Date().toISOString();
    pkg.isImmutable = true;

    this.inMemory.set(pkg.id, pkg);
    try {
      await (this.prisma as any).evidencePackage?.update?.({
        where: { id: pkg.id },
        data: { state: pkg.state, finalizedAt: new Date(pkg.finalizedAt), isImmutable: true },
      });
    } catch {
      this.logger.debug(`evidence finalize persist skipped id=${pkg.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.EVIDENCE_PACKAGE_FINALIZE,
      evidencePackageId: pkg.id,
      state: pkg.state,
      result: 'FINALIZED',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { caseReference: pkg.caseReference, fingerprint: pkg.fingerprint, recordCount: pkg.recordCount },
    });

    this.logger.log(`evidence package finalized id=${pkg.id} corr=${params.correlationId}`);
    return pkg;
  }

  async getPackage(tenantId: string, packageId: string): Promise<EvidencePackage> {
    const mem = this.inMemory.get(packageId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).evidencePackage?.findUnique?.({ where: { id: packageId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {
      /* ignore */
    }
    throw new NotFoundException(`evidence package ${packageId} not found`);
  }

  async listPackages(tenantId: string, filters?: { caseReference?: string; evidenceType?: string; state?: EvidenceState }): Promise<EvidencePackage[]> {
    let list = [...this.inMemory.values()].filter((p) => p.tenantId === tenantId);
    if (filters?.caseReference) list = list.filter((p) => p.caseReference === filters.caseReference);
    if (filters?.evidenceType) list = list.filter((p) => p.evidenceType === filters.evidenceType);
    if (filters?.state) list = list.filter((p) => p.state === filters.state);
    try {
      const where: any = { tenantId };
      if (filters?.caseReference) where.caseReference = filters.caseReference;
      if (filters?.evidenceType) where.evidenceType = filters.evidenceType;
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).evidencePackage?.findMany?.({ where, take: 500, orderBy: { generatedAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  async assertImmutable(tenantId: string, packageId: string): Promise<void> {
    const pkg = await this.getPackage(tenantId, packageId);
    if (!pkg.isImmutable) throw new BadRequestException('evidence package not immutable yet');
  }

  private mapRow(row: any): EvidencePackage {
    return {
      id: row.id,
      tenantId: row.tenantId,
      caseReference: row.caseReference,
      evidenceType: row.evidenceType,
      state: row.state,
      sourceRecords: row.sourceRecords ?? [],
      sourceReferences: row.sourceReferences ?? [],
      recordCount: row.recordCount ?? 0,
      generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : row.generatedAt,
      finalizedAt: row.finalizedAt ? (row.finalizedAt instanceof Date ? row.finalizedAt.toISOString() : row.finalizedAt) : null,
      fileLocation: row.fileLocation ?? null,
      fileHash: row.fileHash ?? null,
      fingerprint: row.fingerprint,
      redactionPolicy: row.redactionPolicy,
      generator: row.generator,
      auditReference: row.auditReference ?? null,
      policyVersion: row.policyVersion,
      correlationId: row.correlationId,
      isImmutable: !!row.isImmutable,
    };
  }
}
