// # Responsibility: exercise native report/validation/certification/delivery persistence and unavailable-proof denials with typed unit fixtures; metadata/legacy flags are not live artifact, legal-compliance or transaction proof.
import { GovernanceController } from './governance.controller';
import { ConfigService } from '@nestjs/config';
import { type AuthenticatedActor, Permission } from '@wlct/shared-types';
import { DataInventoryService } from './data-inventory.service';
import { DataClassificationService } from './data-classification.service';
import { GovernanceReportQueryService } from './governance-report-query.service';
import { GovernanceMetricsService } from './governance-metrics.service';
import { GovernanceAuditExportService } from './governance-audit-export.service';
import { EvidencePackageService } from './evidence-package.service';
import { ConsentService } from './consent.service';
import { LegalHoldService } from './legal-hold.service';
import { RetentionEngineService } from './retention-engine.service';
import { RetentionPolicyService } from './retention-policy.service';
import { PrivacyDeletionService } from './privacy-deletion.service';
import { PrivacyExportService } from './privacy-export.service';
import { PrivacyDiscoveryService } from './privacy-discovery.service';
import { PrivacyRequestService } from './privacy-request.service';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type ComplianceReport as NativeReport, type ComplianceReportValidation, type ComplianceReportCertification, type ComplianceReportDelivery, type GovernanceAudit, type Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ComplianceReportService, reportMetadataFingerprint } from './compliance-report.service';
import { ComplianceReportValidationService } from './compliance-report-validation.service';
import { ComplianceReportCertificationService } from './compliance-report-certification.service';
import { ComplianceReportDeliveryService } from './compliance-report-delivery.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { type ComplianceReport, ReportState, CertificationState, DeliveryState, GovernanceActionType } from './governance.types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2020-03-01T00:00:00.000Z');
const NATIVE_REPORT = 'NativeReportUnderTest';
function reportRecord(overrides: Partial<ComplianceReport> = {}): ComplianceReport {
  const report: ComplianceReport = { id: 'report-1', tenantId: TENANT, reportType: 'UNIT_REPORT', reportVersion: 'unit-template-1', schemaVersion: 'unit-schema-1',
    jurisdiction: 'US', periodStart: '2020-01-01T00:00:00.000Z', periodEnd: '2020-02-01T00:00:00.000Z', generatedAt: NOW.toISOString(), dataAsOf: NOW.toISOString(),
    sourceReferences: ['Finance:unit-authoritative-reference'], methodology: 'unit-persisted-metadata', calculationVersion: 'unit-calculation-1', policyVersion: 'unit-policy-1',
    validationStatus: 'PASSED', certificationStatus: CertificationState.PENDING, deliveryStatus: DeliveryState.NOT_DELIVERED, state: ReportState.GENERATED,
    recordCount: 1, fileLocation: 'unit-only://artifact/reference', fileHash: 'a'.repeat(64), fingerprint: '', correlationId: 'unit-correlation', createdBy: 'creator-1', ...overrides };
  if (overrides.fingerprint === undefined) report.fingerprint = reportMetadataFingerprint(report);
  return report;
}
function nativeReport(report = reportRecord()): NativeReport {
  return { ...report, periodStart: new Date(report.periodStart), periodEnd: new Date(report.periodEnd), generatedAt: new Date(report.generatedAt),
    dataAsOf: new Date(report.dataAsOf), fileLocation: report.fileLocation ?? null, fileHash: report.fileHash ?? null, createdAt: NOW, updatedAt: NOW };
}
// Persisted PASSED is a controlled legacy unit fixture, not independently verified real source evidence.
function validationRecord(overrides: Partial<ComplianceReportValidation> = {}): ComplianceReportValidation {
  return { id: 'validation-1', reportId: 'report-1', tenantId: TENANT, isValid: true, validationStatus: 'PASSED', errors: [], warnings: [],
    sourceCompleteness: true, reconciliationResolved: true, periodCompleteness: true, fingerprintValid: true,
    sourceReferencesChecked: ['Finance:unit-authoritative-reference'], validatedAt: NOW, validator: 'validator-1', correlationId: 'unit-correlation',
    policyVersion: 'unit-policy-1', createdAt: NOW, ...overrides };
}
function certificationRecord(overrides: Partial<ComplianceReportCertification> = {}): ComplianceReportCertification {
  return { id: 'certification-1', tenantId: TENANT, reportId: 'report-1', state: 'PENDING', reviewerId: null, reviewerRole: null,
    fingerprint: reportRecord().fingerprint, validationEvidence: `PASSED:${NOW.toISOString()}`, comments: null, correlationId: 'unit-correlation',
    policyVersion: 'unit-policy-1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function deliveryRecord(overrides: Partial<ComplianceReportDelivery> = {}): ComplianceReportDelivery {
  return { id: 'delivery-1', tenantId: TENANT, reportId: 'report-1', channel: 'unit-channel', state: 'QUEUED', attemptCount: 0, lastAttemptAt: null,
    deliveredAt: null, deliveryEvidence: null, failureReason: null, correlationId: 'unit-correlation', createdAt: NOW, updatedAt: NOW, ...overrides };
}

describe('Native governance evidence and persistence denials', () => {
  let module: TestingModule; let report: ComplianceReport; let storedValidation: ComplianceReportValidation | null;
  let certification: ComplianceReportCertification | null; let delivery: ComplianceReportDelivery | null;
  const db = {
    complianceReport: { create: jest.fn<(args: Prisma.ComplianceReportCreateArgs) => Promise<NativeReport>>(), findFirst: jest.fn<(args: Prisma.ComplianceReportFindFirstArgs) => Promise<NativeReport | null>>(),
      findMany: jest.fn<(args: Prisma.ComplianceReportFindManyArgs) => Promise<NativeReport[]>>(), update: jest.fn<(args: Prisma.ComplianceReportUpdateArgs) => Promise<NativeReport>>() },
    complianceReportValidation: { create: jest.fn<(args: Prisma.ComplianceReportValidationCreateArgs) => Promise<ComplianceReportValidation>>(),
      findFirst: jest.fn<(args: Prisma.ComplianceReportValidationFindFirstArgs) => Promise<ComplianceReportValidation | null>>() },
    complianceReportCertification: { create: jest.fn<(args: Prisma.ComplianceReportCertificationCreateArgs) => Promise<ComplianceReportCertification>>(),
      findFirst: jest.fn<(args: Prisma.ComplianceReportCertificationFindFirstArgs) => Promise<ComplianceReportCertification | null>>(),
      findMany: jest.fn<(args: Prisma.ComplianceReportCertificationFindManyArgs) => Promise<ComplianceReportCertification[]>>(),
      update: jest.fn<(args: Prisma.ComplianceReportCertificationUpdateArgs) => Promise<ComplianceReportCertification>>() },
    complianceReportDelivery: { create: jest.fn<(args: Prisma.ComplianceReportDeliveryCreateArgs) => Promise<ComplianceReportDelivery>>(),
      findFirst: jest.fn<(args: Prisma.ComplianceReportDeliveryFindFirstArgs) => Promise<ComplianceReportDelivery | null>>(),
      findMany: jest.fn<(args: Prisma.ComplianceReportDeliveryFindManyArgs) => Promise<ComplianceReportDelivery[]>>(),
      update: jest.fn<(args: Prisma.ComplianceReportDeliveryUpdateArgs) => Promise<ComplianceReportDelivery>>() },
  };
  const reports = { getReport: jest.fn<ComplianceReportService['getReport']>(), transitionState: jest.fn<ComplianceReportService['transitionState']>(),
    updateValidationStatus: jest.fn<ComplianceReportService['updateValidationStatus']>(), updateCertificationStatus: jest.fn<ComplianceReportService['updateCertificationStatus']>(),
    updateDeliveryStatus: jest.fn<ComplianceReportService['updateDeliveryStatus']>() };
  const audit = { recordEvent: jest.fn<GovernanceAuditService['recordEvent']>() };
  const reconciliation = { listMismatches: jest.fn<GovernanceReconciliationService['listMismatches']>() };
  const template = { getTemplate: () => ({ templateVersion: 'unit-template-1', schemaVersion: 'unit-schema-1', calculationVersion: 'unit-calculation-1', sourceSystems: ['Finance'], requiredFields: [] }) };
  const policy = { buildPolicy: () => ({ policyVersion: 'unit-policy-1' }), validateJurisdiction: jest.fn<(jurisdiction: string) => void>(),
    assertTenantIsolation: (requested: string, actual: string) => { if (requested !== actual) throw new BadRequestException('Tenant isolation required'); } };
  const validateParams = { tenantId: TENANT, reportId: 'report-1', correlationId: 'unit-correlation', validatorId: 'validator-1', sourceAvailability: { Finance: true } };
  const requestParams = { tenantId: TENANT, reportId: 'report-1', correlationId: 'unit-correlation', requesterId: 'requester-1' };
  const certificationParams = { ...requestParams, certificationId: 'certification-1', reviewerId: 'reviewer-1', reviewerRole: 'COMPLIANCE', decision: 'APPROVED' as const };
  const deliveryParams = { tenantId: TENANT, deliveryId: 'delivery-1', correlationId: 'unit-correlation', operatorId: 'operator-1', deliveryEvidence: 'unit-caller-assertion' };
  beforeEach(async () => {
    report = reportRecord(); storedValidation = validationRecord(); certification = certificationRecord(); delivery = deliveryRecord();
    db.complianceReport.create.mockReset().mockResolvedValue(nativeReport(reportRecord({ state: ReportState.DRAFT, fileLocation: null, fileHash: null,
      sourceReferences: [], methodology: 'DRAFT_INTENT_NO_VERIFIED_SOURCE_ARTIFACT', validationStatus: 'PENDING' })));
    db.complianceReport.findFirst.mockReset().mockImplementation(async () => nativeReport(report)); db.complianceReport.findMany.mockReset().mockResolvedValue([]);
    db.complianceReport.update.mockReset().mockImplementation(async () => nativeReport(report));
    db.complianceReportValidation.create.mockReset().mockResolvedValue(validationRecord()); db.complianceReportValidation.findFirst.mockReset().mockImplementation(async () => storedValidation);
    db.complianceReportCertification.create.mockReset().mockResolvedValue(certificationRecord()); db.complianceReportCertification.findFirst.mockReset().mockImplementation(async () => certification);
    db.complianceReportCertification.findMany.mockReset().mockResolvedValue([]); db.complianceReportCertification.update.mockReset().mockResolvedValue(certificationRecord({ state: 'APPROVED', reviewerId: 'reviewer-1', reviewerRole: 'COMPLIANCE' }));
    db.complianceReportDelivery.create.mockReset().mockResolvedValue(deliveryRecord()); db.complianceReportDelivery.findFirst.mockReset().mockImplementation(async () => delivery);
    db.complianceReportDelivery.findMany.mockReset().mockResolvedValue([]); db.complianceReportDelivery.update.mockReset().mockResolvedValue(deliveryRecord({ state: 'FAILED', failureReason: 'unit-reason' }));
    reports.getReport.mockReset().mockImplementation(async () => report);
    reports.transitionState.mockReset().mockImplementation(async () => report); reports.updateValidationStatus.mockReset().mockImplementation(async () => report);
    reports.updateCertificationStatus.mockReset().mockImplementation(async () => report); reports.updateDeliveryStatus.mockReset().mockImplementation(async () => report);
    audit.recordEvent.mockReset().mockImplementation(async (params) => ({ ...params, id: 'unit-audit', createdAt: NOW.toISOString(), safeEvidence: params.safeEvidence ?? {} }));
    reconciliation.listMismatches.mockReset().mockResolvedValue([]); policy.validateJurisdiction.mockReset();
    module = await Test.createTestingModule({ providers: [ComplianceReportValidationService, ComplianceReportCertificationService, ComplianceReportDeliveryService,
      { provide: ComplianceReportService, useValue: reports }, { provide: PrismaService, useValue: db }, { provide: GovernanceAuditService, useValue: audit },
      { provide: GovernancePolicyService, useValue: policy }, { provide: ComplianceReportTemplateService, useValue: template },
      { provide: GovernanceReconciliationService, useValue: reconciliation },
      { provide: NATIVE_REPORT, useFactory: (p: GovernancePolicyService, a: GovernanceAuditService, t: ComplianceReportTemplateService, prisma: PrismaService) => new ComplianceReportService(p, a, t, prisma),
        inject: [GovernancePolicyService, GovernanceAuditService, ComplianceReportTemplateService, PrismaService] },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function native() { return module.get<ComplianceReportService>(NATIVE_REPORT); }
  function validations() { return module.get<ComplianceReportValidationService>(ComplianceReportValidationService); }
  function certifications() { return module.get<ComplianceReportCertificationService>(ComplianceReportCertificationService); }
  function deliveries() { return module.get<ComplianceReportDeliveryService>(ComplianceReportDeliveryService); }

  it('persists only a declared DRAFT intent with null artifact fields, never an invented generated report', async () => {
    await native().generateReport({ tenantId: TENANT, reportType: 'UNIT_REPORT', jurisdiction: 'US', periodStart: report.periodStart, periodEnd: report.periodEnd,
      correlationId: 'unit-correlation', createdBy: 'creator-1', sourceData: { Finance: [{ record: 'unit-declared-data' }] } });
    expect(db.complianceReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: TENANT, state: ReportState.DRAFT,
      fileLocation: null, fileHash: null, methodology: 'DRAFT_INTENT_NO_VERIFIED_SOURCE_ARTIFACT', sourceReferences: [expect.stringMatching(/^DECLARED:Finance:/)] }) });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ state: ReportState.DRAFT, safeEvidence: expect.objectContaining({ artifactGenerated: false }) }));
  });
  it('propagates draft persistence failure without returning a process-local report', async () => {
    const failure = new Error('report store unavailable'); db.complianceReport.create.mockRejectedValueOnce(failure);
    await expect(native().generateReport({ tenantId: TENANT, reportType: 'UNIT_REPORT', jurisdiction: 'US', periodStart: report.periodStart, periodEnd: report.periodEnd,
      correlationId: 'unit-correlation', createdBy: 'creator-1' })).rejects.toBe(failure); expect(audit.recordEvent).not.toHaveBeenCalled();
  });
  it('does not use a previously read report after a required subsequent native read fails', async () => {
    await native().getReport(TENANT, 'report-1'); const failure = new Error('report read unavailable'); db.complianceReport.findFirst.mockRejectedValueOnce(failure);
    await expect(native().getReport(TENANT, 'report-1')).rejects.toBe(failure);
  });
  it('checks returned native report tenancy and tenant-binds all list queries', async () => {
    db.complianceReport.findFirst.mockResolvedValueOnce(nativeReport(reportRecord({ tenantId: OTHER_TENANT })));
    await expect(native().getReport(TENANT, 'report-1')).rejects.toThrow('Tenant isolation required');
    await native().listReports(TENANT, { jurisdiction: 'us' });
    expect(db.complianceReport.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, jurisdiction: 'US' }, orderBy: { generatedAt: 'desc' } });
  });
  it('rejects a GENERATED transition without persisted artifact/source metadata', async () => {
    report = reportRecord({ state: ReportState.GENERATING, fileLocation: null, fileHash: null });
    await expect(native().transitionState({ tenantId: TENANT, reportId: 'report-1', targetState: ReportState.GENERATED, correlationId: 'unit-correlation', operatorId: 'operator-1' })).rejects.toThrow('GENERATED requires');
    expect(db.complianceReport.update).not.toHaveBeenCalled();
  });
  it('binds valid non-attesting report transitions to the original tenant/state', async () => {
    report = reportRecord({ state: ReportState.DRAFT });
    await native().transitionState({ tenantId: TENANT, reportId: 'report-1', targetState: ReportState.GENERATING, correlationId: 'unit-correlation', operatorId: 'operator-1' });
    expect(db.complianceReport.update).toHaveBeenCalledWith({ where: { id: 'report-1', tenantId: TENANT, state: ReportState.DRAFT }, data: { state: ReportState.GENERATING } });
  });
  it('does not silently coerce an unknown persisted report state to DRAFT', async () => {
    db.complianceReport.findFirst.mockResolvedValueOnce({ ...nativeReport(), state: 'UNRECOGNIZED' });
    await expect(native().getReport(TENANT, 'report-1')).rejects.toThrow('Malformed persisted report');
  });
  it('refuses DRAFT validation without auto-promoting it to GENERATED', async () => {
    report = reportRecord({ state: ReportState.DRAFT });
    await expect(validations().validateReport(validateParams)).rejects.toThrow(BadRequestException);
    expect(reports.transitionState).not.toHaveBeenCalled(); expect(db.complianceReportValidation.create).not.toHaveBeenCalled();
  });
  it('does not let caller sourceAvailability manufacture PASSED source-provenance evidence', async () => {
    const result = await validations().validateReport(validateParams);
    expect(result).toMatchObject({ validationStatus: 'FAILED', isValid: false, sourceCompleteness: false });
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'sourceProvenance', severity: 'ERROR', message: expect.stringMatching(/verifier not configured for Finance/) })]));
    expect(reports.transitionState).not.toHaveBeenCalledWith(expect.objectContaining({ targetState: ReportState.READY }));
  });
  it('treats a future/incomplete period as an ERROR, not a passing warning', async () => {
    report = reportRecord({ periodEnd: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await validations().validateReport(validateParams)).toMatchObject({ isValid: false, periodCompleteness: false });
  });
  it('detects changed metadata instead of equating an old fingerprint to current content', async () => {
    report = reportRecord({ recordCount: 1, fingerprint: 'b'.repeat(64) });
    expect(await validations().validateReport(validateParams)).toMatchObject({ isValid: false, fingerprintValid: false });
  });
  it('propagates reconciliation evidence-read failure before storing validation', async () => {
    const failure = new Error('findings unavailable'); reconciliation.listMismatches.mockRejectedValueOnce(failure);
    await expect(validations().validateReport(validateParams)).rejects.toBe(failure); expect(db.complianceReportValidation.create).not.toHaveBeenCalled();
  });
  it('does not advance report status when required validation persistence fails', async () => {
    const failure = new Error('validation store unavailable'); db.complianceReportValidation.create.mockRejectedValueOnce(failure);
    await expect(validations().validateReport(validateParams)).rejects.toBe(failure); expect(reports.updateValidationStatus).not.toHaveBeenCalled(); expect(reports.transitionState).not.toHaveBeenCalled();
  });
  it.each([{ errors: { invalid: 'not-array' } }, { errors: [{ field: 'source', message: 'bad', severity: 'UNRECOGNIZED' }] },
    { warnings: [{ field: 'source', message: 123 }] }])('rejects malformed stored validation JSON %j', async (overrides) => {
    storedValidation = validationRecord(overrides);
    await expect(validations().getValidation(TENANT, 'report-1')).rejects.toThrow('Malformed persisted validation');
  });
  it('rejects contradictory legacy PASSED flags instead of treating their label as proof', async () => {
    storedValidation = validationRecord({ periodCompleteness: false });
    await expect(validations().getValidation(TENANT, 'report-1')).rejects.toThrow('Inconsistent persisted validation');
  });
  it('does not read process memory when the durable validation row is absent', async () => {
    await validations().getValidation(TENANT, 'report-1'); storedValidation = null;
    await expect(validations().getValidation(TENANT, 'report-1')).resolves.toBeNull();
  });
  it('requires persisted complete validation before requesting certification', async () => {
    report = reportRecord({ state: ReportState.READY }); storedValidation = null;
    await expect(certifications().requestCertification(requestParams)).rejects.toThrow('Complete current persisted PASSED');
    expect(db.complianceReportCertification.create).not.toHaveBeenCalled();
  });
  it('does not advance READY when certification-request persistence fails', async () => {
    report = reportRecord({ state: ReportState.READY }); const failure = new Error('certification store unavailable'); db.complianceReportCertification.create.mockRejectedValueOnce(failure);
    await expect(certifications().requestCertification(requestParams)).rejects.toBe(failure); expect(reports.transitionState).not.toHaveBeenCalled();
  });
  it('requires the validation references and report references to be the same current set', async () => {
    report = reportRecord({ state: ReportState.READY }); storedValidation = validationRecord({ sourceReferencesChecked: ['Finance:different-reference'] });
    await expect(certifications().requestCertification(requestParams)).rejects.toThrow('Complete current persisted PASSED');
  });
  it('requires the active policy version even when legacy report and validation agree with an obsolete version', async () => {
    report = reportRecord({ state: ReportState.READY, policyVersion: 'obsolete-policy' }); storedValidation = validationRecord({ policyVersion: 'obsolete-policy' });
    await expect(certifications().requestCertification(requestParams)).rejects.toThrow('Report policy version is stale');
    expect(db.complianceReportCertification.create).not.toHaveBeenCalled();
  });
  it('does not accept self-certification even if a caller supplies an authorized role label', async () => {
    report = reportRecord({ state: ReportState.PENDING_CERTIFICATION, createdBy: 'reviewer-1' });
    await expect(certifications().certifyReport(certificationParams)).rejects.toThrow('independent reviewer'); expect(db.complianceReportCertification.update).not.toHaveBeenCalled();
  });
  it('does not use a different report certification or changed fingerprint', async () => {
    report = reportRecord({ state: ReportState.PENDING_CERTIFICATION }); certification = certificationRecord({ fingerprint: 'c'.repeat(64) });
    await expect(certifications().certifyReport(certificationParams)).rejects.toThrow('fingerprint/policy changed');
  });
  it('does not advance report certification when its native conditional decision write fails', async () => {
    report = reportRecord({ state: ReportState.PENDING_CERTIFICATION }); const failure = new Error('decision store unavailable'); db.complianceReportCertification.update.mockRejectedValueOnce(failure);
    await expect(certifications().certifyReport(certificationParams)).rejects.toBe(failure); expect(reports.updateCertificationStatus).not.toHaveBeenCalled(); expect(reports.transitionState).not.toHaveBeenCalled();
  });
  it('does not use an earlier certification result after a required native read fails', async () => {
    await certifications().getCertification(TENANT, 'certification-1'); const failure = new Error('certification read unavailable'); db.complianceReportCertification.findFirst.mockRejectedValueOnce(failure);
    await expect(certifications().getCertification(TENANT, 'certification-1')).rejects.toBe(failure);
  });
  it('does not queue delivery after a required duplicate-intent read fails', async () => {
    report = reportRecord({ state: ReportState.CERTIFIED, certificationStatus: CertificationState.APPROVED });
    const failure = new Error('delivery lookup unavailable'); db.complianceReportDelivery.findFirst.mockRejectedValueOnce(failure);
    await expect(deliveries().queueDelivery({ ...requestParams, channel: 'unit-channel', operatorId: 'operator-1' })).rejects.toBe(failure); expect(db.complianceReportDelivery.create).not.toHaveBeenCalled();
  });
  it('does not create a queue intent from certification status alone while the report is still DRAFT', async () => {
    report = reportRecord({ state: ReportState.DRAFT, certificationStatus: CertificationState.APPROVED });
    await expect(deliveries().queueDelivery({ ...requestParams, channel: 'unit-channel', operatorId: 'operator-1' })).rejects.toThrow(BadRequestException);
    expect(db.complianceReportDelivery.create).not.toHaveBeenCalled();
  });
  it('does not advance delivery/report statuses when the required queue write fails', async () => {
    report = reportRecord({ state: ReportState.CERTIFIED, certificationStatus: CertificationState.APPROVED }); delivery = null;
    const failure = new Error('queue store unavailable'); db.complianceReportDelivery.create.mockRejectedValueOnce(failure);
    await expect(deliveries().queueDelivery({ ...requestParams, channel: 'unit-channel', operatorId: 'operator-1' })).rejects.toBe(failure);
    expect(reports.transitionState).not.toHaveBeenCalled(); expect(reports.updateDeliveryStatus).not.toHaveBeenCalled();
  });
  it('does not turn caller evidence text into a submitted delivery or invented attempt', async () => {
    await expect(deliveries().submitDelivery(deliveryParams)).rejects.toThrow(ServiceUnavailableException);
    expect(db.complianceReportDelivery.update).not.toHaveBeenCalled(); expect(delivery).toMatchObject({ state: 'QUEUED', attemptCount: 0, lastAttemptAt: null });
  });
  it('does not acknowledge delivery without an authoritative acknowledgement adapter', async () => {
    delivery = deliveryRecord({ state: 'SUBMITTED', attemptCount: 1, lastAttemptAt: NOW, deliveryEvidence: 'unit-source-receipt' });
    await expect(deliveries().markDelivered(deliveryParams)).rejects.toThrow(ServiceUnavailableException);
    expect(db.complianceReportDelivery.update).not.toHaveBeenCalled(); expect(reports.updateDeliveryStatus).not.toHaveBeenCalled();
  });
  it('does not report delivery failure persisted when its conditional native write failed', async () => {
    const failure = new Error('failure store unavailable'); db.complianceReportDelivery.update.mockRejectedValueOnce(failure);
    await expect(deliveries().markFailed({ ...deliveryParams, failureReason: 'unit-failure' })).rejects.toBe(failure);
    expect(reports.updateDeliveryStatus).not.toHaveBeenCalled(); expect(audit.recordEvent).not.toHaveBeenCalled();
  });
  it('does not retry a delivered terminal record', async () => {
    delivery = deliveryRecord({ state: 'DELIVERED', deliveredAt: NOW, deliveryEvidence: 'unit-source-receipt' });
    await expect(deliveries().markRetryRequired({ ...deliveryParams, reason: 'unit-retry' })).rejects.toThrow('Only a failed delivery');
    expect(db.complianceReportDelivery.update).not.toHaveBeenCalled();
  });
  it('does not treat an empty native delivery list as permission to resurrect cached intents', async () => {
    await deliveries().getDelivery(TENANT, 'delivery-1');
    await expect(deliveries().listDeliveries(TENANT, 'report-1')).resolves.toEqual([]);
    expect(db.complianceReportDelivery.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, reportId: 'report-1' }, orderBy: { createdAt: 'desc' } });
  });
  it('rejects DELIVERED rows with missing acknowledgement evidence instead of coercing them into successful delivery', async () => {
    delivery = deliveryRecord({ state: 'DELIVERED', deliveredAt: NOW, deliveryEvidence: null });
    await expect(deliveries().getDelivery(TENANT, 'delivery-1')).rejects.toThrow('Malformed persisted delivery');
  });
});


