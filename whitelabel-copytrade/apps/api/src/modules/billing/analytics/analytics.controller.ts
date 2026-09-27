import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/current-tenant.decorator';
import { Permission, AuthenticatedActor } from '@wlct/shared-types';
import { RevenueAnalyticsService } from './revenue-analytics.service';
import { MrrCalculationService } from './mrr-calculation.service';
import { ArrCalculationService } from './arr-calculation.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';
import { ChurnAnalyticsService } from './churn-analytics.service';
import { CashflowAnalyticsService } from './cashflow-analytics.service';
import { BillingHealthService } from './billing-health.service';
import { CustomerValueService } from './customer-value.service';
import { PlanPerformanceService } from './plan-performance.service';
import { RevenueCohortService } from './revenue-cohort.service';
import { RevenueRecognitionService } from './revenue-recognition.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import {
  RevenueQueryDto,
  MrrQueryDto,
  ArrQueryDto,
  CashflowQueryDto,
  BillingHealthQueryDto,
  CohortQueryDto,
  ReconciliationQueryDto,
  PlanPerformanceQueryDto,
  CustomerAnalyticsQueryDto,
} from './dto/revenue-query.dto';
import { ReportingPeriod, ReportingPeriodType, CohortDefinition } from './revenue-analytics.types';

/**
 * RBAC-protected read-only analytics API for SaaS admins, tenants, and authorized finance users using existing billing data.
 * No mutation endpoints, tenant isolation enforced, platform analytics respect RBAC.
 */
@ApiTags('Billing - Analytics')
@ApiBearerAuth()
@Controller({ path: 'billing/analytics', version: '1' })
export class AnalyticsController {
  constructor(
    private readonly revenueService: RevenueAnalyticsService,
    private readonly mrrService: MrrCalculationService,
    private readonly arrService: ArrCalculationService,
    private readonly subscriptionService: SubscriptionAnalyticsService,
    private readonly churnService: ChurnAnalyticsService,
    private readonly cashflowService: CashflowAnalyticsService,
    private readonly billingHealthService: BillingHealthService,
    private readonly customerValueService: CustomerValueService,
    private readonly planPerformanceService: PlanPerformanceService,
    private readonly cohortService: RevenueCohortService,
    private readonly recognitionService: RevenueRecognitionService,
    private readonly reconciliationService: AnalyticsReconciliationService,
    private readonly cacheService: AnalyticsCacheService,
  ) {}

  private buildPeriod(query: any): ReportingPeriod {
    const now = new Date();
    const startDate = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = query.endDate ? new Date(query.endDate) : now;
    const type = query.periodType || ReportingPeriodType.MONTH;
    const timezone = query.timezone || 'UTC';

    return {
      type,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      timezone,
      label: `${type} ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)} (${timezone})`,
    };
  }

  private resolveTenantScope(actor: AuthenticatedActor, queryTenantId?: string): string | undefined {
    // Platform admin can query any tenant or platform aggregate
    if (actor.isPlatformUser) {
      return queryTenantId; // undefined = platform aggregate
    }
    // Tenant user: only own tenant
    return actor.tenantId || undefined;
  }

  private isPlatformAdmin(actor: AuthenticatedActor): boolean {
    return !!actor.isPlatformUser;
  }

  // Revenue overview
  @Get('revenue/overview')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get revenue overview - tenant isolated, platform aggregate for admins' })
  async getRevenueOverview(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);

    let comparisonPeriod: ReportingPeriod | undefined;
    if (query.includeComparison) {
      const compStart = query.comparisonStartDate ? new Date(query.comparisonStartDate) : new Date(new Date(period.startDate).getTime() - (new Date(period.endDate).getTime() - new Date(period.startDate).getTime()));
      const compEnd = query.comparisonEndDate ? new Date(query.comparisonEndDate) : new Date(period.startDate);
      comparisonPeriod = {
        type: period.type,
        startDate: compStart.toISOString(),
        endDate: compEnd.toISOString(),
        timezone: period.timezone,
        label: `Comparison ${compStart.toISOString().slice(0, 10)} to ${compEnd.toISOString().slice(0, 10)}`,
      };
    }

