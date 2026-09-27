import { Injectable, Logger } from '@nestjs/common';
import { UsageEventRepository } from './usage-event.repository';
import { UsageMeterRepository } from './usage-meter.repository';
import { UsagePeriodService } from './usage-period.service';
import { QuotaSnapshotService } from './quota-snapshot.service';
import { MeterKey, UsageScope } from './usage-metering.types';

/**
 * Produces tenant/admin usage exports in safe structured formats using canonical metered data.
 * Safe fields only, no secrets, bounded pagination.
 */
@Injectable()
export class UsageExportService {
  private readonly logger = new Logger(UsageExportService.name);

  constructor(
    private readonly eventRepository: UsageEventRepository,
    private readonly meterRepository: UsageMeterRepository,
    private readonly periodService: UsagePeriodService,
    private readonly quotaService: QuotaSnapshotService,
  ) {}

  async exportUsageJson(params: {
    tenantId: string;
    format: 'json' | 'csv';
    fromDate?: Date;
    toDate?: Date;
    meterKeys?: MeterKey[];
    scope?: UsageScope;
    subjectId?: string;
    includeQuota?: boolean;
    includeOverage?: boolean;
    limit?: number;
  }): Promise<{ format: string; data: any; exportedAt: string; tenantId: string; recordCount: number }> {
    const limit = Math.min(params.limit || 1000, 10000); // Bounded

    let events: any[] = [];

    // Fetch events for each meter key or all
    if (params.meterKeys && params.meterKeys.length > 0) {
      for (const meterKey of params.meterKeys) {
        const meterEvents = await this.eventRepository.listByTenant(params.tenantId, {
          meterKey,
          scope: params.scope,
          subjectId: params.subjectId,
          fromDate: params.fromDate,
          toDate: params.toDate,
          limit,
        });
        events = events.concat(meterEvents);
      }
    } else {
      events = await this.eventRepository.listByTenant(params.tenantId, {
        scope: params.scope,
        subjectId: params.subjectId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        limit,
      });
    }

    // Sort deterministically by timestamp
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Build safe export records
    const safeRecords = events.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      meterKey: e.meterKey,
      scope: e.scope,
      subjectId: e.subjectId || null,
      resourceId: e.resourceId || null,
      quantity: e.quantity,
      unit: e.unit,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      periodId: e.periodId,
      periodType: e.periodType,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      timestamp: e.timestamp,
      processingState: e.processingState,
      dimensions: this.sanitizeDimensions(e.dimensions),
      createdAt: e.createdAt,
    }));

    let quotaSnapshots: any[] = [];
    if (params.includeQuota) {
      try {
        quotaSnapshots = await this.quotaService.getTenantQuotaOverview(params.tenantId);
        // Sanitize quota snapshots to safe fields
        quotaSnapshots = quotaSnapshots.map((q) => ({
          meterKey: q.meterKey,
          limitKey: q.limitKey,
          scope: q.scope,
          subjectId: q.subjectId || null,
          maximum: q.maximum,
          current: q.current,
          remaining: q.remaining,
          utilizationPercent: q.utilizationPercent,
          status: q.status,
          periodId: q.periodId,
          periodStart: q.periodStart,
          periodEnd: q.periodEnd,
          isEnforced: q.isEnforced,
        }));
      } catch {}
    }

    const exportData = {
      tenantId: params.tenantId,
      exportedAt: new Date().toISOString(),
      period: {
        from: params.fromDate ? params.fromDate.toISOString() : null,
        to: params.toDate ? params.toDate.toISOString() : null,
      },
      filters: {
        meterKeys: params.meterKeys || null,
        scope: params.scope || null,
        subjectId: params.subjectId || null,
      },
      summary: {
        totalEvents: safeRecords.length,
        totalQuantity: safeRecords.reduce((sum, r) => sum + (r.quantity || 0), 0),
        meterBreakdown: this.buildMeterBreakdown(safeRecords),
      },
      events: safeRecords,
      quotaSnapshots: params.includeQuota ? quotaSnapshots : undefined,
    };

    this.logger.log(`Usage export tenant=${params.tenantId} format=${params.format} records=${safeRecords.length}`);

    return {
      format: params.format,
      data: exportData,
      exportedAt: new Date().toISOString(),
      tenantId: params.tenantId,
      recordCount: safeRecords.length,
    };
  }

  async exportUsageCsv(params: {
    tenantId: string;
    fromDate?: Date;
    toDate?: Date;
    meterKeys?: MeterKey[];
    scope?: UsageScope;
    subjectId?: string;
    limit?: number;
  }): Promise<{ format: 'csv'; csv: string; exportedAt: string; tenantId: string; recordCount: number }> {
    const jsonExport = await this.exportUsageJson({
      tenantId: params.tenantId,
      format: 'json',
      fromDate: params.fromDate,
      toDate: params.toDate,
      meterKeys: params.meterKeys,
      scope: params.scope,
      subjectId: params.subjectId,
      limit: params.limit,
    });

    const headers = ['id', 'meterKey', 'scope', 'subjectId', 'quantity', 'unit', 'sourceType', 'sourceId', 'periodId', 'timestamp'];
    const rows = [headers.join(',')];

    for (const event of jsonExport.data.events) {
      const row = [
        event.id,
        event.meterKey,
        event.scope,
        event.subjectId || '',
        event.quantity,
        event.unit,
        event.sourceType,
        event.sourceId,
        event.periodId,
        event.timestamp,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
      rows.push(row);
    }

    const csv = rows.join('\n');

    return {
      format: 'csv',
      csv,
      exportedAt: new Date().toISOString(),
      tenantId: params.tenantId,
      recordCount: jsonExport.recordCount,
    };
  }

  async getExportStatus(exportId: string, tenantId: string): Promise<{ id: string; status: string; tenantId: string; createdAt: string }> {
    // In real implementation, would check persisted export job
    // For now, return synthetic status
    return {
      id: exportId,
      status: 'COMPLETED',
      tenantId,
      createdAt: new Date().toISOString(),
    };
  }

  private buildMeterBreakdown(records: any[]): Record<string, { count: number; totalQuantity: number }> {
    const breakdown: Record<string, { count: number; totalQuantity: number }> = {};
    for (const r of records) {
      if (!breakdown[r.meterKey]) {
        breakdown[r.meterKey] = { count: 0, totalQuantity: 0 };
      }
      breakdown[r.meterKey].count += 1;
      breakdown[r.meterKey].totalQuantity += r.quantity || 0;
    }
    return breakdown;
  }

  private sanitizeDimensions(dimensions: any): any {
    if (!dimensions) return null;
    const forbidden = ['secret', 'apiKey', 'privateKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret', 'credentials', 'apiSecret'];
    const safe: any = {};
    for (const [key, value] of Object.entries(dimensions)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }
}
