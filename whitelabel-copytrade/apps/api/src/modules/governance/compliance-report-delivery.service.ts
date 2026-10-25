// # Responsibility: persist tenant-bound delivery intents/failures without memory fallback; caller text is not authoritative submission or delivery proof when the delivery-evidence adapter is absent.
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { type ComplianceReportDelivery, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DeliveryState, ReportState, GovernanceActionType } from './governance.types';
import { ComplianceReportService } from './compliance-report.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DeliveryRecord {
  id: string; tenantId: string; reportId: string; channel: string; state: DeliveryState; attemptCount: number;
  lastAttemptAt?: string | null; deliveredAt?: string | null; deliveryEvidence?: string | null; failureReason?: string | null;
  correlationId: string; createdAt: string; updatedAt: string;
}

@Injectable()
export class ComplianceReportDeliveryService {
  private readonly logger = new Logger(ComplianceReportDeliveryService.name);
  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async queueDelivery(params: { tenantId: string; reportId: string; channel: string; correlationId: string; operatorId: string }): Promise<DeliveryRecord> {
    if (!params.channel.trim()) throw new BadRequestException('Explicit delivery channel required');
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (![ReportState.CERTIFIED, ReportState.QUEUED_FOR_DELIVERY, ReportState.DELIVERY_FAILED].includes(report.state)
      || report.certificationStatus !== 'APPROVED') throw new BadRequestException('Approved certification and a queueable report state are required');
    const existing = await this.prisma.complianceReportDelivery.findFirst({ where: { tenantId: params.tenantId,
      reportId: report.id, channel: params.channel, state: DeliveryState.QUEUED } });
    if (existing) return this.mapRow(existing);
    const now = new Date();
    const row = await this.prisma.complianceReportDelivery.create({ data: { id: randomUUID(), tenantId: params.tenantId, reportId: report.id,
      channel: params.channel, state: DeliveryState.QUEUED, attemptCount: 0, correlationId: params.correlationId, createdAt: now, updatedAt: now } });
    if (report.state !== ReportState.QUEUED_FOR_DELIVERY) await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id,
      targetState: ReportState.QUEUED_FOR_DELIVERY, correlationId: params.correlationId, operatorId: params.operatorId });
    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.QUEUED, params.correlationId);
    this.logger.log(`Delivery intent queued id=${row.id} report=${report.id}`);
    return this.mapRow(row);
  }

  async submitDelivery(params: { tenantId: string; deliveryId: string; correlationId: string; operatorId: string; deliveryEvidence: string }): Promise<never> {
    if (!params.deliveryEvidence.trim()) throw new BadRequestException('Delivery evidence reference required');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (![DeliveryState.QUEUED, DeliveryState.RETRY_REQUIRED, DeliveryState.FAILED].includes(record.state)) throw new BadRequestException('Delivery is not in a submit-eligible state');
    await this.reportService.getReport(params.tenantId, record.reportId);
    throw new ServiceUnavailableException('Authoritative delivery submission/evidence adapter is not configured; caller text cannot prove submission');
  }

  async markDelivered(params: { tenantId: string; deliveryId: string; correlationId: string; operatorId: string; deliveryEvidence: string }): Promise<never> {
    if (!params.deliveryEvidence.trim()) throw new BadRequestException('Delivery evidence reference required');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (record.state !== DeliveryState.SUBMITTED) throw new BadRequestException('Only a submitted delivery can be acknowledged');
    await this.reportService.getReport(params.tenantId, record.reportId);
    throw new ServiceUnavailableException('Authoritative delivery acknowledgement adapter is not configured; caller text cannot prove DELIVERED');
  }

  async markFailed(params: { tenantId: string; deliveryId: string; correlationId: string; operatorId: string; failureReason: string }): Promise<DeliveryRecord> {
    if (!params.failureReason.trim()) throw new BadRequestException('Failure reason required');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (record.state === DeliveryState.DELIVERED || record.state === DeliveryState.NOT_DELIVERED) throw new BadRequestException('Delivery cannot be failed from this state');
    const report = await this.reportService.getReport(params.tenantId, record.reportId);
    const row = await this.prisma.complianceReportDelivery.update({ where: { id: record.id, tenantId: params.tenantId, state: record.state },
      data: { state: DeliveryState.FAILED, failureReason: params.failureReason, updatedAt: new Date() } });
    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.FAILED, params.correlationId);
    if (report.state === ReportState.DELIVERING) await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id,
      targetState: ReportState.DELIVERY_FAILED, correlationId: params.correlationId, operatorId: params.operatorId, reason: params.failureReason });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.REPORT_DELIVER, reportId: record.reportId,
      state: DeliveryState.FAILED, result: 'FAILED', reason: params.failureReason, correlationId: params.correlationId,
      createdBy: params.operatorId, safeEvidence: { deliveryId: record.id, channel: record.channel } });
    return this.mapRow(row);
  }

  async markRetryRequired(params: { tenantId: string; deliveryId: string; correlationId: string; operatorId: string; reason: string }): Promise<DeliveryRecord> {
    if (!params.reason.trim()) throw new BadRequestException('Retry reason required');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (record.state !== DeliveryState.FAILED) throw new BadRequestException('Only a failed delivery may require retry');
    const row = await this.prisma.complianceReportDelivery.update({ where: { id: record.id, tenantId: params.tenantId, state: DeliveryState.FAILED },
      data: { state: DeliveryState.RETRY_REQUIRED, failureReason: params.reason, updatedAt: new Date() } });
    return this.mapRow(row);
  }

  async getDelivery(tenantId: string, deliveryId: string): Promise<DeliveryRecord> {
    const row = await this.prisma.complianceReportDelivery.findFirst({ where: { id: deliveryId, tenantId } });
    if (!row) throw new BadRequestException('Delivery not found for tenant');
    this.policyService.assertTenantIsolation(tenantId, row.tenantId);
    return this.mapRow(row);
  }
  async listDeliveries(tenantId: string, reportId?: string): Promise<DeliveryRecord[]> {
    const where: Prisma.ComplianceReportDeliveryWhereInput = { tenantId, ...(reportId ? { reportId } : {}) };
    const rows = await this.prisma.complianceReportDelivery.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.mapRow(row));
  }
  private mapRow(row: ComplianceReportDelivery): DeliveryRecord {
    const state = Object.values(DeliveryState).find((value) => value === row.state);
    if (!state || !Number.isSafeInteger(row.attemptCount) || row.attemptCount < 0
      || (state === DeliveryState.DELIVERED && (!row.deliveredAt || !row.deliveryEvidence))) throw new Error('Malformed persisted delivery state/evidence');
    return { ...row, state, lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