    return this.revenueService.getRevenueOverview({
      tenantId,
      currency: query.currency,
      period,
      comparisonPeriod,
    });
  }

  @Get('revenue/snapshot')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get revenue snapshot for period' })
  async getRevenueSnapshot(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.revenueService.calculateRevenueSnapshot({
      tenantId,
      currency: query.currency || 'USD',
      period,
    });
  }

  // MRR
  @Get('mrr')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get MRR - deterministic from active recurring subscriptions' })
  async getMrr(@CurrentUser() actor: AuthenticatedActor, @Query() query: MrrQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;

    const result = await this.mrrService.calculateMrr({
      tenantId,
      currency: query.currency,
      asOfDate,
      includeTrials: query.includeTrials,
      includeLifetimeAsRecurring: query.includeLifetimeAsRecurring,
    });

    return {
      data: result,
      methodology: 'MONTHLY=price, QUARTERLY=price/3, YEARLY=price/12, LIFETIME excluded unless policy says recurring. Decimal-safe.',
      calculatedAt: new Date().toISOString(),
    };
  }

  @Get('mrr/tenant')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get MRR for current tenant' })
  async getTenantMrr(@TenantId() tenantId: string, @Query() query: MrrQueryDto) {
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;
    return this.mrrService.calculateMrrForTenant(tenantId, query.currency, asOfDate);
  }

  // ARR
  @Get('arr')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get ARR - MONTHLY×12, QUARTERLY×4, YEARLY×1' })
  async getArr(@CurrentUser() actor: AuthenticatedActor, @Query() query: ArrQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;

    const result = await this.arrService.calculateArr({
      tenantId,
      currency: query.currency,
      asOfDate,
      includeTrials: query.includeTrials,
      includeLifetimeAsRecurring: query.includeLifetimeAsRecurring,
    });

    return {
      data: result,
      methodology: 'MONTHLY×12, QUARTERLY×4, YEARLY×1, LIFETIME excluded unless configured. Decimal-safe.',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Subscription analytics
  @Get('subscriptions/kpis')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get subscription KPIs: active/trial/cancelled/expired, upgrades, downgrades, renewals, plan/interval distribution' })
  async getSubscriptionKpis(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.subscriptionService.calculateSubscriptionKpis({ tenantId, period });
  }

  @Get('subscriptions/plan-distribution')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get plan distribution from canonical catalog' })
  async getPlanDistribution(@CurrentUser() actor: AuthenticatedActor, @Query() query: MrrQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;
    return this.subscriptionService.getPlanDistribution({ tenantId, asOfDate });
  }

  @Get('subscriptions/interval-distribution')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get interval distribution' })
  async getIntervalDistribution(@CurrentUser() actor: AuthenticatedActor, @Query() query: MrrQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;
    return this.subscriptionService.getIntervalDistribution({ tenantId, asOfDate });
  }

  // Churn
  @Get('churn')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get churn metrics: customer/subscription churn, voluntary, failed-payment, expiration, logo, revenue churn' })
  async getChurn(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.churnService.calculateChurn({ tenantId, currency: query.currency, period });
  }

  @Get('retention')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get retention metrics' })
  async getRetention(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.churnService.calculateRetention({ tenantId, period });
  }

  // Plan performance
  @Get('plans/performance')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get plan performance - platform admin only, canonical plan catalog' })
  async getPlanPerformance(@CurrentUser() actor: AuthenticatedActor, @Query() query: PlanPerformanceQueryDto) {
    const period = this.buildPeriod(query);
    return this.planPerformanceService.calculatePlanPerformance({
      currency: query.currency,
      period,
      planId: query.planId,
    });
  }

  @Get('plans/top')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get top plans by revenue' })
  async getTopPlans(@CurrentUser() actor: AuthenticatedActor, @Query() query: PlanPerformanceQueryDto) {
    const period = this.buildPeriod(query);
    return this.planPerformanceService.getTopPlansByRevenue({
      currency: query.currency,
      period,
      limit: query.limit,
    });
  }

  // Cohort
  @Get('cohorts')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get cohort analysis - explicit definition' })
  async getCohorts(@CurrentUser() actor: AuthenticatedActor, @Query() query: CohortQueryDto) {
    const period = this.buildPeriod(query);
    return this.cohortService.calculateCohorts({
      currency: query.currency,
      definition: query.cohortDefinition || CohortDefinition.FIRST_SUBSCRIPTION_MONTH,
      period,
      retentionPeriods: query.retentionPeriods,
    });
  }

  // Billing health
  @Get('billing/health')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get billing health: success rate, failure rate, overdue, dunning, refund rate' })
  async getBillingHealth(@CurrentUser() actor: AuthenticatedActor, @Query() query: BillingHealthQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.billingHealthService.calculateBillingHealth({
      tenantId,
      currency: query.currency,
      period,
    });
  }

  // Cashflow
  @Get('cashflow')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get cashflow: collected cash, refunds, net cash, outstanding, dunning exposure - payment evidence only' })
  async getCashflow(@CurrentUser() actor: AuthenticatedActor, @Query() query: CashflowQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.cashflowService.calculateCashflow({
      tenantId,
      currency: query.currency,
      period,
    });
  }

  @Get('cashflow/outstanding')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get outstanding receivables' })
  async getOutstanding(@CurrentUser() actor: AuthenticatedActor, @Query() query: BillingHealthQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    return this.cashflowService.calculateOutstanding({
      tenantId,
      currency: query.currency,
    });
  }

  // Customer analytics
  @Get('customers/value')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get customer value - tenant isolated, no cross-tenant leakage' })
  async getCustomerValue(@TenantId() tenantId: string, @CurrentUser() actor: AuthenticatedActor, @Query() query: CustomerAnalyticsQueryDto) {
    const effectiveTenantId = this.resolveTenantScope(actor, query.tenantId) || tenantId;
    const period = this.buildPeriod(query);
    return this.customerValueService.calculateCustomerValue({
      tenantId: effectiveTenantId,
      currency: query.currency,
      period,
    });
  }

  @Get('customers/arpu')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get ARPU - average revenue per account' })
  async getArpu(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const period = this.buildPeriod(query);
    return this.customerValueService.calculateArpu({
      currency: query.currency,
      period,
    });
  }

  @Get('customers/top')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get top customers by revenue - platform admin only' })
  async getTopCustomers(@Query() query: CustomerAnalyticsQueryDto) {
    const period = this.buildPeriod(query);
    return this.customerValueService.listTopCustomers({
      currency: query.currency,
      period,
      limit: query.limit,
    });
  }

  // Revenue recognition
  @Get('recognition')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get revenue recognition analysis - read-only, no ledger mutation' })
  async getRecognition(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    return this.recognitionService.analyzeRecognition({
      tenantId,
      currency: query.currency,
      period,
    });
  }

  @Get('recognition/deferred')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get deferred revenue' })
  async getDeferred(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    return this.recognitionService.getDeferredRevenue({
      tenantId,
      currency: query.currency,
    });
  }

  // Financial reports
  @Get('reports/financial')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get financial report: gross/net/recurring/cash/refunds/taxes/fees/receivables/MRR/ARR' })
  async getFinancialReport(@CurrentUser() actor: AuthenticatedActor, @Query() query: RevenueQueryDto) {
    const tenantId = this.resolveTenantScope(actor, query.tenantId);
    const period = this.buildPeriod(query);
    const snapshot = await this.revenueService.calculateRevenueSnapshot({
      tenantId,
      currency: query.currency || 'USD',
      period,
    });

    // Build financial report from snapshot
    return {
      period: snapshot.period,
      currency: snapshot.currency,
      grossRevenue: snapshot.grossRevenue,
      netRevenue: snapshot.netRevenue,
      recurringRevenue: snapshot.recurringRevenue,
      oneTimeRevenue: snapshot.oneTimeRevenue,
      cashCollected: snapshot.cashCollected,
      refunds: snapshot.refunds,
      taxes: snapshot.taxes,
      fees: snapshot.fees,
      platformFees: snapshot.platformFees,
      performanceFees: snapshot.performanceFees,
      receivables: snapshot.receivables,
      outstanding: snapshot.outstandingAmount,
      mrr: snapshot.mrr,
      arr: snapshot.arr,
      arpu: snapshot.arpu,
      customerCount: snapshot.customerCount,
      activeSubscriptions: snapshot.activeSubscriptionCount,
      sourceReferences: {
        invoiceIds: [],
        paymentIds: [],
        refundIds: [],
        subscriptionIds: [],
      },
      methodology: 'Derived from canonical invoices, payments, refunds, fees, subscriptions. Gross = finalized/paid invoices total. Net = gross - refunds. Recurring = MRR * months. Cash = amountPaid. Fees distinct. Taxes distinct. No hardcoded prices.',
      calculatedAt: snapshot.calculatedAt,
    };
  }

  // Reconciliation
  @Get('reconciliation')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get analytics reconciliation - detects drift between analytics and source records' })
  async getReconciliation(@CurrentUser() actor: AuthenticatedActor, @Query() query: ReconciliationQueryDto) {
    const tenantId = query.tenantId; // Platform admin can check any tenant
    const period = this.buildPeriod(query);
    return this.reconciliationService.reconcile({
      tenantId,
      currency: query.currency,
      period,
    });
  }

  // Cache management - platform admin
  @Get('cache/invalidate')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Invalidate analytics cache - platform admin' })
  async invalidateCache(@Query('scope') scope?: string, @Query('metric') metric?: string) {
    if (scope) {
      const deleted = await this.cacheService.invalidateScope(scope);
      return { deleted, scope, message: `Invalidated ${deleted} keys for scope ${scope}` };
    }
    if (metric) {
      const deleted = await this.cacheService.invalidateMetric(metric);
      return { deleted, metric, message: `Invalidated ${deleted} keys for metric ${metric}` };
    }
    const deleted = await this.cacheService.invalidateAll();
    return { deleted, message: `Invalidated ${deleted} analytics cache keys (all)` };
  }

  // Health check for analytics engine
  @Get('health')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Analytics engine health check' })
  async getHealth() {
    return {
      status: 'OK',
      engine: 'Read-only SaaS Revenue Analytics',
      sources: ['TenantSubscription', 'SubscriptionPlan', 'Invoice', 'Payment', 'Refund', 'BillingLedger', 'FeeAccrual', 'FeeSettlement', 'UsageMeter'],
      guarantees: [
        'No mutation of billing state',
        'Decimal-safe arithmetic',
        'Tenant isolation',
        'Currency buckets separated',
        'Cache never source of truth',
        'No hardcoded plan prices',
      ],
      calculatedAt: new Date().toISOString(),
    };
  }
}
