import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { EnforcementModule } from '../enforcement/enforcement.module';
import { FinanceModule } from '../finance/finance.module';
import { FeesModule } from '../fees/fees.module';
import { BillingNotificationsModule } from '../notifications/notifications.module';

// Repositories
import { UsageMeterRepository } from './usage-meter.repository';
import { UsageEventRepository } from './usage-event.repository';
import { OverageRepository } from './overage.repository';

// Core services
import { UsagePeriodService } from './usage-period.service';
import { UsageMeterService } from './usage-meter.service';
import { UsageEventService } from './usage-event.service';
import { UsageAggregationService } from './usage-aggregation.service';
import { QuotaSnapshotService } from './quota-snapshot.service';

// Overage
import { OverageService } from './overage.service';

// Alerts
import { UsageAlertService } from './usage-alert.service';

// Export, Analytics, Reconciliation
import { UsageExportService } from './usage-export.service';
import { UsageAnalyticsService } from './usage-analytics.service';
import { UsageReconciliationService } from './usage-reconciliation.service';

/**
 * Durable SaaS Usage Metering, Aggregation, Overage Tracking, Quota Analytics,
 * Usage Events, Commercial Usage Foundation.
 *
 * Architecture:
 * Runtime Enforcement (Part 2) → Successful Business Event → Durable Usage Event
 * → Meter → Period Aggregate → Quota Snapshot → Analytics → Alert → Optional Overage → Reconciliation
 *
 * Part 8 enhances Part 2, not replaces it. Enforcement remains authoritative for ALLOW/DENY.
 * This module adds durable history, period aggregation, utilization, trends, threshold monitoring,
 * future overage readiness, reconciliation.
 *
 * No duplicate quota source, no hardcoded limits, no invented overage pricing,
 * tenant-scoped, concurrency-safe, idempotent.
 */
@Module({
  imports: [PrismaModule, EnforcementModule, FinanceModule, forwardRef(() => FeesModule), forwardRef(() => BillingNotificationsModule)],
  providers: [
    // Repositories
    UsageMeterRepository,
    UsageEventRepository,
    OverageRepository,

    // Period
    UsagePeriodService,

    // Metering
    UsageMeterService,
    UsageEventService,
    UsageAggregationService,
    QuotaSnapshotService,

    // Overage
    OverageService,

    // Alerts
    UsageAlertService,

    // Export, Analytics, Reconciliation
    UsageExportService,
    UsageAnalyticsService,
    UsageReconciliationService,
  ],
  exports: [
    UsageMeterService,
    UsageEventService,
    UsageAggregationService,
    UsagePeriodService,
    QuotaSnapshotService,
    OverageService,
    OverageRepository,
    UsageAlertService,
    UsageExportService,
    UsageAnalyticsService,
    UsageReconciliationService,
    UsageMeterRepository,
    UsageEventRepository,
  ],
})
export class UsageModule {}
