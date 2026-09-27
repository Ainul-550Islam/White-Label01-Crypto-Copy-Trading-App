import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GovernancePolicyService } from './governance-policy.service';
import { REPORT_DEFINITIONS } from './templates/report-definitions';

export interface ReportTemplate {
  reportType: string;
  jurisdiction: string;
  templateVersion: string;
  schemaVersion: string;
  requiredFields: string[];
  sourceSystems: string[];
  periodType: 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ADHOC';
  methodology: string;
  calculationVersion: string;
  requiresCertification: boolean;
  requiresApproval: boolean;
  deliveryChannels: string[];
  policyVersion: string;
  validationRules: string[];
}

@Injectable()
export class ComplianceReportTemplateService {
  private readonly logger = new Logger(ComplianceReportTemplateService.name);

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly config: ConfigService,
  ) {}

  getTemplate(reportType: string, jurisdiction: string): ReportTemplate {
    this.policyService.validateJurisdiction(jurisdiction);
    const j = jurisdiction.toUpperCase();
    const key = `${reportType}_${j}`;
    const specific = (REPORT_DEFINITIONS as any)[key];
    const generic = (REPORT_DEFINITIONS as any)[reportType];

    const def = specific ?? generic;
    if (!def) throw new BadRequestException(`no template for reportType ${reportType} jurisdiction ${j}`);

    const policy = this.policyService.buildPolicy(null, j);
    const requirement = policy.reportRequirements.find((r) => r.reportType === reportType);

    return {
      reportType,
      jurisdiction: j,
      templateVersion: def.templateVersion ?? `1.0.0_${policy.policyVersion}`,
      schemaVersion: def.schemaVersion ?? '2026-01',
      requiredFields: requirement?.requiredFields ?? def.requiredFields ?? ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion'],
      sourceSystems: requirement?.sourceSystems ?? def.sourceSystems ?? ['Audit'],
      periodType: def.periodType ?? 'MONTHLY',
      methodology: def.methodology ?? `AUTHORITATIVE_AGGREGATION_FROM_${(requirement?.sourceSystems ?? def.sourceSystems ?? ['Audit']).join('_')}_POLICY_${policy.policyVersion}`,
      calculationVersion: def.calculationVersion ?? `calc_${policy.policyVersion}`,
      requiresCertification: requirement?.requiresCertification ?? def.requiresCertification ?? true,
      requiresApproval: requirement?.requiresApproval ?? true,
      deliveryChannels: requirement?.deliveryChannels ?? def.deliveryChannels ?? ['INTERNAL_STORAGE'],
      policyVersion: policy.policyVersion,
      validationRules: def.validationRules ?? ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'RECONCILIATION_RESOLVED', 'FINGERPRINT_DETERMINISTIC'],
    };
  }

  listTemplates(jurisdiction?: string): ReportTemplate[] {
    const jurisdictions = jurisdiction ? [jurisdiction.toUpperCase()] : this.policyService.getSupportedJurisdictions();
    const templates: ReportTemplate[] = [];
    for (const defKey of Object.keys(REPORT_DEFINITIONS)) {
      // defKey may be reportType or reportType_JURISDICTION
      const parts = defKey.split('_');
      const reportType = parts[0].includes('REPORT') || parts[0].includes('SUMMARY') || parts[0].includes('STATEMENT') || parts[0].includes('TRAIL') || parts[0].includes('INCIDENT') || parts[0].includes('GOVERNANCE') ? defKey : parts[0];
      // Actually REPORT_DEFINITIONS keys are report types, not composite. Simplify:
    }
    for (const rt of Object.keys(REPORT_DEFINITIONS)) {
      for (const j of jurisdictions) {
        try {
          templates.push(this.getTemplate(rt, j));
        } catch {
          /* ignore */
        }
      }
    }
    return templates;
  }

  validateTemplate(reportType: string, jurisdiction: string): boolean {
    try {
      this.getTemplate(reportType, jurisdiction);
      return true;
    } catch {
      return false;
    }
  }
}
