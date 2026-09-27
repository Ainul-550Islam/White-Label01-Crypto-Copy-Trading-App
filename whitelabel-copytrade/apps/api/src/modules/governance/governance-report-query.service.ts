import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ComplianceReportService } from './compliance-report.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceMetricsService } from './governance-metrics.service';
import { EvidencePackageService } from './evidence-package.service';
import { PrivacyRequestService } from './privacy-request.service';
import { GovernancePolicyService } from './governance-policy.service';
import { ReportState, PrivacyRequestState } from './governance.types';

@Injectable()
export class GovernanceReportQueryService {
  private readonly logger = new Logger(GovernanceReportQueryService.name);

  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly audit: GovernanceAuditService,
    private readonly metrics: GovernanceMetricsService,
    private readonly evidence: EvidencePackageService,
    private readonly privacy: PrivacyRequestService,
    private readonly policyService: GovernancePolicyService,
  ) {}

  async queryReports(params: {
    tenantId: string;
    reportType?: string;
    jurisdiction?: string;
    state?: ReportState;
    periodStart?: string;
    periodEnd?: string;
    correlationId: string;
  }) {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    if (params.jurisdiction) this.policyService.validateJurisdiction(params.jurisdiction);
    const reports = await this.reportService.listReports(params.tenantId, {
      reportType: params.reportType,
      state: params.state,
      jurisdiction: params.jurisdiction,
    });

    let filtered = reports;
    if (params.periodStart) {
      const ps = new Date(params.periodStart);
      filtered = filtered.filter((r) => new Date(r.periodStart) >= ps);
    }
    if (params.periodEnd) {
      const pe = new Date(params.periodEnd);
      filtered = filtered.filter((r) => new Date(r.periodEnd) <= pe);
    }

    // Deterministic sort
    filtered.sort((a, b) => {
      if (a.generatedAt !== b.generatedAt) return b.generatedAt.localeCompare(a.generatedAt);
      return a.id.localeCompare(b.id);
    });

    this.logger.log(`queryReports tenant=${params.tenantId} count=${filtered.length} corr=${params.correlationId}`);
    return {
      tenantId: params.tenantId,
      count: filtered.length,
      reports: filtered,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      isDeterministic: true,
    };
  }

  async queryPrivacyRequests(params: {
    tenantId: string;
    subjectUserId?: string;
    state?: PrivacyRequestState;
    correlationId: string;
  }) {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const requests = await this.privacy.listRequests(params.tenantId, {
      subjectUserId: params.subjectUserId,
      state: params.state,
    });
    requests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return {
      tenantId: params.tenantId,
      count: requests.length,
      requests,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      isDeterministic: true,
    };
  }

  async queryEvidence(params: {
    tenantId: string;
    caseReference?: string;
    evidenceType?: string;
    correlationId: string;
  }) {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const packages = await this.evidence.listPackages(params.tenantId, {
      caseReference: params.caseReference,
      evidenceType: params.evidenceType,
    });
    packages.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return {
      tenantId: params.tenantId,
      count: packages.length,
      evidencePackages: packages,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      isDeterministic: true,
    };
  }

  async queryAudit(params: {
    tenantId: string;
    correlationId: string;
    filters?: { actionType?: any; subjectUserId?: string; take?: number };
  }) {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const events = await this.audit.listEvents(params.tenantId, params.filters);
    return {
      tenantId: params.tenantId,
      count: events.length,
      events,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      isDeterministic: true,
    };
  }

  async queryMetrics(params: { tenantId: string; correlationId: string }) {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const metrics = await this.metrics.getMetrics(params.tenantId, params.correlationId);
    return metrics;
  }

  async queryGovernanceOverview(params: { tenantId: string; correlationId: string }) {
    const [reports, privacy, evidence, metrics] = await Promise.all([
      this.queryReports({ tenantId: params.tenantId, correlationId: params.correlationId }),
      this.queryPrivacyRequests({ tenantId: params.tenantId, correlationId: params.correlationId }),
      this.queryEvidence({ tenantId: params.tenantId, correlationId: params.correlationId }),
      this.queryMetrics({ tenantId: params.tenantId, correlationId: params.correlationId }),
    ]);
    return {
      tenantId: params.tenantId,
      reports: { count: reports.count },
      privacyRequests: { count: privacy.count },
      evidencePackages: { count: evidence.count },
      metrics,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      isDeterministic: true,
    };
  }
}
