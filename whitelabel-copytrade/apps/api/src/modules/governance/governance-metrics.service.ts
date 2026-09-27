import { Injectable, Logger } from '@nestjs/common';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface GovernanceMetrics {
  tenantId: string;
  generatedAt: string;
  policyVersion: string;
  privacyRequests: { total: number; byState: Record<string, number>; byType: Record<string, number> };
  retention: { total: number; byState: Record<string, number>; blockedByLegalHold: number };
  legalHolds: { total: number; active: number; byJurisdiction: Record<string, number> };
  reports: { total: number; byState: Record<string, number>; byType: Record<string, number>; certified: number; delivered: number };
  evidencePackages: { total: number; byState: Record<string, number>; immutable: number };
  consents: { total: number; active: number; withdrawn: number };
  reconciliation: { openMismatches: number; byType: Record<string, number>; bySeverity: Record<string, number> };
  audit: { totalEvents: number; byAction: Record<string, number> };
  correlationId: string;
}

@Injectable()
export class GovernanceMetricsService {
  private readonly logger = new Logger(GovernanceMetricsService.name);

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async getMetrics(tenantId: string, correlationId: string): Promise<GovernanceMetrics> {
    const metrics: GovernanceMetrics = {
      tenantId,
      generatedAt: new Date().toISOString(),
      policyVersion: this.policyService.getPolicyVersion(),
      privacyRequests: { total: 0, byState: {}, byType: {} },
      retention: { total: 0, byState: {}, blockedByLegalHold: 0 },
      legalHolds: { total: 0, active: 0, byJurisdiction: {} },
      reports: { total: 0, byState: {}, byType: {}, certified: 0, delivered: 0 },
      evidencePackages: { total: 0, byState: {}, immutable: 0 },
      consents: { total: 0, active: 0, withdrawn: 0 },
      reconciliation: { openMismatches: 0, byType: {}, bySeverity: {} },
      audit: { totalEvents: 0, byAction: {} },
      correlationId,
    };

    try {
      const pr = await (this.prisma as any).privacyRequest?.groupBy?.({ by: ['state'], where: { tenantId }, _count: { _all: true } });
      if (pr) {
        for (const g of pr) {
          metrics.privacyRequests.byState[g.state] = g._count._all;
          metrics.privacyRequests.total += g._count._all;
        }
      }
      const prType = await (this.prisma as any).privacyRequest?.groupBy?.({ by: ['requestType'], where: { tenantId }, _count: { _all: true } });
      if (prType) {
        for (const g of prType) metrics.privacyRequests.byType[g.requestType] = g._count._all;
      }
    } catch {
      this.logger.debug('metrics privacy fallback');
    }

    try {
      const ret = await (this.prisma as any).retentionCandidate?.groupBy?.({ by: ['state'], where: { tenantId }, _count: { _all: true } });
      if (ret) {
        for (const g of ret) {
          metrics.retention.byState[g.state] = g._count._all;
          metrics.retention.total += g._count._all;
        }
      }
      const blocked = await (this.prisma as any).retentionCandidate?.count?.({ where: { tenantId, blockedByLegalHold: true } });
      if (typeof blocked === 'number') metrics.retention.blockedByLegalHold = blocked;
    } catch {
      this.logger.debug('metrics retention fallback');
    }

    try {
      const lhTotal = await (this.prisma as any).legalHold?.count?.({ where: { OR: [{ tenantId }, { tenantId: null }] } });
      const lhActive = await (this.prisma as any).legalHold?.count?.({ where: { state: 'ACTIVE', OR: [{ tenantId }, { tenantId: null }] } });
      if (typeof lhTotal === 'number') metrics.legalHolds.total = lhTotal;
      if (typeof lhActive === 'number') metrics.legalHolds.active = lhActive;
    } catch {
      this.logger.debug('metrics legalHold fallback');
    }

    try {
      const rep = await (this.prisma as any).complianceReport?.groupBy?.({ by: ['state'], where: { tenantId }, _count: { _all: true } });
      if (rep) {
        for (const g of rep) {
          metrics.reports.byState[g.state] = g._count._all;
          metrics.reports.total += g._count._all;
        }
      }
      const repType = await (this.prisma as any).complianceReport?.groupBy?.({ by: ['reportType'], where: { tenantId }, _count: { _all: true } });
      if (repType) for (const g of repType) metrics.reports.byType[g.reportType] = g._count._all;
      const certified = await (this.prisma as any).complianceReport?.count?.({ where: { tenantId, certificationStatus: 'APPROVED' } });
      const delivered = await (this.prisma as any).complianceReport?.count?.({ where: { tenantId, deliveryStatus: 'DELIVERED' } });
      if (typeof certified === 'number') metrics.reports.certified = certified;
      if (typeof delivered === 'number') metrics.reports.delivered = delivered;
    } catch {
      this.logger.debug('metrics report fallback');
    }

    try {
      const ev = await (this.prisma as any).evidencePackage?.groupBy?.({ by: ['state'], where: { tenantId }, _count: { _all: true } });
      if (ev) {
        for (const g of ev) {
          metrics.evidencePackages.byState[g.state] = g._count._all;
          metrics.evidencePackages.total += g._count._all;
        }
      }
      const imm = await (this.prisma as any).evidencePackage?.count?.({ where: { tenantId, isImmutable: true } });
      if (typeof imm === 'number') metrics.evidencePackages.immutable = imm;
    } catch {
      this.logger.debug('metrics evidence fallback');
    }

    try {
      const cons = await (this.prisma as any).consentRecord?.groupBy?.({ by: ['status'], where: { tenantId }, _count: { _all: true } });
      if (cons) {
        for (const g of cons) {
          if (g.status === 'ACTIVE') metrics.consents.active = g._count._all;
          if (g.status === 'WITHDRAWN') metrics.consents.withdrawn = g._count._all;
          metrics.consents.total += g._count._all;
        }
      }
    } catch {
      this.logger.debug('metrics consent fallback');
    }

    try {
      const recon = await (this.prisma as any).governanceReconciliation?.groupBy?.({ by: ['type'], where: { tenantId }, _count: { _all: true } });
      if (recon) {
        for (const g of recon) {
          metrics.reconciliation.byType[g.type] = g._count._all;
          metrics.reconciliation.openMismatches += g._count._all;
        }
      }
      const sev = await (this.prisma as any).governanceReconciliation?.groupBy?.({ by: ['severity'], where: { tenantId }, _count: { _all: true } });
      if (sev) for (const g of sev) metrics.reconciliation.bySeverity[g.severity] = g._count._all;
    } catch {
      this.logger.debug('metrics reconciliation fallback');
    }

    try {
      const auditTotal = await (this.prisma as any).governanceAudit?.count?.({ where: { tenantId } });
      if (typeof auditTotal === 'number') metrics.audit.totalEvents = auditTotal;
      const auditBy = await (this.prisma as any).governanceAudit?.groupBy?.({ by: ['actionType'], where: { tenantId }, _count: { _all: true } });
      if (auditBy) for (const g of auditBy) metrics.audit.byAction[g.actionType] = g._count._all;
    } catch {
      this.logger.debug('metrics audit fallback');
    }

    this.logger.log(`metrics generated tenant=${tenantId} corr=${correlationId}`);
    return metrics;
  }
}