function auditRecord(overrides: Partial<GovernanceAudit> = {}): GovernanceAudit {
  return { id: 'audit-1', tenantId: TENANT, actionType: GovernanceActionType.REPORT_GENERATE, subjectUserId: null, requestId: null, reportId: 'report-1',
    evidencePackageId: null, legalHoldId: null, retentionCandidateId: null, consentId: null, state: 'DRAFT', result: 'DRAFT_INTENT_PERSISTED', reason: null,
    correlationId: 'unit-correlation', createdBy: 'creator-1', createdAt: NOW, safeEvidence: {}, ...overrides };
}
describe('Required native governance audit durability and recursive safe evidence', () => {
  let module: TestingModule;
  const governanceAudit = { create: jest.fn<(args: Prisma.GovernanceAuditCreateArgs) => Promise<GovernanceAudit>>(),
    findMany: jest.fn<(args: Prisma.GovernanceAuditFindManyArgs) => Promise<GovernanceAudit[]>>() };
  const db = { governanceAudit, withTenantRls: async (_tenantId: string, work: (tx: { governanceAudit: typeof governanceAudit }) => Promise<unknown>) => work({ governanceAudit }) };
  const params = { tenantId: TENANT, actionType: GovernanceActionType.REPORT_GENERATE, state: 'DRAFT', result: 'DRAFT_INTENT_PERSISTED', correlationId: 'unit-correlation', createdBy: 'creator-1' };
  beforeEach(async () => {
    db.governanceAudit.create.mockReset().mockResolvedValue(auditRecord()); db.governanceAudit.findMany.mockReset().mockResolvedValue([]);
    module = await Test.createTestingModule({ providers: [GovernanceAuditService, GovernancePolicyService, { provide: ConfigService, useValue: new ConfigService({}) }, { provide: PrismaService, useValue: db }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<GovernanceAuditService>(GovernanceAuditService); }
  it('propagates native audit-write failure rather than retaining a success in memory', async () => {
    const failure = new Error('audit store unavailable'); db.governanceAudit.create.mockRejectedValueOnce(failure);
    await expect(service().recordEvent(params)).rejects.toBe(failure); await expect(service().listEvents(TENANT)).resolves.toEqual([]);
  });
  it('propagates required audit-read failure after a previously successful write', async () => {
    await service().recordEvent(params); const failure = new Error('audit read unavailable'); db.governanceAudit.findMany.mockRejectedValueOnce(failure);
    await expect(service().listEvents(TENANT)).rejects.toBe(failure);
  });
  it('never resurrects a written event when the authoritative native list is empty', async () => {
    await service().recordEvent(params); await expect(service().listEvents(TENANT)).resolves.toEqual([]);
  });
  it('recursively redacts nested PII and signing material before persistence', async () => {
    await service().recordEvent({ ...params, safeEvidence: { nested: { email: 'CANARY-mail', apiSecret: 'CANARY-key' }, items: [{ privateKey: 'CANARY-private', safe: 0 }] } });
    expect(db.governanceAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ safeEvidence: {
      nested: { email: '***REDACTED***', apiSecret: '***REDACTED***' }, items: [{ privateKey: '***REDACTED***', safe: 0 }] } }) });
  });
  it('does not expose unsafe legacy nested evidence on native audit reads', async () => {
    db.governanceAudit.findMany.mockResolvedValueOnce([auditRecord({ safeEvidence: { nested: { email: 'CANARY-legacy' } } })]);
    expect((await service().listEvents(TENANT))[0]?.safeEvidence).toEqual({ nested: { email: '***REDACTED***' } });
  });
  it('rejects circular audit evidence before calling the durable store', async () => {
    const evidence: Record<string, unknown> = {}; evidence.next = evidence;
    await expect(service().recordEvent({ ...params, safeEvidence: evidence })).rejects.toThrow('Circular audit evidence'); expect(db.governanceAudit.create).not.toHaveBeenCalled();
  });
  it.each([Number.NaN, new Date()])('rejects unsupported non-finite/non-JSON evidence %s without suppressing serialization failure', async (value) => {
    await expect(service().recordEvent({ ...params, safeEvidence: { value } })).rejects.toThrow(BadRequestException); expect(db.governanceAudit.create).not.toHaveBeenCalled();
  });
  it('binds the audit list to the tenant and preserves all records when no take is configured', async () => {
    await service().listEvents(TENANT, { actionType: GovernanceActionType.REPORT_GENERATE });
    expect(db.governanceAudit.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, actionType: GovernanceActionType.REPORT_GENERATE }, orderBy: { createdAt: 'desc' } });
  });
});


