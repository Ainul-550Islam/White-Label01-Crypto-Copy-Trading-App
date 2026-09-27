import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ComplianceReport, DeliveryState, ReportState, GovernanceActionType } from './governance.types';
import { ComplianceReportService } from './compliance-report.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DeliveryRecord {
  id: string;
  tenantId: string;
  reportId: string;
  channel: string;
  state: DeliveryState;
  attemptCount: number;
  lastAttemptAt?: string | null;
  deliveredAt?: string | null;
  deliveryEvidence?: string | null;
  failureReason?: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ComplianceReportDeliveryService {
  private readonly logger = new Logger(ComplianceReportDeliveryService.name);
  private readonly inMemory: Map<string, DeliveryRecord> = new Map();

  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async queueDelivery(params: {
    tenantId: string;
    reportId: string;
    channel: string;
    correlationId: string;
    operatorId: string;
  }): Promise<DeliveryRecord> {
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (report.state !== ReportState.CERTIFIED && report.state !== ReportState.QUEUED_FOR_DELIVERY && report.state !== ReportState.DELIVERY_FAILED) {
      throw new BadRequestException(`report must be CERTIFIED or DELIVERY_FAILED to queue delivery, current ${report.state}`);
    }
    if (report.certificationStatus !== 'APPROVED') throw new BadRequestException('report must be certified APPROVED before delivery');

    // Transition to QUEUED if not already
    if (report.state === ReportState.CERTIFIED) {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.QUEUED_FOR_DELIVERY,
        correlationId: params.correlationId,
        operatorId: params.operatorId,
      });
    }

    const record: DeliveryRecord = {
      id: `dlv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      reportId: report.id,
      channel: params.channel,
      state: DeliveryState.QUEUED,
      attemptCount: 0,
      lastAttemptAt: null,
      deliveredAt: null,
      deliveryEvidence: null,
      failureReason: null,
      correlationId: params.correlationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportDelivery?.create?.({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          reportId: record.reportId,
          channel: record.channel,
          state: record.state,
          attemptCount: record.attemptCount,
          correlationId: record.correlationId,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`delivery persist skipped id=${record.id}`);
    }

    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.QUEUED, params.correlationId);

    this.logger.log(`delivery queued id=${record.id} report=${report.id} channel=${params.channel} corr=${params.correlationId}`);
    return record;
  }

  async submitDelivery(params: {
    tenantId: string;
    deliveryId: string;
    correlationId: string;
    operatorId: string;
    deliveryEvidence: string;
  }): Promise<DeliveryRecord> {
    if (!params.deliveryEvidence) throw new BadRequestException('deliveryEvidence required - never mark submitted without evidence');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (record.state !== DeliveryState.QUEUED && record.state !== DeliveryState.RETRY_REQUIRED && record.state !== DeliveryState.FAILED) {
      throw new BadRequestException(`cannot submit from state ${record.state}`);
    }

    const report = await this.reportService.getReport(params.tenantId, record.reportId);
    if (report.state === ReportState.QUEUED_FOR_DELIVERY) {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.DELIVERING,
        correlationId: params.correlationId,
        operatorId: params.operatorId,
      });
    }

    record.state = DeliveryState.SUBMITTED;
    record.attemptCount += 1;
    record.lastAttemptAt = new Date().toISOString();
    record.deliveryEvidence = params.deliveryEvidence;
    record.updatedAt = new Date().toISOString();

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportDelivery?.update?.({
        where: { id: record.id },
        data: { state: record.state, attemptCount: record.attemptCount, lastAttemptAt: new Date(record.lastAttemptAt), deliveryEvidence: record.deliveryEvidence, updatedAt: new Date(record.updatedAt) },
      });
    } catch {
      this.logger.debug(`submit persist skipped id=${record.id}`);
    }

    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.SUBMITTED, params.correlationId);

    this.logger.log(`delivery submitted id=${record.id} corr=${params.correlationId}`);
    return record;
  }

  async markDelivered(params: {
    tenantId: string;
    deliveryId: string;
    correlationId: string;
    operatorId: string;
    deliveryEvidence: string;
  }): Promise<DeliveryRecord> {
    if (!params.deliveryEvidence) throw new BadRequestException('deliveryEvidence required - only real evidence = DELIVERED');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    if (record.state !== DeliveryState.SUBMITTED && record.state !== DeliveryState.QUEUED) {
      throw new BadRequestException(`cannot mark delivered from state ${record.state}`);
    }

    record.state = DeliveryState.DELIVERED;
    record.deliveredAt = new Date().toISOString();
    record.deliveryEvidence = params.deliveryEvidence;
    record.updatedAt = new Date().toISOString();

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportDelivery?.update?.({
        where: { id: record.id },
        data: { state: record.state, deliveredAt: new Date(record.deliveredAt), deliveryEvidence: record.deliveryEvidence, updatedAt: new Date(record.updatedAt) },
      });
    } catch {
      this.logger.debug(`delivered persist skipped id=${record.id}`);
    }

    const report = await this.reportService.getReport(params.tenantId, record.reportId);
    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.DELIVERED, params.correlationId);
    if (report.state === ReportState.DELIVERING) {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.DELIVERED,
        correlationId: params.correlationId,
        operatorId: params.operatorId,
      });
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_DELIVER,
      reportId: record.reportId,
      state: DeliveryState.DELIVERED,
      result: 'DELIVERED',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { deliveryId: record.id, channel: record.channel, deliveryEvidence: record.deliveryEvidence },
    });

    this.logger.log(`delivery delivered id=${record.id} corr=${params.correlationId}`);
    return record;
  }

  async markFailed(params: {
    tenantId: string;
    deliveryId: string;
    correlationId: string;
    operatorId: string;
    failureReason: string;
  }): Promise<DeliveryRecord> {
    if (!params.failureReason) throw new BadRequestException('failureReason required');
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    record.state = DeliveryState.FAILED;
    record.failureReason = params.failureReason;
    record.updatedAt = new Date().toISOString();
    record.lastAttemptAt = new Date().toISOString();

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportDelivery?.update?.({
        where: { id: record.id },
        data: { state: record.state, failureReason: record.failureReason, lastAttemptAt: new Date(record.lastAttemptAt), updatedAt: new Date(record.updatedAt) },
      });
    } catch {
      this.logger.debug(`failed persist skipped id=${record.id}`);
    }

    const report = await this.reportService.getReport(params.tenantId, record.reportId);
    await this.reportService.updateDeliveryStatus(params.tenantId, report.id, DeliveryState.FAILED, params.correlationId);
    try {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.DELIVERY_FAILED,
        correlationId: params.correlationId,
        operatorId: params.operatorId,
        reason: params.failureReason,
      });
    } catch {
      /* may already be in failed */
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_DELIVER,
      reportId: record.reportId,
      state: DeliveryState.FAILED,
      result: 'FAILED',
      reason: params.failureReason,
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { deliveryId: record.id, channel: record.channel },
    });

    this.logger.log(`delivery failed id=${record.id} reason=${params.failureReason} corr=${params.correlationId}`);
    return record;
  }

  async markRetryRequired(params: { tenantId: string; deliveryId: string; correlationId: string; operatorId: string; reason: string }): Promise<DeliveryRecord> {
    const record = await this.getDelivery(params.tenantId, params.deliveryId);
    record.state = DeliveryState.RETRY_REQUIRED;
    record.failureReason = params.reason;
    record.updatedAt = new Date().toISOString();
    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportDelivery?.update?.({
        where: { id: record.id },
        data: { state: record.state, failureReason: record.failureReason, updatedAt: new Date(record.updatedAt) },
      });
    } catch {
      this.logger.debug(`retry persist skipped id=${record.id}`);
    }
    return record;
  }

  async getDelivery(tenantId: string, deliveryId: string): Promise<DeliveryRecord> {
    const mem = this.inMemory.get(deliveryId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).complianceReportDelivery?.findUnique?.({ where: { id: deliveryId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        return this.mapRow(row);
      }
    } catch {
      /* ignore */
    }
    throw new BadRequestException(`delivery ${deliveryId} not found`);
  }

  async listDeliveries(tenantId: string, reportId?: string): Promise<DeliveryRecord[]> {
    let list = [...this.inMemory.values()].filter((d) => d.tenantId === tenantId);
    if (reportId) list = list.filter((d) => d.reportId === reportId);
    try {
      const where: any = { tenantId };
      if (reportId) where.reportId = reportId;
      const rows = await (this.prisma as any).complianceReportDelivery?.findMany?.({ where, take: 200, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  private mapRow(row: any): DeliveryRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      reportId: row.reportId,
      channel: row.channel,
      state: row.state,
      attemptCount: row.attemptCount ?? 0,
      lastAttemptAt: row.lastAttemptAt ? (row.lastAttemptAt instanceof Date ? row.lastAttemptAt.toISOString() : row.lastAttemptAt) : null,
      deliveredAt: row.deliveredAt ? (row.deliveredAt instanceof Date ? row.deliveredAt.toISOString() : row.deliveredAt) : null,
      deliveryEvidence: row.deliveryEvidence ?? null,
      failureReason: row.failureReason ?? null,
      correlationId: row.correlationId,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }
}