describe('Governance controller uses verified actor identity, not body attestation metadata', () => {
  let module: TestingModule;
  const actor: AuthenticatedActor = { userId: 'actor-1', tenantId: TENANT, sessionId: 'session-1', roles: ['COMPLIANCE'],
    permissions: [Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER], isPlatformUser: false, tokenId: 'unit-token-id' };
  const reportPort = { generateReport: jest.fn<ComplianceReportService['generateReport']>() };
  const certificationPort = { certifyReport: jest.fn<ComplianceReportCertificationService['certifyReport']>() };
  const deliveryPort = { getDelivery: jest.fn<ComplianceReportDeliveryService['getDelivery']>(), markFailed: jest.fn<ComplianceReportDeliveryService['markFailed']>() };
  const exportPort = { exportAuditTrail: jest.fn<GovernanceAuditExportService['exportAuditTrail']>() };
  const queryPort = { queryReports: jest.fn<GovernanceReportQueryService['queryReports']>() };
  const reportDto = { tenantId: TENANT, reportType: 'UNIT_REPORT', jurisdiction: 'US', periodStart: '2020-01-01T00:00:00.000Z', periodEnd: '2020-02-01T00:00:00.000Z', correlationId: 'unit-correlation', createdBy: 'actor-1' };
  beforeEach(async () => {
    reportPort.generateReport.mockReset().mockResolvedValue(reportRecord({ createdBy: 'actor-1' })); certificationPort.certifyReport.mockReset();
    deliveryPort.getDelivery.mockReset().mockResolvedValue({ ...deliveryRecord(), state: DeliveryState.QUEUED, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), lastAttemptAt: null, deliveredAt: null });
    deliveryPort.markFailed.mockReset(); exportPort.exportAuditTrail.mockReset(); queryPort.queryReports.mockReset();
    module = await Test.createTestingModule({ controllers: [GovernanceController], providers: [
      { provide: PrivacyRequestService, useValue: {} },
      { provide: PrivacyDiscoveryService, useValue: {} },
      { provide: PrivacyExportService, useValue: {} },
      { provide: PrivacyDeletionService, useValue: {} },
      { provide: RetentionPolicyService, useValue: {} },
      { provide: RetentionEngineService, useValue: {} },
      { provide: LegalHoldService, useValue: {} },
      { provide: ConsentService, useValue: {} },
      { provide: ComplianceReportService, useValue: reportPort },
      { provide: ComplianceReportTemplateService, useValue: {} },
      { provide: ComplianceReportValidationService, useValue: {} },
      { provide: ComplianceReportCertificationService, useValue: certificationPort },
      { provide: ComplianceReportDeliveryService, useValue: deliveryPort },
      { provide: EvidencePackageService, useValue: {} },
      { provide: GovernanceAuditExportService, useValue: exportPort },
      { provide: GovernanceReconciliationService, useValue: {} },
      { provide: GovernanceMetricsService, useValue: {} },
      { provide: GovernanceReportQueryService, useValue: queryPort },
      { provide: DataClassificationService, useValue: {} },
      { provide: DataInventoryService, useValue: {} },
      { provide: GovernancePolicyService, useValue: {} },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function controller() { return module.get<GovernanceController>(GovernanceController); }
  it('uses the verified userId for draft creation while preserving the supplied business inputs', async () => {
    await controller().generateReport(reportDto, actor);
    expect(reportPort.generateReport).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, createdBy: actor.userId }));
  });
  it('rejects a body createdBy override instead of laundering it into audit evidence', async () => {
    await expect(controller().generateReport({ ...reportDto, createdBy: 'different-user' }, actor)).rejects.toThrow(ForbiddenException);
    expect(reportPort.generateReport).not.toHaveBeenCalled();
  });
  it('does not allow a normal authenticated actor to claim another tenant even in a direct invocation', async () => {
    await expect(controller().generateReport({ ...reportDto, tenantId: OTHER_TENANT }, actor)).rejects.toThrow(ForbiddenException);
    expect(reportPort.generateReport).not.toHaveBeenCalled();
  });
  it('does not accept an AUDIT reviewerRole label from an actor who holds only COMPLIANCE', async () => {
    await expect(controller().certifyReport('report-1', 'certification-1', { tenantId: TENANT, reviewerId: actor.userId, reviewerRole: 'AUDIT', decision: 'APPROVED', correlationId: 'unit-correlation' }, actor)).rejects.toThrow(ForbiddenException);
    expect(certificationPort.certifyReport).not.toHaveBeenCalled();
  });
  it('forwards only a reviewer id/role bound to the authenticated principal', async () => {
    await controller().certifyReport('report-1', 'certification-1', { tenantId: TENANT, reviewerId: actor.userId, reviewerRole: 'compliance', decision: 'APPROVED', correlationId: 'unit-correlation' }, actor);
    expect(certificationPort.certifyReport).toHaveBeenCalledWith(expect.objectContaining({ reviewerId: actor.userId, reviewerRole: 'COMPLIANCE' }));
  });
  it('does not apply a delivery mutation through an unrelated report path', async () => {
    await expect(controller().markFailed('different-report', 'delivery-1', { tenantId: TENANT, operatorId: actor.userId, correlationId: 'unit-correlation', failureReason: 'unit-failure' }, actor)).rejects.toThrow('Delivery does not belong');
    expect(deliveryPort.markFailed).not.toHaveBeenCalled();
  });
  it('rejects an invalid report-state filter rather than hiding it behind an enum cast', async () => {
    await expect(controller().listReports({ tenantId: TENANT, state: 'UNRECOGNIZED' })).rejects.toThrow('Invalid report state');
    expect(queryPort.queryReports).not.toHaveBeenCalled();
  });
  it('rejects an invalid audit action filter before an export can broaden its scope', async () => {
    await expect(controller().exportAudit({ tenantId: TENANT, operatorId: actor.userId, correlationId: 'unit-correlation', periodStart: reportDto.periodStart, periodEnd: reportDto.periodEnd,
      filters: { actionType: 'UNRECOGNIZED' } }, actor)).rejects.toThrow('Invalid audit action type'); expect(exportPort.exportAuditTrail).not.toHaveBeenCalled();
  });
});
