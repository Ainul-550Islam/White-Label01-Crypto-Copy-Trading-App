// # Responsibility: prove canonical API compatibility and tenant-safe typed analytics without treating source failures as successful evidence.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  EnvironmentName,
  ReleaseManifestService as SharedReleaseManifestService,
  type BuildInputs,
} from '@wlct/utils';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX } from '../modules/exchanges/exchange.types';
import { resolveCanonicalVenueCapabilities } from '../modules/exchanges/providers/exchange-provider.interface';
import { OrderIntentService as CanonicalOrderIntentService } from '../modules/oms/order-intent.service';
import {
  OrderIntentService,
  RiskService,
  validateOrderIntentPreTrade,
  type PreTradeOrderRuleInput,
  type PreTradeOrderRuleResult,
} from '../modules/orders/order-intent.service';
import {
  ReleaseManifestService,
  summarizeReleaseManifestForOpsConsole,
} from '../modules/ops/production/release-manifest.service';
import {
  StripePaymentAdapter,
  NowPaymentsAdapter,
} from '../modules/providers/adapters/payment/payment.adapter';
import { StripeProductionAdapter } from '../modules/providers/adapters/payment/stripe.adapter';
import { NowPaymentsProductionAdapter } from '../modules/providers/adapters/payment/nowpayments.adapter';
import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  Prisma,
  type CompliancePolicyRecord,
  type ComplianceScreeningRequest,
  type ComplianceCase,
  type RiskScoreRecord,
  type KycProfile,
  type Tenant,
  type TraderProfile,
  type TraderStrategy,
  type BillingLedgerEntry,
  type ClientProfile,
  type InstitutionalAccount,
  type AccountRestriction,
  type AccountOwnership,
  type AccountRelationship,
  type FundingRequest,
  type DunningCase,
  type FeeAccrual as PersistedFeeAccrual,
  type FeeSettlement,
  type Invoice,
  type Payment,
  type Refund,
  type SubscriptionPlan,
  type UsageMeter,
} from '@prisma/client';
import { Permission, SubscriptionStatus, type AuthenticatedActor } from '@wlct/shared-types';
import { InMemoryPrisma, rowMatches } from './__fixtures__/in-memory-prisma.fixture-spec';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CacheService } from '../infrastructure/redis/cache.service';
import { AnalyticsController } from '../modules/billing/analytics/analytics.controller';
import { AnalyticsCacheService } from '../modules/billing/analytics/analytics-cache.service';
import { AnalyticsReconciliationService } from '../modules/billing/analytics/analytics-reconciliation.service';
import { ArrCalculationService } from '../modules/billing/analytics/arr-calculation.service';
import { BillingHealthService } from '../modules/billing/analytics/billing-health.service';
import { CashflowAnalyticsService } from '../modules/billing/analytics/cashflow-analytics.service';
import { ChurnAnalyticsService } from '../modules/billing/analytics/churn-analytics.service';
import { CustomerValueService } from '../modules/billing/analytics/customer-value.service';
import { MrrCalculationService } from '../modules/billing/analytics/mrr-calculation.service';
import { PlanPerformanceService } from '../modules/billing/analytics/plan-performance.service';
import { RevenueAnalyticsService } from '../modules/billing/analytics/revenue-analytics.service';
import { RevenueCohortService } from '../modules/billing/analytics/revenue-cohort.service';
import { RevenueRecognitionService } from '../modules/billing/analytics/revenue-recognition.service';
import { SubscriptionAnalyticsService } from '../modules/billing/analytics/subscription-analytics.service';
import {
  BillingInterval,
  CohortDefinition,
  ReportingPeriodType,
  type MrrBreakdown,
  type ReportingPeriod,
} from '../modules/billing/analytics/revenue-analytics.types';
import { RevenueQueryDto } from '../modules/billing/analytics/dto/revenue-query.dto';
import { AccountAdministrationService } from '../modules/client-lifecycle/account-administration.service';
import { AccountOwnershipService } from '../modules/client-lifecycle/account-ownership.service';
import { AccountRestrictionService } from '../modules/client-lifecycle/account-restriction.service';
import { ClientProfileRepository } from '../modules/client-lifecycle/client-profile.repository';
import { ClientPolicyService } from '../modules/client-lifecycle/client-policy.service';
import { RelationshipService } from '../modules/client-lifecycle/relationship.service';
import { FundingRequestService } from '../modules/client-lifecycle/funding-request.service';
import { LifecycleAuditService } from '../modules/client-lifecycle/lifecycle-audit.service';
import { AppConfigService } from '../config/app-config.service';
import { TenantFeatureAccessService } from '../modules/billing/saas-admin/tenant-feature-access.service';
import { SaasAdminAuditService } from '../modules/billing/saas-admin/saas-admin-audit.service';
import { EnforcementContextBuilder } from '../modules/billing/enforcement/enforcement.context';
import { EnforcementService } from '../modules/billing/enforcement/enforcement.service';
import { EnforcementDecisionCode, type TenantBillingContext, type EnforcementActor, type EnforcementContext } from '../modules/billing/enforcement/enforcement.types';
import { BillingUsageSummaryService } from '../modules/billing/portal/billing-usage-summary.service';
import { SubscriptionsService } from '../modules/billing/subscriptions.service';

import { OutboxService } from '../infrastructure/outbox/outbox.service';
import {
  AccountOwnershipType, AccountRelationshipType, AccountRestrictionType,
  FundingRequestState, lifecycleEnum, lifecycleMetadata,
} from '../modules/client-lifecycle/client-lifecycle.types';



import { CompliancePolicyService, complianceJsonInput } from '../modules/compliance/compliance-policy.service';
import { AmlScreeningService } from '../modules/compliance/aml-screening.service';
import { AmlProviderFactory } from '../modules/compliance/aml-provider.factory';
import { type IAmlProvider } from '../modules/compliance/aml-provider.interface';
import { ComplianceAuditService } from '../modules/compliance/compliance-audit.service';
import { ComplianceCaseRepository } from '../modules/compliance/compliance-case.repository';
import { RiskScoringService } from '../modules/compliance/risk-scoring.service';
import { KycProviderFactory } from '../modules/compliance/kyc-provider.factory';
import { AmlState, ComplianceDecision, RiskLevel, KycState, sanitizeMetadata, type AmlScreeningResult } from '../modules/compliance/compliance.types';
import { StrategyValidationService, type StrategyValidationInput } from '../modules/copy-trading/strategy-validation.service';
import { TraderStrategyType } from '../modules/copy-trading/copy-trading.types';
import { ExchangeRegistryService } from '../modules/exchanges/exchange-registry.service';

const buildInputs: BuildInputs = {
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  branch: 'main',
  backendPackageVersion: '1.0.0',
  frontendWebVersion: '1.0.0',
  adminWebVersion: '1.0.0',
  imageName: 'wlct-api',
  imageDigest: `sha256:${'a'.repeat(64)}`,
  imageTag: 'release-test',
  prismaVersion: '5.22.0',
  migrationId: '20261010_current',
  migrationHistory: ['20261010_current', '20261009_previous'],
  schemaHash: 'b'.repeat(64),
  backendBuildId: 'backend-build',
  frontendWebBuildId: 'web-build',
  adminBuildId: 'admin-build',
  nodeVersion: '22.23.3',
  npmVersion: '10.8.2',
  builtBy: 'unit-test',
  environment: EnvironmentName.PRODUCTION,
  correlationId: '11111111-1111-4111-8111-111111111111',
  buildDurationMs: 1000,
};

describe('API compatibility contracts', () => {
  it('exports the actual canonical OMS order-intent implementation', () => {
    expect(OrderIntentService).toBe(CanonicalOrderIntentService);
  });

  it('preserves the canonical pre-trade denial and exact decimal evidence', () => {
    const input: PreTradeOrderRuleInput = {
      quantity: '2.00000000',
      price: '100.00000000',
      availableBalance: '10.00000000',
      leverage: '1',
    };
    const canonical: PreTradeOrderRuleResult = new RiskService().evaluatePreTradeOrderRules(input);
    expect(canonical.allowed).toBe(false);
    expect(validateOrderIntentPreTrade(input)).toEqual({
      allowed: canonical.allowed,
      computedNotional: canonical.computedNotional,
      requiredMargin: canonical.requiredMargin,
      rejectionReasons: canonical.reasons,
    });
  });

  it('preserves the exchange quantity-step rejection', () => {
    const result = validateOrderIntentPreTrade({ quantity: '1.25', quantityStep: '0.1' });
    expect(result.allowed).toBe(false);
    expect(result.rejectionReasons).toContain('Order quantity 1.25 is not a multiple of stepSize 0.1');
  });

  it('resolves known venue capabilities without changing live execution gating', () => {
    expect(resolveCanonicalVenueCapabilities('binance')).toBe(VENUE_CAPABILITIES_MATRIX[ExchangeVenue.BINANCE]);
    expect(resolveCanonicalVenueCapabilities('binance').liveOrderExecutionGated).toBe(true);
  });

  it('keeps the canonical OTHER_CONFIGURED fallback for an unknown venue', () => {
    expect(resolveCanonicalVenueCapabilities('unrecognized-venue'))
      .toBe(VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OTHER_CONFIGURED]);
  });

  it('exports production payment adapters rather than alternate implementations', () => {
    expect(StripePaymentAdapter).toBe(StripeProductionAdapter);
    expect(NowPaymentsAdapter).toBe(NowPaymentsProductionAdapter);
  });

  it('uses the same release-manifest implementation in the API and shared package', () => {
    expect(ReleaseManifestService).toBe(SharedReleaseManifestService);
  });

  it('retains canonical versioning and sorted migration evidence', () => {
    const manifest = new ReleaseManifestService().buildManifest(buildInputs);
    expect(manifest.version).toBe('1.0.0+01234567');
    expect(manifest.schema.migrationHistory).toEqual(['20261009_previous', '20261010_current']);
    expect(summarizeReleaseManifestForOpsConsole(manifest)).toEqual({
      releaseId: manifest.releaseId,
      version: manifest.version,
      commitShort: manifest.commitShort,
      environment: EnvironmentName.PRODUCTION,
      schemaHash: manifest.schema.schemaHash,
      valid: true,
      validationErrors: [],
    });
  });

  it('reports missing artifact evidence as an invalid manifest', () => {
    const manifest = new ReleaseManifestService().buildManifest(buildInputs);
    manifest.artifacts.artifactChecksum = '';
    const summary = summarizeReleaseManifestForOpsConsole(manifest);
    expect(summary.valid).toBe(false);
    expect(summary.validationErrors).toContain('artifactChecksum missing');
  });

  it('retains a reproducible release identifier and artifact checksum for identical build inputs', () => {
    const service = new ReleaseManifestService();
    const first = service.buildManifest(buildInputs);
    const second = service.buildManifest(buildInputs);
    expect(first.releaseId).toBe(second.releaseId);
    expect(first.artifacts.artifactChecksum).toBe(second.artifacts.artifactChecksum);
    expect(service.isDeterministic(first, second)).toBe(true);
  });
});


// # Responsibility: provide schema-typed fixture records and query-aware mocks, not production financial substitutes.
type SubscriptionWithPlan = Prisma.TenantSubscriptionGetPayload<{ include: { plan: true } }>;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ANALYTICS_NOW = new Date('2026-10-10T12:00:00.000Z');
const ANALYTICS_PERIOD: ReportingPeriod = {
  type: ReportingPeriodType.MONTH,
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-10-31T23:59:59.999Z',
  timezone: 'UTC',
  label: 'October 2026',
};

function analyticsActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    userId: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT_A,
    sessionId: '44444444-4444-4444-8444-444444444444',
    tokenId: 'analytics-token',
    roles: ['TENANT_ADMIN'],
    permissions: [Permission.SUBSCRIPTION_READ],
    isPlatformUser: false,
    ...overrides,
  };
}

function analyticsQuery(overrides: Partial<RevenueQueryDto> = {}): RevenueQueryDto {
  return Object.assign(new RevenueQueryDto(), {
    currency: 'USD',
    startDate: ANALYTICS_PERIOD.startDate,
    endDate: ANALYTICS_PERIOD.endDate,
    periodType: ReportingPeriodType.MONTH,
    timezone: 'UTC',
  }, overrides);
}

function paymentRecord(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    tenantId: TENANT_A,
    planId: 'plan-1',
    subscriptionId: 'subscription-1',
    provider: 'STRIPE',
    providerPaymentId: null,
    providerCheckoutId: null,
    providerSessionId: null,
    providerInvoiceId: null,
    providerReference: null,
    orderId: null,
    status: 'SUCCEEDED',
    amount: '10.00',
    currency: 'USD',
    refundedAmount: '0',
    failureReason: null,
    failureCode: null,
    idempotencyKey: 'payment-key-1',
    metadata: {},
    paidAt: new Date('2026-10-02T12:00:01.000Z'),
    failedAt: null,
    cancelledAt: null,
    refundedAt: null,
    createdAt: new Date('2026-10-02T12:00:00.000Z'),
    updatedAt: ANALYTICS_NOW,
    ...overrides,
  };
}

function invoiceRecord(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    tenantId: TENANT_A,
    invoiceNumber: 'INV-2026-1',
    status: 'PAID',
    currency: 'USD',
    subtotal: '10.00',
    taxTotal: '0',
    total: '10.00',
    amountPaid: '10.00',
    amountDue: '0',
    amountRefunded: '0',
    paymentId: 'payment-1',
    subscriptionId: 'subscription-1',
    planId: 'plan-1',
    provider: 'STRIPE',
    idempotencyKey: 'invoice-key-1',
    customer: {},
    lines: [],
    taxSummary: [],
    metadata: {},
    issuedAt: new Date('2026-10-02T12:00:00.000Z'),
    dueDate: null,
    finalizedAt: new Date('2026-10-02T12:00:00.000Z'),
    paidAt: new Date('2026-10-02T12:00:01.000Z'),
    voidedAt: null,
    createdAt: new Date('2026-10-02T12:00:00.000Z'),
    updatedAt: ANALYTICS_NOW,
    ...overrides,
  };
}

function refundRecord(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 'refund-1',
    tenantId: TENANT_A,
    paymentId: 'payment-1',
    invoiceId: 'invoice-1',
    refundType: 'PARTIAL',
    reason: 'REQUESTED_BY_CUSTOMER',
    reasonDetails: null,
    amount: '2.50',
    currency: 'USD',
    status: 'SUCCEEDED',
    provider: 'STRIPE',
    providerRefundId: null,
    providerStatus: null,
    idempotencyKey: 'refund-key-1',
    failureReason: null,
    failureCode: null,
    requestedBy: null,
    requestedAt: new Date('2026-10-03T12:00:00.000Z'),
    processedAt: null,
    succeededAt: new Date('2026-10-03T12:00:01.000Z'),
    failedAt: null,
    metadata: {},
    createdAt: new Date('2026-10-03T12:00:00.000Z'),
    updatedAt: ANALYTICS_NOW,
    ...overrides,
  };
}

function planRecord(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: 'plan-1',
    tenantId: null,
    code: 'CANONICAL_MONTHLY',
    name: 'Canonical monthly plan',
    description: null,
    audience: 'TENANT',
    price: new Prisma.Decimal('10.00'),
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 0,
    performanceFeeBps: 0,
    platformFeeBps: 0,
    limits: {},
    features: [],
    isActive: true,
    sortOrder: 0,
    externalPriceId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: ANALYTICS_NOW,
    deletedAt: null,
    ...overrides,
  };
}

function subscriptionRecord(overrides: Partial<SubscriptionWithPlan> = {}): SubscriptionWithPlan {
  return {
    id: 'subscription-1',
    tenantId: TENANT_A,
    planId: 'plan-1',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelReason: null,
    seatsPurchased: 1,
    externalCustomerId: null,
    externalSubscriptionId: null,
    metadata: {},
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: ANALYTICS_NOW,
    plan: planRecord(),
    ...overrides,
  };
}

interface AnalyticsFixtureRecords {
  payments: Payment[];
  invoices: Invoice[];
  refunds: Refund[];
  subscriptions: SubscriptionWithPlan[];
  plans: SubscriptionPlan[];
  dunningCases: DunningCase[];
  feeAccruals: PersistedFeeAccrual[];
  feeSettlements: FeeSettlement[];
  ledgerEntries: BillingLedgerEntry[];
  usageMeters: UsageMeter[];
}

function createAnalyticsFixtures() {
  const records: AnalyticsFixtureRecords = {
    payments: [], invoices: [], refunds: [], subscriptions: [], plans: [],
    dunningCases: [], feeAccruals: [], feeSettlements: [], ledgerEntries: [], usageMeters: [],
  };
  const db = {
    payment: {
      findMany: jest.fn<(args: Prisma.PaymentFindManyArgs) => Promise<Payment[]>>()
        .mockImplementation(async ({ where }) => records.payments.filter((row) => rowMatches(row, where))),
    },
    invoice: {
      findMany: jest.fn<(args: Prisma.InvoiceFindManyArgs) => Promise<Invoice[]>>()
        .mockImplementation(async ({ where }) => records.invoices.filter((row) => rowMatches(row, where))),
    },
    refund: {
      findMany: jest.fn<(args: Prisma.RefundFindManyArgs) => Promise<Refund[]>>()
        .mockImplementation(async ({ where }) => records.refunds.filter((row) => rowMatches(row, where))),
    },
    tenantSubscription: {
      findMany: jest.fn<(args: Prisma.TenantSubscriptionFindManyArgs) => Promise<SubscriptionWithPlan[]>>()
        .mockImplementation(async ({ where }) => records.subscriptions.filter((row) => rowMatches(row, where))),
      findFirst: jest.fn<(args: Prisma.TenantSubscriptionFindFirstArgs) => Promise<SubscriptionWithPlan | null>>()
        .mockImplementation(async ({ where }) => records.subscriptions
          .filter((row) => rowMatches(row, where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null),
    },
    subscriptionPlan: {
      findMany: jest.fn<(args: Prisma.SubscriptionPlanFindManyArgs) => Promise<SubscriptionPlan[]>>()
        .mockImplementation(async ({ where }) => records.plans.filter((row) => rowMatches(row, where))),
    },
    dunningCase: {
      findMany: jest.fn<(args: Prisma.DunningCaseFindManyArgs) => Promise<DunningCase[]>>()
        .mockImplementation(async ({ where }) => records.dunningCases.filter((row) => rowMatches(row, where))),
    },
    feeAccrual: {
      findMany: jest.fn<(args: Prisma.FeeAccrualFindManyArgs) => Promise<PersistedFeeAccrual[]>>()
        .mockImplementation(async ({ where }) => records.feeAccruals.filter((row) => rowMatches(row, where))),
    },
    feeSettlement: {
      findMany: jest.fn<(args: Prisma.FeeSettlementFindManyArgs) => Promise<FeeSettlement[]>>()
        .mockImplementation(async ({ where }) => records.feeSettlements.filter((row) => rowMatches(row, where))),
    },
    billingLedgerEntry: {
      findMany: jest.fn<(args: Prisma.BillingLedgerEntryFindManyArgs) => Promise<BillingLedgerEntry[]>>()
        .mockImplementation(async ({ where }) => records.ledgerEntries.filter((row) => rowMatches(row, where))),
    },
    usageMeter: {
      findMany: jest.fn<(args: Prisma.UsageMeterFindManyArgs) => Promise<UsageMeter[]>>()
        .mockImplementation(async ({ where }) => records.usageMeters.filter((row) => rowMatches(row, where))),
    },
  };
  const cache = {
    get: jest.fn<(_key: string) => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<(_key: string, _value: unknown, _ttl?: number) => Promise<void>>().mockResolvedValue(undefined),
    deleteByPattern: jest.fn<(_pattern: string) => Promise<number>>().mockResolvedValue(0),
  } satisfies Pick<CacheService, 'get' | 'set' | 'deleteByPattern'>;
  return { records, db, cache };
}

function singleCurrencyMrr(result: MrrBreakdown | MrrBreakdown[]): MrrBreakdown {
  if (Array.isArray(result)) throw new Error('Expected a single-currency MRR result');
  return result;
}

describe('Typed analytics API contracts', () => {
  let fixtures: ReturnType<typeof createAnalyticsFixtures>;
  let module: TestingModule;
  let controller: AnalyticsController;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(ANALYTICS_NOW);
    fixtures = createAnalyticsFixtures();
    module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        AnalyticsCacheService, AnalyticsReconciliationService, ArrCalculationService,
        BillingHealthService, CashflowAnalyticsService, ChurnAnalyticsService,
        CustomerValueService, MrrCalculationService, PlanPerformanceService,
        RevenueAnalyticsService, RevenueCohortService, RevenueRecognitionService,
        SubscriptionAnalyticsService,
        { provide: PrismaService, useValue: fixtures.db },
        { provide: CacheService, useValue: fixtures.cache },
      ],
    }).compile();
    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function twoTenantPayments(): void {
    fixtures.records.payments = [
      paymentRecord({ tenantId: TENANT_A, amount: '10.00' }),
      paymentRecord({ id: 'payment-2', tenantId: TENANT_B, amount: '90.00', idempotencyKey: 'payment-key-2' }),
    ];
  }

  it('binds tenant ARPU to the authenticated tenant instead of reading platform payments', async () => {
    twoTenantPayments();
    const result = await controller.getArpu(analyticsActor(), analyticsQuery());
    expect(result.arpu.amount).toBe('10.00');
    expect(result.customerCount).toBe(1);
    expect(fixtures.db.payment.findMany).toHaveBeenCalledWith({ where: {
      currency: 'USD',
      createdAt: { gte: new Date(ANALYTICS_PERIOD.startDate), lte: new Date(ANALYTICS_PERIOD.endDate) },
      tenantId: { in: [TENANT_A] },
    } });
  });

  it('does not let a tenant ARPU query override authenticated tenant scope', async () => {
    twoTenantPayments();
    const result = await controller.getArpu(analyticsActor(), analyticsQuery({ tenantId: TENANT_B }));
    expect(result.arpu.amount).toBe('10.00');
    expect(fixtures.db.payment.findMany.mock.calls[0][0].where?.tenantId).toEqual({ in: [TENANT_A] });
  });

  it('preserves an explicitly authorized platform ARPU aggregate', async () => {
    twoTenantPayments();
    const result = await controller.getArpu(analyticsActor({ isPlatformUser: true }), analyticsQuery());
    expect(result.arpu.amount).toBe('50.00');
    expect(result.customerCount).toBe(2);
    expect(fixtures.db.payment.findMany.mock.calls[0][0].where?.tenantId).toBeUndefined();
  });

  it('preserves a platform ARPU query targeted at one tenant', async () => {
    twoTenantPayments();
    const result = await controller.getArpu(analyticsActor({ isPlatformUser: true }), analyticsQuery({ tenantId: TENANT_B }));
    expect(result.arpu.amount).toBe('90.00');
    expect(fixtures.db.payment.findMany.mock.calls[0][0].where?.tenantId).toEqual({ in: [TENANT_B] });
  });

  it.each(['', '   '])('rejects an ordinary ARPU actor with missing tenant context %p before querying', async (tenantId) => {
    await expect(controller.getArpu(analyticsActor({ tenantId }), analyticsQuery({ tenantId: TENANT_B })))
      .rejects.toThrow(ForbiddenException);
    expect(fixtures.db.payment.findMany).not.toHaveBeenCalled();
  });

  it('rejects missing tenant context before cached revenue overview can read an aggregate', async () => {
    await expect(controller.getRevenueOverview(analyticsActor({ tenantId: '' }), analyticsQuery()))
      .rejects.toThrow(ForbiddenException);
    expect(fixtures.cache.get).not.toHaveBeenCalled();
    expect(fixtures.db.invoice.findMany).not.toHaveBeenCalled();
  });

  it('uses authenticated tenant scope for customer value even when route and query tenants differ', async () => {
    twoTenantPayments();
    const result = await controller.getCustomerValue(TENANT_B, analyticsActor(), analyticsQuery({ tenantId: TENANT_B }));
    expect(result.tenantId).toBe(TENANT_A);
    expect(result.totalPaid.amount).toBe('10.00');
    expect(fixtures.db.tenantSubscription.findMany.mock.calls[0][0].where?.tenantId).toBe(TENANT_A);
    expect(fixtures.db.refund.findMany.mock.calls[0][0].where?.tenantId).toBe(TENANT_A);
  });

  const normalizationCases: [string, BillingInterval, string, string][] = [
    ['10.01', BillingInterval.MONTHLY, 'USD', '10.01'],
    ['100.01', BillingInterval.QUARTERLY, 'USD', '33.34'],
    ['1200.12', BillingInterval.YEARLY, 'USD', '100.01'],
    ['1001', BillingInterval.QUARTERLY, 'JPY', '334'],
    ['1200.12', BillingInterval.LIFETIME, 'USD', '0.00'],
  ];

  it.each(normalizationCases)('normalizes %s %s in %s to %s without widening currency policy', (price, interval, currency, expected) => {
    const service = module.get<MrrCalculationService>(MrrCalculationService);
    expect(service.normalizeToMrr(price, interval, currency).amount).toBe(expected);
  });

  it('keeps lifetime revenue non-recurring unless the explicit policy includes it', () => {
    const service = module.get<MrrCalculationService>(MrrCalculationService);
    expect(service.normalizeToMrr('1200.12', BillingInterval.LIFETIME, 'USD', true).amount).toBe('100.01');
  });

  it('retains seats, tenant isolation, and trial inclusion policy in typed MRR queries', async () => {
    fixtures.records.subscriptions = [
      subscriptionRecord({ seatsPurchased: 2, plan: planRecord({ price: new Prisma.Decimal('10.01') }) }),
      subscriptionRecord({ id: 'trial-1', status: 'TRIALING', plan: planRecord({ price: new Prisma.Decimal('20.00') }) }),
      subscriptionRecord({ id: 'other-tenant', tenantId: TENANT_B, plan: planRecord({ price: new Prisma.Decimal('999.00') }) }),
    ];
    const service = module.get<MrrCalculationService>(MrrCalculationService);
    const normal = await service.calculateMrrForTenant(TENANT_A, 'USD', ANALYTICS_NOW);
    expect(normal.totalMrr.amount).toBe('20.02');
    expect(normal.activeSubscriptions).toBe(1);
    const withTrials = singleCurrencyMrr(await service.calculateMrr({
      tenantId: TENANT_A, currency: 'USD', asOfDate: ANALYTICS_NOW, includeTrials: true,
    }));
    expect(withTrials.totalMrr.amount).toBe('40.02');
    expect(withTrials.activeSubscriptions).toBe(2);
    expect(fixtures.db.tenantSubscription.findMany.mock.calls[0][0].where?.tenantId).toBe(TENANT_A);
  });

  it('separates typed multi-currency MRR buckets instead of inventing an FX conversion', async () => {
    fixtures.records.subscriptions = [
      subscriptionRecord(),
      subscriptionRecord({ id: 'jpy-sub', plan: planRecord({ id: 'jpy-plan', price: new Prisma.Decimal('1001'), currency: 'JPY' }) }),
    ];
    const result = await module.get<MrrCalculationService>(MrrCalculationService).calculateMrr({ asOfDate: ANALYTICS_NOW });
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) throw new Error('Expected separate currency buckets');
    expect(result.map((bucket) => ({ currency: bucket.currency, amount: bucket.totalMrr.amount })))
      .toEqual([{ currency: 'USD', amount: '10.00' }, { currency: 'JPY', amount: '1001' }]);
  });

  it('propagates a canonical subscription read failure instead of producing zero MRR', async () => {
    const failure = new Error('subscription storage unavailable');
    fixtures.db.tenantSubscription.findMany.mockRejectedValueOnce(failure);
    await expect(module.get<MrrCalculationService>(MrrCalculationService).calculateMrrForTenant(TENANT_A, 'USD'))
      .rejects.toBe(failure);
  });

  it('calculates billing health from typed source rows while enforcing tenant and currency predicates', async () => {
    fixtures.records.payments = [
      paymentRecord({ providerCheckoutId: 'checkout-1' }),
      paymentRecord({ id: 'failed-payment', status: 'FAILED', paidAt: null, providerSessionId: 'session-1' }),
      paymentRecord({ id: 'other-tenant-payment', tenantId: TENANT_B }),
      paymentRecord({ id: 'other-currency-payment', currency: 'JPY' }),
    ];
    fixtures.records.invoices = [invoiceRecord()];
    fixtures.records.refunds = [refundRecord()];
    const result = await module.get<BillingHealthService>(BillingHealthService).calculateBillingHealth({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    });
    expect(result.totalPayments).toBe(2);
    expect(result.paymentSuccessRate).toBe('50.00');
    expect(result.paymentFailureRate).toBe('50.00');
    expect(result.refundAmount.amount).toBe('2.50');
    expect(result.averagePaymentProcessingDurationMs).toBe(1000);
    expect(result.checkoutConversionRate).toBe('50.00');
    expect(fixtures.db.invoice.findMany.mock.calls[0][0].where?.tenantId).toBe(TENANT_A);
    expect(fixtures.db.refund.findMany.mock.calls[0][0].where?.currency).toBe('USD');
  });

  it('does not fabricate payment processing timestamps or checkout evidence', async () => {
    fixtures.records.payments = [paymentRecord({ paidAt: null })];
    const result = await module.get<BillingHealthService>(BillingHealthService).calculateBillingHealth({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    });
    expect(result.averagePaymentProcessingDurationMs).toBeUndefined();
    expect(result.checkoutConversionRate).toBeUndefined();
  });

  it('does not treat an absent required Prisma delegate as an empty successful billing source', async () => {
    Reflect.deleteProperty(fixtures.db, 'invoice');
    await expect(module.get<BillingHealthService>(BillingHealthService).calculateBillingHealth({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toThrow(TypeError);
  });

  it.each<Prisma.JsonValue>([null, [], 'scalar metadata'])('safely ignores non-object churn metadata %p', async (metadata) => {
    fixtures.records.subscriptions = [subscriptionRecord({
      status: 'CANCELED', canceledAt: new Date('2026-10-05T00:00:00.000Z'), metadata,
    })];
    const result = await module.get<ChurnAnalyticsService>(ChurnAnalyticsService).calculateChurn({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    });
    expect(result.subscriptionChurnCount).toBe(1);
    expect(result.failedPaymentChurnCount).toBe(0);
    expect(result.netRevenueRetention).toBeNull();
  });

  it('preserves dunning evidence when classifying typed subscription churn', async () => {
    fixtures.records.subscriptions = [subscriptionRecord({
      status: 'CANCELED', canceledAt: new Date('2026-10-05T00:00:00.000Z'), metadata: { dunningCaseId: 'dunning-1' },
    })];
    const result = await module.get<ChurnAnalyticsService>(ChurnAnalyticsService).calculateChurn({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    });
    expect(result.failedPaymentChurnCount).toBe(1);
  });

  it('propagates churn baseline storage failure instead of claiming a zero baseline', async () => {
    const failure = new Error('MRR baseline read unavailable');
    fixtures.db.tenantSubscription.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(failure);
    await expect(module.get<ChurnAnalyticsService>(ChurnAnalyticsService).calculateChurn({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toBe(failure);
  });

  it('uses the stored first-paid date only when its JSON value is a valid date input', async () => {
    fixtures.records.subscriptions = [subscriptionRecord({
      createdAt: new Date('2026-10-01T00:00:00.000Z'), metadata: { firstPaidAt: '2026-10-05T00:00:00.000Z' },
    })];
    const result = await module.get<RevenueCohortService>(RevenueCohortService).calculateCohorts({
      currency: 'USD', definition: CohortDefinition.FIRST_PAID_MONTH, period: ANALYTICS_PERIOD, retentionPeriods: 1,
    });
    expect(result.cohorts.map((cohort) => cohort.cohortPeriod)).toEqual(['2026-10']);
  });

  it.each<Prisma.JsonValue>([true, { malformed: 'date' }, 'not-a-date'])('does not invent a first-paid cohort for malformed JSON date %p', async (firstPaidAt) => {
    fixtures.records.subscriptions = [subscriptionRecord({ metadata: { firstPaidAt } })];
    const result = await module.get<RevenueCohortService>(RevenueCohortService).calculateCohorts({
      currency: 'USD', definition: CohortDefinition.FIRST_PAID_MONTH, period: ANALYTICS_PERIOD, retentionPeriods: 1,
    });
    expect(result.cohorts).toEqual([]);
  });

  it('counts typed plan movement metadata and links refunds through canonical payment IDs', async () => {
    fixtures.records.plans = [planRecord()];
    fixtures.records.subscriptions = [
      subscriptionRecord({ metadata: { changeType: 'UPGRADE' } }),
      subscriptionRecord({ id: 'trial-sub', status: 'TRIALING', metadata: [] }),
    ];
    fixtures.records.payments = [paymentRecord()];
    fixtures.records.refunds = [refundRecord()];
    const result = await module.get<PlanPerformanceService>(PlanPerformanceService).calculatePlanPerformance({
      currency: 'USD', period: ANALYTICS_PERIOD, planId: 'plan-1',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      planId: 'plan-1', activeSubscribers: 1, trialSubscribers: 1, upgradeCount: 1, downgradeCount: 0,
    });
    expect(result[0].mrr.amount).toBe('10.00');
    expect(result[0].grossRevenue.amount).toBe('10.00');
    expect(result[0].refunds.amount).toBe('2.50');
    expect(result[0].netRevenue.amount).toBe('7.50');
    expect(fixtures.db.refund.findMany.mock.calls[0][0].where?.paymentId).toEqual({ in: ['payment-1'] });
  });

  it('preserves canonical MRR and ARR reconciliation for typed subscription rows', async () => {
    fixtures.records.subscriptions = [subscriptionRecord({ seatsPurchased: 2 })];
    const result = await module.get<AnalyticsReconciliationService>(AnalyticsReconciliationService).reconcile({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    });
    expect(result.summary.mrrMatched).toBe(true);
    expect(result.summary.arrMatched).toBe(true);
    expect(result.issues).toEqual([]);
    // The currency-mismatch check is conditional; a single-currency source has eight executed checks.
    expect(result.totalChecked).toBe(8);
    expect(fixtures.db.billingLedgerEntry.findMany.mock.calls[0][0].where?.tenantId).toBe(TENANT_A);
  });

  it('does not label failed MRR reconciliation as a successful match', async () => {
    const failure = new Error('MRR calculation unavailable');
    jest.spyOn(module.get<MrrCalculationService>(MrrCalculationService), 'calculateMrr').mockRejectedValueOnce(failure);
    await expect(module.get<AnalyticsReconciliationService>(AnalyticsReconciliationService).reconcile({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toBe(failure);
  });

  it('does not label failed ARR reconciliation as a successful match', async () => {
    const failure = new Error('ARR calculation unavailable');
    jest.spyOn(module.get<ArrCalculationService>(ArrCalculationService), 'calculateArr').mockRejectedValueOnce(failure);
    await expect(module.get<AnalyticsReconciliationService>(AnalyticsReconciliationService).reconcile({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toBe(failure);
  });

  it('propagates malformed financial source amounts instead of suppressing comparison failures', async () => {
    fixtures.records.invoices = [invoiceRecord({ total: 'invalid-money' })];
    await expect(module.get<AnalyticsReconciliationService>(AnalyticsReconciliationService).reconcile({
      tenantId: TENANT_A, currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toThrow('Invalid amount: invalid-money');
  });

  it('propagates top-customer recurring-value read failures instead of fabricating zero MRR', async () => {
    fixtures.records.payments = [paymentRecord()];
    const failure = new Error('current subscription lookup unavailable');
    fixtures.db.tenantSubscription.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<CustomerValueService>(CustomerValueService).listTopCustomers({
      currency: 'USD', period: ANALYTICS_PERIOD,
    })).rejects.toBe(failure);
  });

  it('keeps typed multi-currency invoice buckets scoped to the requested tenant', async () => {
    fixtures.records.invoices = [
      invoiceRecord(),
      invoiceRecord({ id: 'jpy-invoice', currency: 'JPY', total: '1001' }),
      invoiceRecord({ id: 'other-tenant-invoice', tenantId: TENANT_B, total: '999.00' }),
    ];
    const result = await module.get<RevenueAnalyticsService>(RevenueAnalyticsService).calculateMultiCurrencyBuckets({
      tenantId: TENANT_A, period: ANALYTICS_PERIOD,
    });
    expect(result.map((bucket) => ({ currency: bucket.currency, amount: bucket.total.amount })))
      .toEqual([{ currency: 'USD', amount: '10.00' }, { currency: 'JPY', amount: '1001' }]);
  });
});

describe('Typed in-memory persistence contract', () => {
  it('preserves per-tenant idempotency uniqueness and PostgreSQL null-index behavior', () => {
    const db = new InMemoryPrisma({ payment: [['tenantId', 'idempotencyKey']] });
    const seeded = db.seed('payment', { id: 'payment-a', tenantId: TENANT_A, idempotencyKey: 'shared-key' });
    expect(seeded.id).toBe('payment-a');
    expect(() => db.seed('payment', { id: 'payment-b', tenantId: TENANT_B, idempotencyKey: 'shared-key' })).not.toThrow();
    expect(() => db.seed('payment', { id: 'duplicate', tenantId: TENANT_A, idempotencyKey: 'shared-key' }))
      .toThrow('Unique constraint failed');
    expect(() => db.seed('payment', { tenantId: TENANT_A, idempotencyKey: null })).not.toThrow();
    expect(() => db.seed('payment', { tenantId: TENANT_A, idempotencyKey: null })).not.toThrow();
  });

  it('preserves typed date filtering, compound predicates, ordering, and pagination', async () => {
    const db = new InMemoryPrisma();
    db.seed('payment', { id: 'first', tenantId: TENANT_A, createdAt: new Date('2026-10-01T00:00:00.000Z') });
    db.seed('payment', { id: 'second', tenantId: TENANT_A, createdAt: new Date('2026-10-02T00:00:00.000Z') });
    db.seed('payment', { id: 'other-tenant', tenantId: TENANT_B, createdAt: new Date('2026-10-03T00:00:00.000Z') });
    const rows = await db.model('payment').findMany({
      where: { AND: [{ tenantId: TENANT_A }, { createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') } }] },
      orderBy: { createdAt: 'desc' }, skip: 1, take: 1,
    });
    expect(rows.map((row) => row.id)).toEqual(['first']);
  });

  it('preserves lexical and numeric scalar comparisons without broad casts', () => {
    expect(rowMatches({ value: '10' }, { value: { lt: '2' } })).toBe(true);
    expect(rowMatches({ value: '10' }, { value: { lt: 11 } })).toBe(true);
    expect(rowMatches({ value: 10 }, { value: { gte: 10 } })).toBe(true);
    expect(rowMatches({ value: null }, { value: { lt: 10 } })).toBe(false);
    expect(rowMatches({ value: 10 }, { OR: [{ value: 9 }, { value: 10 }] })).toBe(true);
    expect(rowMatches({ value: 10 }, { value: { in: 'not-a-list' } })).toBe(false);
  });

  it('assigns UUIDs through the typed delegate and rejects missing test RLS context', async () => {
    const db = new InMemoryPrisma();
    const row = await db.model('payment').create({ data: { tenantId: TENANT_A } });
    expect(row.id).toEqual(expect.any(String));
    await expect(db.withTenantRls('', async () => 'should-not-run')).rejects.toThrow('tenantId is required');
  });
});


// # Responsibility: cover typed lifecycle read/write boundaries and immutable request evidence using canonical schema records.
function lifecycleProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: 'profile-a', tenantId: TENANT_A, clientType: 'CLIENT', status: 'PENDING',
    legalName: null, displayName: 'Client A', email: null, phone: null, countryCode: null,
    externalIdentityRef: null, kycReferenceId: null, amlReferenceId: null, complianceCaseId: null,
    riskProfileId: null, onboardingId: null, metadata: {}, piiHash: null, idempotencyKey: 'profile-key',
    createdAt: new Date('2026-10-10T00:00:00.000Z'), updatedAt: new Date('2026-10-10T00:00:00.000Z'), deletedAt: null,
    ...overrides,
  };
}

function lifecycleAccount(overrides: Partial<InstitutionalAccount> = {}): InstitutionalAccount {
  return {
    id: 'account-a', tenantId: TENANT_A, clientProfileId: 'profile-a', accountType: 'TRADING', state: 'PENDING',
    displayName: null, ownerId: null, ownerType: null, exchangeAccountId: null, portfolioId: null,
    isTradingEnabled: false, isFundingEnabled: false, isWithdrawalEnabled: false,
    tradingEligibility: null, eligibilityEvidence: null, blockingReasons: [],
    complianceStatus: null, riskStatus: null, securityStatus: null, metadata: {}, idempotencyKey: 'account-key',
    activatedAt: null, suspendedAt: null, closedAt: null, deletedAt: null,
    createdAt: new Date('2026-10-10T00:00:00.000Z'), updatedAt: new Date('2026-10-10T00:00:00.000Z'), ...overrides,
  };
}

function lifecycleFunding(overrides: Partial<FundingRequest> = {}): FundingRequest {
  return {
    id: 'funding-a', tenantId: TENANT_A, accountId: 'account-a', clientProfileId: 'profile-a', state: 'REQUESTED',
    requestedAmount: '10.00', approvedAmount: null, submittedAmount: null, confirmedAmount: null, settledAmount: null,
    currency: 'USD', externalReference: 'external-ref', sourceType: null, sourceId: null, requestedBy: null,
    approvedBy: null, approvalPolicyVersion: null, calculationVersion: 'client-lifecycle-v1.0.0',
    failureReason: null, reversalReason: null, metadata: {}, evidence: {}, idempotencyKey: 'funding-key',
    requestedAt: new Date('2026-10-10T00:00:00.000Z'), approvedAt: null, submittedAt: null, confirmedAt: null,
    failedAt: null, createdAt: new Date('2026-10-10T00:00:00.000Z'), updatedAt: new Date('2026-10-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Typed lifecycle persistence boundaries', () => {
  let module: TestingModule;
  let profiles: ClientProfile[];
  let accounts: InstitutionalAccount[];
  let fundingRows: FundingRequest[];
  let prisma: PrismaService;
  let db: ReturnType<typeof lifecycleDatabase>;
  let audit: { log: jest.Mock<(input: Parameters<LifecycleAuditService['log']>[0]) => Promise<void>> };
  let outbox: { append: jest.Mock<(tx: Prisma.TransactionClient, input: Parameters<OutboxService['append']>[1]) => Promise<void>> };

  function lifecycleDatabase() {
    return {
      tenant: { findUnique: jest.fn<(args: Prisma.TenantFindUniqueArgs) => Promise<{ supportedCurrencies: string[]; defaultCurrency: string }>>()
        .mockResolvedValue({ supportedCurrencies: ['USD'], defaultCurrency: 'USD' }) },
      securityPolicy: { findFirst: jest.fn<(args: Prisma.SecurityPolicyFindFirstArgs) => Promise<null>>().mockResolvedValue(null) },
      clientProfile: {
        findFirst: jest.fn<(args: Prisma.ClientProfileFindFirstArgs) => Promise<ClientProfile | null>>()
          .mockImplementation(async (args) => profiles.find((row) => rowMatches(row, args.where ?? {})) ?? null),
        create: jest.fn<(args: Prisma.ClientProfileCreateArgs) => Promise<ClientProfile>>()
          .mockRejectedValue(new Error('Unexpected profile creation')),
        update: jest.fn<(args: Prisma.ClientProfileUpdateArgs) => Promise<ClientProfile>>()
          .mockImplementation(async (args) => {
            const row = profiles.find((profile) => rowMatches(profile, args.where));
            if (!row) throw Object.assign(new Error('Not found'), { code: 'P2025' });
            return row;
          }),
      },
      institutionalAccount: {
        findFirst: jest.fn<(args: Prisma.InstitutionalAccountFindFirstArgs) => Promise<InstitutionalAccount | null>>()
          .mockImplementation(async (args) => accounts.find((row) => rowMatches(row, args.where ?? {})) ?? null),
        create: jest.fn<(args: Prisma.InstitutionalAccountCreateArgs) => Promise<InstitutionalAccount>>()
          .mockRejectedValue(new Error('Unexpected account creation')),
        update: jest.fn<(args: Prisma.InstitutionalAccountUpdateArgs) => Promise<InstitutionalAccount>>()
          .mockImplementation(async (args) => accounts.find((row) => rowMatches(row, args.where)) ?? Promise.reject(new Error('Not found'))),
      },
      accountOwnership: {
        count: jest.fn<(args: Prisma.AccountOwnershipCountArgs) => Promise<number>>().mockResolvedValue(0),
        findFirst: jest.fn<(args: Prisma.AccountOwnershipFindFirstArgs) => Promise<AccountOwnership | null>>().mockResolvedValue(null),
        create: jest.fn<(args: Prisma.AccountOwnershipCreateArgs) => Promise<AccountOwnership>>()
          .mockRejectedValue(new Error('Unexpected ownership creation')),
      },
      accountRelationship: {
        findFirst: jest.fn<(args: Prisma.AccountRelationshipFindFirstArgs) => Promise<AccountRelationship | null>>().mockResolvedValue(null),
        create: jest.fn<(args: Prisma.AccountRelationshipCreateArgs) => Promise<AccountRelationship>>()
          .mockRejectedValue(new Error('Unexpected relationship creation')),
      },
      accountRestriction: {
        findFirst: jest.fn<(args: Prisma.AccountRestrictionFindFirstArgs) => Promise<AccountRestriction | null>>().mockResolvedValue(null),
        findMany: jest.fn<(args: Prisma.AccountRestrictionFindManyArgs) => Promise<AccountRestriction[]>>().mockResolvedValue([]),
        create: jest.fn<(args: Prisma.AccountRestrictionCreateArgs) => Promise<AccountRestriction>>()
          .mockRejectedValue(new Error('Unexpected restriction creation')),
      },
      fundingRequest: {
        findFirst: jest.fn<(args: Prisma.FundingRequestFindFirstArgs) => Promise<FundingRequest | null>>()
          .mockImplementation(async (args) => fundingRows.find((row) => rowMatches(row, args.where ?? {})) ?? null),
        create: jest.fn<(args: Prisma.FundingRequestCreateArgs) => Promise<FundingRequest>>()
          .mockImplementation(async (args) => {
            const row = lifecycleFunding({ requestedAmount: String(args.data.requestedAmount), currency: args.data.currency,
              idempotencyKey: args.data.idempotencyKey, externalReference: args.data.externalReference ?? null });
            fundingRows.push(row); return row;
          }),
        update: jest.fn<(args: Prisma.FundingRequestUpdateArgs) => Promise<FundingRequest>>()
          .mockRejectedValue(new Error('Unexpected funding transition')),
      },
      async withTenantRls<T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        if (tenantId !== TENANT_A) throw new Error('Unexpected tenant RLS scope');
        const before = fundingRows.slice();
        try { return await work(prisma); }
        catch (error) { fundingRows.splice(0, fundingRows.length, ...before); throw error; }
      },
    };
  }

  beforeEach(async () => {
    profiles = [lifecycleProfile()]; accounts = [lifecycleAccount()]; fundingRows = [];
    db = lifecycleDatabase();
    audit = { log: jest.fn<(input: Parameters<LifecycleAuditService['log']>[0]) => Promise<void>>().mockResolvedValue(undefined) };
    outbox = { append: jest.fn<(tx: Prisma.TransactionClient, input: Parameters<OutboxService['append']>[1]) => Promise<void>>()
      .mockResolvedValue(undefined) };
    module = await Test.createTestingModule({ providers: [
      ClientProfileRepository, ClientPolicyService, AccountAdministrationService, AccountOwnershipService,
      AccountRestrictionService, RelationshipService, FundingRequestService,
      { provide: PrismaService, useValue: db }, { provide: AppConfigService, useValue: {} },
      { provide: LifecycleAuditService, useValue: audit }, { provide: OutboxService, useValue: outbox },
    ] }).compile();
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => { await module.close(); jest.restoreAllMocks(); });

  it('propagates a failed ownership tenant read without creating an unchecked relationship', async () => {
    const failure = new Error('ownership tenant lookup unavailable');
    db.institutionalAccount.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<AccountOwnershipService>(AccountOwnershipService).createOwnership({
      tenantId: TENANT_A, accountId: 'account-a', ownerId: 'owner-a', ownerType: 'USER',
    })).rejects.toBe(failure);
    expect(db.accountOwnership.create).not.toHaveBeenCalled();
  });

  it('propagates owner-capacity failures instead of assuming another owner is allowed', async () => {
    const failure = new Error('owner count unavailable');
    db.accountOwnership.count.mockRejectedValueOnce(failure);
    await expect(module.get<AccountOwnershipService>(AccountOwnershipService).createOwnership({
      tenantId: TENANT_A, accountId: 'account-a', ownerId: 'owner-a', ownerType: 'USER',
    })).rejects.toBe(failure);
    expect(db.accountOwnership.create).not.toHaveBeenCalled();
  });

  it('preserves configured ownership capacity enforcement', async () => {
    db.accountOwnership.count.mockResolvedValueOnce(5);
    await expect(module.get<AccountOwnershipService>(AccountOwnershipService).createOwnership({
      tenantId: TENANT_A, accountId: 'account-a', ownerId: 'owner-a', ownerType: 'USER',
    })).rejects.toThrow('Max owners per account');
    expect(db.accountOwnership.create).not.toHaveBeenCalled();
  });

  it('does not create ownership when its ambiguity check is unreadable', async () => {
    const failure = new Error('ambiguity lookup unavailable');
    db.accountOwnership.findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(failure);
    await expect(module.get<AccountOwnershipService>(AccountOwnershipService).createOwnership({
      tenantId: TENANT_A, accountId: 'account-a', ownerId: 'owner-a', ownerType: 'USER', ownershipType: AccountOwnershipType.OWNER,
    })).rejects.toBe(failure);
    expect(db.accountOwnership.create).not.toHaveBeenCalled();
  });

  it('does not create a relationship when an authoritative profile read fails', async () => {
    const failure = new Error('relationship profile read unavailable');
    db.clientProfile.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<RelationshipService>(RelationshipService).createRelationship({
      tenantId: TENANT_A, sourceId: 'profile-a', sourceType: 'CLIENT_PROFILE', targetId: 'profile-b',
      targetType: 'CLIENT_PROFILE', relationshipType: AccountRelationshipType.CLIENT_TO_CLIENT,
    })).rejects.toBe(failure);
    expect(db.accountRelationship.create).not.toHaveBeenCalled();
  });

  it('refuses a relationship to a profile from another tenant', async () => {
    profiles.push(lifecycleProfile({ id: 'profile-b', tenantId: TENANT_B }));
    await expect(module.get<RelationshipService>(RelationshipService).createRelationship({
      tenantId: TENANT_A, sourceId: 'profile-a', sourceType: 'CLIENT_PROFILE', targetId: 'profile-b',
      targetType: 'CLIENT_PROFILE', relationshipType: AccountRelationshipType.CLIENT_TO_CLIENT,
    })).rejects.toThrow('Cross-tenant relationship rejected');
    expect(db.accountRelationship.create).not.toHaveBeenCalled();
  });

  it('does not create a profile after an idempotency read fails', async () => {
    const failure = new Error('profile idempotency lookup unavailable');
    db.clientProfile.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<ClientProfileRepository>(ClientProfileRepository).createProfile({ tenantId: TENANT_A, idempotencyKey: 'profile-key' }))
      .rejects.toBe(failure);
    expect(db.clientProfile.create).not.toHaveBeenCalled();
  });

  it('returns the original profile for a genuine tenant-scoped idempotency hit', async () => {
    const result = await module.get<ClientProfileRepository>(ClientProfileRepository).createProfile({ tenantId: TENANT_A, idempotencyKey: 'profile-key' });
    expect(result.id).toBe('profile-a'); expect(db.clientProfile.create).not.toHaveBeenCalled();
  });

  it('does not create an account after its idempotency read fails', async () => {
    const failure = new Error('account idempotency lookup unavailable');
    db.institutionalAccount.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<AccountAdministrationService>(AccountAdministrationService).createAccount({ tenantId: TENANT_A, clientProfileId: 'profile-a' }))
      .rejects.toBe(failure);
    expect(db.institutionalAccount.create).not.toHaveBeenCalled();
  });

  it('validates the original account metadata object before merging it with persisted JSON', async () => {
    const params: Parameters<AccountAdministrationService['updateAccountMetadata']>[0] = {
      tenantId: TENANT_A, accountId: 'account-a', metadata: { note: 'safe' },
    };
    Object.defineProperty(params, 'metadata', { value: ['not-an-object'], configurable: true });
    await expect(module.get<AccountAdministrationService>(AccountAdministrationService).updateAccountMetadata(params))
      .rejects.toThrow('Lifecycle metadata must be an object');
    expect(db.institutionalAccount.update).not.toHaveBeenCalled();
  });

  it('binds profile status mutation to both the supplied tenant and profile id', async () => {
    await module.get<ClientProfileRepository>(ClientProfileRepository).updateProfileStatus({ tenantId: TENANT_A, profileId: 'profile-a', status: 'APPROVED' });
    expect(db.clientProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'profile-a', tenantId: TENANT_A } }));
  });

  it('cannot mutate a profile of another tenant merely by knowing its id', async () => {
    profiles[0] = lifecycleProfile({ tenantId: TENANT_B });
    await expect(module.get<ClientProfileRepository>(ClientProfileRepository).updateProfileStatus({ tenantId: TENANT_A, profileId: 'profile-a', status: 'APPROVED' }))
      .rejects.toMatchObject({ code: 'P2025' });
  });

  it('rejects invalid runtime status values before issuing a profile update', async () => {
    await expect(module.get<ClientProfileRepository>(ClientProfileRepository).updateProfileStatus({ tenantId: TENANT_A, profileId: 'profile-a', status: 'UNREVIEWED_STATUS' }))
      .rejects.toThrow('Invalid profile status');
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('keeps trade and withdrawal checks fail-closed when restriction reads fail', async () => {
    db.accountRestriction.findMany.mockRejectedValue(new Error('restriction reads unavailable'));
    const service = module.get<AccountRestrictionService>(AccountRestrictionService);
    await expect(service.canTrade({ tenantId: TENANT_A, accountId: 'account-a' })).resolves.toEqual({ allowed: false, blockingRestrictions: ['CHECK_FAILED'] });
    await expect(service.canWithdraw({ tenantId: TENANT_A, accountId: 'account-a' })).resolves.toEqual({ allowed: false, blockingRestrictions: ['CHECK_FAILED'] });
  });

  it('does not create a restriction when its idempotency evidence is unreadable', async () => {
    const failure = new Error('restriction idempotency unavailable');
    db.accountRestriction.findFirst.mockRejectedValueOnce(failure);
    await expect(module.get<AccountRestrictionService>(AccountRestrictionService).applyRestriction({
      tenantId: TENANT_A, accountId: 'account-a', restrictionType: AccountRestrictionType.NO_TRADING, reason: 'Risk review required', source: 'risk-policy',
    })).rejects.toBe(failure);
    expect(db.accountRestriction.create).not.toHaveBeenCalled();
  });

  it('refuses an explicit funding profile that belongs to another tenant', async () => {
    profiles[0] = lifecycleProfile({ tenantId: TENANT_B });
    await expect(module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', clientProfileId: 'profile-a', requestedAmount: '10.00', currency: 'USD', externalReference: 'ref',
    })).rejects.toThrow('Funding client profile not found');
    expect(db.fundingRequest.create).not.toHaveBeenCalled();
  });

  it('refuses a same-tenant funding profile that does not own the requested account', async () => {
    profiles.push(lifecycleProfile({ id: 'different-profile' }));
    await expect(module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', clientProfileId: 'different-profile', requestedAmount: '10.00', currency: 'USD', externalReference: 'ref',
    })).rejects.toThrow('account/profile mismatch');
    expect(db.fundingRequest.create).not.toHaveBeenCalled();
  });

  it('returns matching idempotent funding evidence without duplicating its external reference or outbox event', async () => {
    fundingRows = [lifecycleFunding()];
    const result = await module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', requestedAmount: '10.00', currency: 'USD', externalReference: 'external-ref', idempotencyKey: 'funding-key',
    });
    expect(result.id).toBe('funding-a'); expect(result.state).toBe('REQUESTED');
    expect(db.fundingRequest.create).not.toHaveBeenCalled(); expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects external funding reference replay that changes the amount', async () => {
    fundingRows = [lifecycleFunding()];
    await expect(module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', requestedAmount: '20.00', currency: 'USD', externalReference: 'external-ref', idempotencyKey: 'funding-key',
    })).rejects.toThrow('Duplicate external funding reference');
    expect(db.fundingRequest.create).not.toHaveBeenCalled();
  });

  it('keeps newly persisted funding requests REQUESTED and appends the requested event in the same RLS transaction', async () => {
    const result = await module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', requestedAmount: '10.00', currency: 'USD', externalReference: 'external-ref', idempotencyKey: 'funding-key',
    });
    expect(result.state).toBe(FundingRequestState.REQUESTED); expect(result.confirmedAmount).toBeNull();
    expect(outbox.append).toHaveBeenCalledWith(prisma, expect.objectContaining({ tenantId: TENANT_A, eventType: 'funding.requested' }));
  });

  it('rolls back a new funding record in the test transaction when required outbox persistence fails', async () => {
    const failure = new Error('outbox unavailable'); outbox.append.mockRejectedValueOnce(failure);
    await expect(module.get<FundingRequestService>(FundingRequestService).createFundingRequest({
      tenantId: TENANT_A, accountId: 'account-a', requestedAmount: '10.00', currency: 'USD', externalReference: 'external-ref', idempotencyKey: 'funding-key',
    })).rejects.toBe(failure);
    expect(fundingRows).toEqual([]); expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('Runtime lifecycle metadata and enum narrowing', () => {
  it.each([null, [], 'scalar', 12, true])('rejects non-object metadata %p rather than asserting it as JSON input', (value) => {
    expect(() => lifecycleMetadata(value)).toThrow('Lifecycle metadata must be an object');
  });

  it('retains nested JSON values and safely serializes optional fields', () => {
    expect(lifecycleMetadata({ note: 'safe', nested: { verified: true }, tags: ['a'], optional: undefined }))
      .toEqual({ note: 'safe', nested: { verified: true }, tags: ['a'] });
  });

  it('rejects unserializable metadata rather than persisting a fabricated safe object', () => {
    expect(() => lifecycleMetadata({ amount: BigInt(1) })).toThrow('must be JSON serializable');
  });

  it('validates enum membership without casting arbitrary status values', () => {
    expect(lifecycleEnum(Object.values(FundingRequestState), 'REQUESTED', 'funding state')).toBe(FundingRequestState.REQUESTED);
    expect(() => lifecycleEnum(Object.values(FundingRequestState), 'FAKE_SUCCESS', 'funding state')).toThrow('Invalid funding state');
  });
});


// # Responsibility: ensure related feature keys and numeric limit values cannot widen tenant access when malformed or unavailable.
describe('Typed commercial feature and portal boundaries', () => {
  let module: TestingModule;
  let context: TenantBillingContext;
  let db: ReturnType<typeof commercialDatabase>;
  let builder: ReturnType<typeof commercialBuilder>;
  let enforcement: ReturnType<typeof commercialEnforcement>;

  function commercialDatabase() {
    return {
      tenantFeatureFlag: {
        findMany: jest.fn<(args: Prisma.TenantFeatureFlagFindManyArgs) => Promise<Prisma.TenantFeatureFlagGetPayload<{ include: { featureFlag: { select: { key: true } } } }>[]> >()
          .mockResolvedValue([{
            id: 'flag-override', tenantId: TENANT_A, featureFlagId: 'feature-flag', enabled: true, rolloutPercentage: null,
            metadata: {}, createdAt: new Date('2026-10-10T00:00:00.000Z'), updatedAt: new Date('2026-10-10T00:00:00.000Z'),
            featureFlag: { key: 'relatedFeatureKey' },
          }]),
        findFirst: jest.fn<(args: Prisma.TenantFeatureFlagFindFirstArgs) => Promise<null>>().mockResolvedValue(null),
      },
      user: { count: jest.fn<(args: Prisma.UserCountArgs) => Promise<number>>().mockResolvedValue(3) },
      traderProfile: { count: jest.fn<(args: Prisma.TraderProfileCountArgs) => Promise<number>>().mockResolvedValue(0) },
      tradingAccount: { count: jest.fn<(args: Prisma.TradingAccountCountArgs) => Promise<number>>().mockResolvedValue(0) },
      copySubscription: {
        findMany: jest.fn<(args: Prisma.CopySubscriptionFindManyArgs) => Promise<never[]>>().mockResolvedValue([]),
        count: jest.fn<(args: Prisma.CopySubscriptionCountArgs) => Promise<number>>().mockResolvedValue(0),
      },
    };
  }

  function commercialBuilder() {
    return {
      resolveBillingContext: jest.fn<(tenantId: string) => Promise<TenantBillingContext>>().mockImplementation(async () => context),
      build: jest.fn<(actor: EnforcementActor) => Promise<EnforcementContext>>()
        .mockImplementation(async (actor) => ({ tenant: context, actor })),
    };
  }

  function commercialEnforcement() {
    return {
      checkFeature: jest.fn<(ctx: EnforcementContext, featureKey: string, options?: { strict?: boolean }) => ReturnType<EnforcementService['checkFeature']>>()
        .mockImplementation(async (_ctx, featureKey) => ({ allowed: false, decision: EnforcementDecisionCode.FEATURE_NOT_INCLUDED, featureKey })),
    };
  }

  beforeEach(async () => {
    context = {
      tenantId: TENANT_A, subscriptionId: 'subscription-a', subscriptionStatus: SubscriptionStatus.ACTIVE, planId: 'plan-a', planCode: 'STANDARD',
      subscriptionActive: true, isLifetime: false, planFeatures: [],
      planLimits: { maxUsers: 10, maxTraders: 10, maxFollowersPerTrader: 10, maxExchangeAccountsPerUser: 10,
        maxCopySubscriptionsPerFollower: 10, maxApiRequestsPerMinute: 60, websocketConnections: 10,
        customDomain: false, whiteLabelMobileApp: false, prioritySupport: false },
    };
    db = commercialDatabase(); builder = commercialBuilder(); enforcement = commercialEnforcement();
    module = await Test.createTestingModule({ providers: [
      TenantFeatureAccessService, BillingUsageSummaryService,
      { provide: PrismaService, useValue: db },
      { provide: EnforcementContextBuilder, useValue: builder },
      { provide: EnforcementService, useValue: enforcement },
      { provide: SaasAdminAuditService, useValue: {} },
      { provide: SubscriptionsService, useValue: {
        getCurrent: jest.fn<(tenantId: string) => Promise<null>>().mockResolvedValue(null),
        getLimits: jest.fn<(tenantId: string) => Promise<TenantBillingContext['planLimits']>>()
          .mockImplementation(async () => context.planLimits),
      } },
    ] }).compile();
  });

  afterEach(async () => { await module.close(); jest.restoreAllMocks(); });

  it('discovers tenant feature keys through the related canonical FeatureFlag record', async () => {
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).getEffectiveFeatureAccess(TENANT_A);
    expect(result.map((feature) => feature.featureKey)).toContain('relatedFeatureKey');
    expect(result.every((feature) => typeof feature.featureKey === 'string')).toBe(true);
    expect(db.tenantFeatureFlag.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT_A }, include: { featureFlag: { select: { key: true } } } });
  });

  it('reports unavailable feature discovery instead of replacing configured flag evidence with an empty list', async () => {
    const failure = new Error('feature flags unavailable'); db.tenantFeatureFlag.findMany.mockRejectedValueOnce(failure);
    await expect(module.get<TenantFeatureAccessService>(TenantFeatureAccessService).getEffectiveFeatureAccess(TENANT_A)).rejects.toBe(failure);
  });

  it('uses complete, non-privileged internal enforcement context rather than asserting a partial actor', async () => {
    await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkFeatureAccess(TENANT_A, 'customDomain');
    expect(builder.build).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: 'system', roles: [], ipHash: '',
      requestId: 'feature-access-check', correlationId: 'feature-access-check' });
  });

  it('preserves inactive-subscription feature denial without invoking an access grant', async () => {
    context.subscriptionActive = false;
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkFeatureAccess(TENANT_A, 'customDomain');
    expect(result.enabled).toBe(false); expect(result.reason).toBe('Subscription inactive');
    expect(enforcement.checkFeature).not.toHaveBeenCalled();
  });

  it('does not interpret a numeric zero limit as unlimited', async () => {
    context.planLimits.maxUsers = 0;
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkLimitAccess(TENANT_A, 'maxUsers');
    expect(result.allowed).toBe(false); expect(result.limit).toBe(0); expect(result.current).toBe(3);
    expect(db.user.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_A, deletedAt: null } });
  });

  it('does not grant access for unrecognized numeric limit keys', async () => {
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkLimitAccess(TENANT_A, 'unreviewedLimit');
    expect(result.allowed).toBe(false); expect(result.reason).toBe('Unknown numeric limit key');
  });

  it('rejects malformed numeric values received at a cached policy boundary', async () => {
    Object.defineProperty(context.planLimits, 'maxUsers', { value: false, configurable: true });
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkLimitAccess(TENANT_A, 'maxUsers');
    expect(result.allowed).toBe(false); expect(result.reason).toBe('Invalid numeric plan limit');
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('retains the documented null unlimited numeric-limit policy', async () => {
    context.planLimits.maxUsers = null;
    const result = await module.get<TenantFeatureAccessService>(TenantFeatureAccessService).checkLimitAccess(TENANT_A, 'maxUsers');
    expect(result.allowed).toBe(true); expect(result.limit).toBeNull(); expect(result.remaining).toBeNull();
  });

  it('rejects malformed portal limits rather than claiming unvalidated usage capacity', async () => {
    Object.defineProperty(context.planLimits, 'maxUsers', { value: 'unvalidated-capacity', configurable: true });
    await expect(module.get<BillingUsageSummaryService>(BillingUsageSummaryService).getUsageSummary(TENANT_A))
      .rejects.toThrow('Invalid numeric portal plan limit');
  });

  it('propagates failed required portal usage reads instead of reporting a fabricated zero count', async () => {
    const failure = new Error('copy subscription count unavailable'); db.copySubscription.count.mockRejectedValueOnce(failure);
    await expect(module.get<BillingUsageSummaryService>(BillingUsageSummaryService).getUsageSummary(TENANT_A)).rejects.toBe(failure);
    expect(db.copySubscription.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_A } });
  });
});


// # Responsibility: retain tenant/policy/provider provenance with native model fixtures; these are direct units, not live legal/provider evidence.
const COMPLIANCE_USER = '33333333-3333-4333-8333-333333333333';

function complianceTenant(overrides: Partial<Tenant> = {}): Tenant {
  return { id: TENANT_A, slug: 'unit-tenant', name: 'Unit tenant', legalName: null, status: 'ACTIVE', ownerUserId: null,
    contactEmail: null, contactPhone: null, countryCode: null, defaultLocale: 'en', supportedLocales: ['en'], defaultCurrency: 'USD',
    supportedCurrencies: ['USD'], timezone: 'UTC', platformFeeBps: 0, performanceFeeBps: 2000, maxUsers: 10, maxTraders: null,
    metadata: {}, createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, deletedAt: null, ...overrides };
}

function compliancePolicyRecord(overrides: Partial<CompliancePolicyRecord> = {}): CompliancePolicyRecord {
  return { id: 'policy-1', tenantId: null, jurisdiction: 'DEFAULT', policyVersion: 'unit-policy-v1',
    kycRequired: true, amlRequired: true, sanctionsRequired: true, pepRequired: false, eddRequired: false,
    transactionThresholds: {}, riskThresholds: {}, highRiskCountries: [], blockedCountries: [], reverificationIntervalDays: 365,
    manualReviewRequired: false, rules: [], isActive: true, createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, ...overrides };
}

function screeningRecord(overrides: Partial<ComplianceScreeningRequest> = {}): ComplianceScreeningRequest {
  return { id: 'screening-1', tenantId: TENANT_A, userId: COMPLIANCE_USER, type: 'AML', provider: 'UNIT_AML', providerRef: 'unit-screen-ref',
    status: 'CLEAR', kycState: null, amlState: 'CLEAR', decision: 'ALLOW', riskLevel: 'LOW', idempotencyKey: 'screening-key',
    safeMetadata: {}, failureReason: null, createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, expiresAt: null, ...overrides };
}

function amlCaseRecord(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return { id: 'aml-case-1', tenantId: TENANT_A, userId: COMPLIANCE_USER, caseType: 'AML_SCREENING', state: 'OPEN', severity: 'MEDIUM',
    riskLevel: 'MEDIUM', decision: null, assignedTo: null, assignedAt: null, escalatedAt: null, resolvedAt: null, closedAt: null,
    idempotencyKey: 'aml-case-key', safeSummary: 'Unit case', jurisdiction: 'DEFAULT', policyVersion: 'unit-policy-v1', ruleIds: [],
    sourceRefs: [], metadata: {}, createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, ...overrides };
}

function riskRecord(overrides: Partial<RiskScoreRecord> = {}): RiskScoreRecord {
  return { id: 'risk-1', tenantId: TENANT_A, userId: COMPLIANCE_USER, score: 20, riskLevel: 'LOW', ruleIds: ['ACCOUNT_AGE'],
    policyVersion: 'unit-policy-v1', contributingFactors: { rules: [{ ruleId: 'ACCOUNT_AGE', weight: 15, score: 20, description: 'Age evidence' }],
      methodology: 'unit-weighted-method', jurisdiction: 'DEFAULT', totalWeight: 15 }, idempotencyKey: 'risk-key',
    calculatedAt: ANALYTICS_NOW, expiresAt: new Date('2026-10-11T12:00:00Z'), createdAt: ANALYTICS_NOW, ...overrides };
}

function kycRecord(overrides: Partial<KycProfile> = {}): KycProfile {
  return { id: 'kyc-1', tenantId: TENANT_A, userId: COMPLIANCE_USER, status: 'APPROVED', provider: 'unit-kyc', externalApplicantId: 'unit-applicant',
    levelName: null, submittedAt: ANALYTICS_NOW, reviewedAt: ANALYTICS_NOW, expiresAt: null, rejectionReason: null, riskScore: null,
    metadata: {}, createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, ...overrides };
}

function traderRecord(overrides: Partial<TraderProfile> = {}): TraderProfile {
  return { id: 'trader-1', tenantId: TENANT_A, userId: COMPLIANCE_USER, displayName: 'Unit trader', bio: null, avatarUrl: null,
    verificationState: 'UNVERIFIED', verifiedAt: null, verifiedById: null, supportedVenues: ['BINANCE'], supportedSymbols: ['BTC-USDT'],
    riskProfile: {}, isPublic: false, isFeatured: false, followerCount: 0, totalVolume: '0', totalTrades: 0,
    createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, deletedAt: null, ...overrides };
}

function traderStrategyRecord(overrides: Partial<TraderStrategy> = {}): TraderStrategy {
  return { id: 'strategy-1', tenantId: TENANT_A, traderId: 'trader-1', userId: COMPLIANCE_USER, name: 'Unit strategy', description: null,
    status: 'DRAFT', type: 'MANUAL', supportedSymbols: ['BTC-USDT'], supportedVenues: ['BINANCE'], riskProfile: {}, feePolicy: {}, strategyConfig: {},
    publishedAt: null, pausedAt: null, archivedAt: null, validationErrors: null, followerCount: 0, totalCopies: 0, idempotencyKey: null,
    createdAt: ANALYTICS_NOW, updatedAt: ANALYTICS_NOW, deletedAt: null, ...overrides };
}

describe('Canonical compliance policy resolution', () => {
  let module: TestingModule;
  let policies: CompliancePolicyRecord[];
  let tenant: Tenant;
  const db = {
    compliancePolicyRecord: { findFirst: jest.fn<(args: Prisma.CompliancePolicyRecordFindFirstArgs) => Promise<CompliancePolicyRecord | null>>(),
      findMany: jest.fn<(args: Prisma.CompliancePolicyRecordFindManyArgs) => Promise<CompliancePolicyRecord[]>>(),
      create: jest.fn<(args: Prisma.CompliancePolicyRecordCreateArgs) => Promise<CompliancePolicyRecord>>(),
      update: jest.fn<(args: Prisma.CompliancePolicyRecordUpdateArgs) => Promise<CompliancePolicyRecord>>() },
    tenant: { findUnique: jest.fn<(args: Prisma.TenantFindUniqueArgs) => Promise<Pick<Tenant, 'countryCode'> | null>>() },
  };
  beforeEach(async () => {
    policies = []; tenant = complianceTenant();
    db.compliancePolicyRecord.findFirst.mockReset().mockImplementation(async (args) => policies.find((record) => rowMatches(record, args.where)) ?? null);
    db.compliancePolicyRecord.findMany.mockReset().mockImplementation(async (args) => policies.filter((record) => rowMatches(record, args.where)));
    db.compliancePolicyRecord.create.mockReset().mockResolvedValue(compliancePolicyRecord());
    db.compliancePolicyRecord.update.mockReset().mockResolvedValue(compliancePolicyRecord());
    db.tenant.findUnique.mockReset().mockImplementation(async () => ({ countryCode: tenant.countryCode }));
    module = await Test.createTestingModule({ providers: [CompliancePolicyService, { provide: PrismaService, useValue: db }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<CompliancePolicyService>(CompliancePolicyService); }
  it('returns configured defaults only after successful reads confirm there is no applicable policy', async () => {
    expect(await service().getEffectivePolicy({ tenantId: TENANT_A })).toMatchObject({ id: 'default_platform_policy', tenantId: null, jurisdiction: 'DEFAULT' });
    expect(db.compliancePolicyRecord.findFirst.mock.calls.every(([args]) => args.where?.tenantId === TENANT_A || args.where?.tenantId === null)).toBe(true);
  });
  it('does not select another tenant policy as the platform/global fallback', async () => {
    policies.push(compliancePolicyRecord({ tenantId: TENANT_B, id: 'other-tenant-policy' }));
    expect((await service().getEffectivePolicy({ tenantId: TENANT_A })).id).toBe('default_platform_policy');
  });
  it('selects a matching tenant policy without falling through to a platform policy', async () => {
    policies.push(compliancePolicyRecord({ tenantId: TENANT_A, id: 'own-policy' }), compliancePolicyRecord({ id: 'platform-policy' }));
    expect((await service().getEffectivePolicy({ tenantId: TENANT_A })).id).toBe('own-policy');
  });
  it('retains configured two-letter country policies outside the short named-region enum without cross-tenant fallback', async () => {
    tenant.countryCode = 'BD';
    policies.push(compliancePolicyRecord({ id: 'other-bd-policy', tenantId: TENANT_B, jurisdiction: 'BD' }),
      compliancePolicyRecord({ id: 'platform-bd-policy', jurisdiction: 'BD' }));
    expect(await service().getEffectivePolicy({ tenantId: TENANT_A })).toMatchObject({ id: 'platform-bd-policy', tenantId: null, jurisdiction: 'BD' });
    expect(db.compliancePolicyRecord.findFirst).toHaveBeenCalledWith({ where: { tenantId: null, jurisdiction: 'BD', isActive: true }, orderBy: { createdAt: 'desc' } });
  });
  it('does not downgrade a failed policy read to a successful configured-default lookup', async () => {
    const failure = new Error('policy database unavailable'); db.compliancePolicyRecord.findFirst.mockRejectedValueOnce(failure);
    await expect(service().getEffectivePolicy({ tenantId: TENANT_A })).rejects.toBe(failure);
  });
  it('does not report a policy update when required persistence failed', async () => {
    const failure = new Error('policy write unavailable'); db.compliancePolicyRecord.create.mockRejectedValueOnce(failure);
    await expect(service().createOrUpdatePolicy({ tenantId: TENANT_A, jurisdiction: 'DEFAULT', policyVersion: 'v2', actorId: COMPLIANCE_USER })).rejects.toBe(failure);
  });
  it('binds an existing policy update to both its id and tenant', async () => {
    policies.push(compliancePolicyRecord({ tenantId: TENANT_A }));
    await service().createOrUpdatePolicy({ tenantId: TENANT_A, jurisdiction: 'DEFAULT', policyVersion: 'unit-policy-v1', actorId: COMPLIANCE_USER });
    expect(db.compliancePolicyRecord.update).toHaveBeenCalledWith({ where: { id: 'policy-1', tenantId: TENANT_A }, data: expect.objectContaining({ tenantId: TENANT_A }) });
  });
  it.each([[], 'invalid', null])('does not reinterpret malformed persisted risk thresholds %s as configured defaults', async (riskThresholds) => {
    policies.push(compliancePolicyRecord({ riskThresholds }));
    await expect(service().getPlatformPolicy()).rejects.toThrow('risk thresholds must be an object');
  });
  it('rejects inverted persisted risk thresholds rather than legitimizing a permissive scoring scale', async () => {
    policies.push(compliancePolicyRecord({ riskThresholds: { lowMax: 80, mediumMax: 20 } }));
    await expect(service().getPlatformPolicy()).rejects.toThrow('thresholds must be ordered');
  });
  it('does not share mutable default rules/country arrays between separate requests', async () => {
    const first = await service().getPlatformPolicy(); first.rules.splice(0); first.blockedCountries.push('US');
    const second = await service().getPlatformPolicy(); expect(second.rules.length).toBeGreaterThan(0); expect(second.blockedCountries).not.toContain('US');
  });
  it('retains array structure while redacting nested metadata and refuses non-finite/circular JSON evidence', () => {
    expect(sanitizeMetadata({ entries: [{ privateKey: 'not-a-real-secret', note: 'safe' }] })).toEqual({ entries: [{ privateKey: '[REDACTED]', note: 'safe' }] });
    expect(() => complianceJsonInput({ score: Number.POSITIVE_INFINITY })).toThrow('Non-finite');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => complianceJsonInput(cycle)).toThrow('Circular');
  });
});

describe('AML durable result and replay boundaries', () => {
  let module: TestingModule;
  let outcome: AmlScreeningResult;
  let available: boolean;
  const db = { complianceScreeningRequest: {
    findFirst: jest.fn<(args: Prisma.ComplianceScreeningRequestFindFirstArgs) => Promise<ComplianceScreeningRequest | null>>(),
    create: jest.fn<(args: Prisma.ComplianceScreeningRequestCreateArgs) => Promise<ComplianceScreeningRequest>>() } };
  const caseRepository = { createCase: jest.fn<(input: Parameters<ComplianceCaseRepository['createCase']>[0]) => Promise<ComplianceCase | null>>() };
  const audit = { record: jest.fn<ComplianceAuditService['record']>(), recordAmlClear: jest.fn<ComplianceAuditService['recordAmlClear']>(),
    recordAmlStarted: jest.fn<ComplianceAuditService['recordAmlStarted']>(), recordAmlPotentialMatch: jest.fn<ComplianceAuditService['recordAmlPotentialMatch']>(),
    recordAmlMatch: jest.fn<ComplianceAuditService['recordAmlMatch']>(), recordAmlBlocked: jest.fn<ComplianceAuditService['recordAmlBlocked']>() };
  const provider: IAmlProvider = {
    providerName: 'UNIT_AML', supportedJurisdictions: ['DEFAULT'], capabilities: { personScreening: true, entityScreening: true,
      transactionScreening: true, sanctions: true, pep: true, adverseMedia: false }, isAvailable: () => available,
    screenPerson: jest.fn<IAmlProvider['screenPerson']>().mockImplementation(async () => outcome),
    screenEntity: async () => outcome,
    screenTransaction: jest.fn<IAmlProvider['screenTransaction']>().mockImplementation(async () => outcome),
    getScreeningResult: async () => outcome,
    rescreen: jest.fn<IAmlProvider['rescreen']>().mockImplementation(async () => outcome),
  };
  const params = { tenantId: TENANT_A, userId: COMPLIANCE_USER, idempotencyKey: 'screening-key' };
  beforeEach(async () => {
    available = true; outcome = { provider: 'UNIT_AML', providerReference: 'unit-screen-ref', status: AmlState.CLEAR,
      decision: ComplianceDecision.ALLOW, riskLevel: RiskLevel.LOW, screenedAt: ANALYTICS_NOW.toISOString(), safeMetadata: {} };
    db.complianceScreeningRequest.findFirst.mockReset().mockResolvedValue(null); db.complianceScreeningRequest.create.mockReset().mockResolvedValue(screeningRecord());
    caseRepository.createCase.mockReset().mockResolvedValue(amlCaseRecord());
    for (const method of Object.values(audit)) method.mockReset().mockResolvedValue(undefined);
    jest.mocked(provider.screenPerson).mockClear(); jest.mocked(provider.screenTransaction).mockClear(); jest.mocked(provider.rescreen).mockClear();
    module = await Test.createTestingModule({ providers: [AmlScreeningService, CompliancePolicyService,
      { provide: PrismaService, useValue: { ...db, compliancePolicyRecord: { findFirst: async () => null }, tenant: { findUnique: async () => ({ countryCode: null }) } } },
      { provide: AmlProviderFactory, useValue: { getConfiguredProvider: () => provider } },
      { provide: ComplianceAuditService, useValue: audit }, { provide: ComplianceCaseRepository, useValue: caseRepository },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<AmlScreeningService>(AmlScreeningService); }
  it('propagates idempotency-read failure before calling the provider or creating a duplicate record', async () => {
    const failure = new Error('screening lookup unavailable'); db.complianceScreeningRequest.findFirst.mockRejectedValueOnce(failure);
    await expect(service().screenPerson(params)).rejects.toBe(failure); expect(provider.screenPerson).not.toHaveBeenCalled(); expect(db.complianceScreeningRequest.create).not.toHaveBeenCalled();
  });
  it('rejects an idempotency key owned by another user in the same tenant', async () => {
    db.complianceScreeningRequest.findFirst.mockResolvedValueOnce(screeningRecord({ userId: 'other-user' }));
    await expect(service().screenPerson(params)).rejects.toThrow('different user or screening type'); expect(provider.screenPerson).not.toHaveBeenCalled();
  });
  it('does not report a CLEAR/ALLOW result after required screening persistence failed', async () => {
    const failure = new Error('screening write unavailable'); db.complianceScreeningRequest.create.mockRejectedValueOnce(failure);
    await expect(service().screenPerson(params)).rejects.toBe(failure); expect(audit.recordAmlClear).not.toHaveBeenCalled();
  });
  it('records provider unavailability durably and never promotes it to CLEAR', async () => {
    available = false; db.complianceScreeningRequest.create.mockResolvedValueOnce(screeningRecord({ provider: 'UNAVAILABLE', providerRef: 'unavailable-ref',
      amlState: 'PROVIDER_UNAVAILABLE', decision: 'PENDING', riskLevel: 'UNKNOWN', status: 'PENDING' }));
    expect(await service().screenPerson(params)).toMatchObject({ status: AmlState.PROVIDER_UNAVAILABLE, decision: ComplianceDecision.PENDING });
    expect(db.complianceScreeningRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: TENANT_A, userId: COMPLIANCE_USER,
      amlState: 'PROVIDER_UNAVAILABLE', decision: 'PENDING', status: 'PENDING' }) }); expect(provider.screenPerson).not.toHaveBeenCalled();
  });
  it('propagates required unavailability persistence failure instead of fabricating a recorded response', async () => {
    available = false; const failure = new Error('unavailability record write failed'); db.complianceScreeningRequest.create.mockRejectedValueOnce(failure);
    await expect(service().screenPerson(params)).rejects.toBe(failure);
  });
  it('requires the review case before a matching provider outcome is stored as a completed screening response', async () => {
    outcome = { ...outcome, status: AmlState.MATCH, decision: ComplianceDecision.BLOCK, riskLevel: RiskLevel.CRITICAL };
    const failure = new Error('review case unavailable'); caseRepository.createCase.mockRejectedValueOnce(failure);
    await expect(service().screenPerson(params)).rejects.toBe(failure); expect(db.complianceScreeningRequest.create).not.toHaveBeenCalled();
  });
  it('rejects a missing durable review-case acknowledgement', async () => {
    outcome = { ...outcome, status: AmlState.REVIEW_REQUIRED, decision: ComplianceDecision.REVIEW_REQUIRED };
    caseRepository.createCase.mockResolvedValueOnce(null);
    await expect(service().screenPerson(params)).rejects.toThrow('no durable tenant-bound record'); expect(db.complianceScreeningRequest.create).not.toHaveBeenCalled();
  });
  it('retains an honestly absent AML status but never treats a failed read as NOT_SCREENED', async () => {
    expect(await service().getStatus(params)).toMatchObject({ amlState: AmlState.NOT_SCREENED, decision: ComplianceDecision.PENDING });
    const failure = new Error('status unavailable'); db.complianceScreeningRequest.findFirst.mockRejectedValueOnce(failure);
    await expect(service().getStatus(params)).rejects.toBe(failure);
  });
  it('reads persisted AML status only within the selected tenant/user and AML screening types', async () => {
    db.complianceScreeningRequest.findFirst.mockResolvedValueOnce(screeningRecord());
    expect(await service().getStatus({ ...params, providerReference: 'unit-screen-ref' })).toMatchObject({ amlState: AmlState.CLEAR,
      screenedAt: ANALYTICS_NOW.toISOString() });
    expect(db.complianceScreeningRequest.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT_A, userId: COMPLIANCE_USER,
      type: { in: ['AML', 'TRANSACTION', 'AML_RESCREEN'] }, providerRef: 'unit-screen-ref' }, orderBy: { createdAt: 'desc' } });
  });
  it('does not rescreen an unowned provider reference', async () => {
    await expect(service().rescreen({ ...params, providerReference: 'other-reference' })).rejects.toThrow('not found for this tenant and user');
    expect(provider.rescreen).not.toHaveBeenCalled();
  });
  it('does not forward raw counterparty text to the provider-neutral transaction contract', async () => {
    db.complianceScreeningRequest.create.mockResolvedValueOnce(screeningRecord({ type: 'TRANSACTION' }));
    await service().screenTransaction({ ...params, transactionId: 'tx-1', transactionType: 'withdrawal', amount: '20', currency: 'USD', counterparty: 'raw-private-counterparty' });
    const call = jest.mocked(provider.screenTransaction).mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('counterparty'); expect(call?.counterpartyHash).toMatch(/^hash_/);
    expect(db.complianceScreeningRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ safeMetadata: {
      screeningSubject: { transactionId: 'tx-1', transactionType: 'withdrawal', amount: '20', currency: 'USD' } } }) });
  });
  it('rejects replaying a transaction idempotency key with a changed transaction payload', async () => {
    db.complianceScreeningRequest.findFirst.mockResolvedValueOnce(screeningRecord({ type: 'TRANSACTION', safeMetadata: {
      screeningSubject: { transactionId: 'tx-1', transactionType: 'withdrawal', amount: '20', currency: 'USD' } } }));
    await expect(service().screenTransaction({ ...params, transactionId: 'tx-1', transactionType: 'withdrawal', amount: '200', currency: 'USD' }))
      .rejects.toThrow('does not match the transaction payload'); expect(provider.screenTransaction).not.toHaveBeenCalled();
  });
});

describe('Risk-score canonical persistence and provenance', () => {
  let module: TestingModule;
  const db = {
    compliancePolicyRecord: { findFirst: jest.fn<(args: Prisma.CompliancePolicyRecordFindFirstArgs) => Promise<CompliancePolicyRecord | null>>() },
    tenant: { findUnique: jest.fn<(args: Prisma.TenantFindUniqueArgs) => Promise<Pick<Tenant, 'countryCode'> | null>>() },
    user: { findFirst: jest.fn<(args: Prisma.UserFindFirstArgs) => Promise<Prisma.UserGetPayload<{ select: { createdAt: true; profile: { select: { countryCode: true } } } }> | null>>() },
    kycProfile: { findFirst: jest.fn<(args: Prisma.KycProfileFindFirstArgs) => Promise<KycProfile | null>>() },
    complianceScreeningRequest: { findMany: jest.fn<(args: Prisma.ComplianceScreeningRequestFindManyArgs) => Promise<ComplianceScreeningRequest[]>>(),
      count: jest.fn<(args: Prisma.ComplianceScreeningRequestCountArgs) => Promise<number>>() },
    transactionMonitoringSignal: { findMany: jest.fn<(args: Prisma.TransactionMonitoringSignalFindManyArgs) => Promise<[]>>() },
    riskScoreRecord: { findFirst: jest.fn<(args: Prisma.RiskScoreRecordFindFirstArgs) => Promise<RiskScoreRecord | null>>(),
      create: jest.fn<(args: Prisma.RiskScoreRecordCreateArgs) => Promise<RiskScoreRecord>>() },
  };
  const audit = { recordRiskScoreCalculated: jest.fn<ComplianceAuditService['recordRiskScoreCalculated']>() };
  beforeEach(async () => {
    db.compliancePolicyRecord.findFirst.mockReset().mockResolvedValue(null); db.tenant.findUnique.mockReset().mockResolvedValue({ countryCode: null });
    db.user.findFirst.mockReset().mockResolvedValue({ createdAt: new Date('2025-01-01'), profile: { countryCode: 'US' } });
    db.kycProfile.findFirst.mockReset().mockResolvedValue(kycRecord()); db.complianceScreeningRequest.findMany.mockReset().mockResolvedValue([screeningRecord()]);
    db.complianceScreeningRequest.count.mockReset().mockResolvedValue(0); db.transactionMonitoringSignal.findMany.mockReset().mockResolvedValue([]);
    db.riskScoreRecord.findFirst.mockReset().mockResolvedValue(riskRecord()); db.riskScoreRecord.create.mockReset().mockResolvedValue(riskRecord());
    audit.recordRiskScoreCalculated.mockReset().mockResolvedValue(undefined);
    module = await Test.createTestingModule({ providers: [RiskScoringService, CompliancePolicyService,
      { provide: PrismaService, useValue: db }, { provide: ComplianceAuditService, useValue: audit },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<RiskScoringService>(RiskScoringService); }
  const params = { tenantId: TENANT_A, userId: COMPLIANCE_USER, idempotencyKey: 'unit-risk-key' };
  it('requires tenant-bound user and KYC reads before deriving a risk score', async () => {
    await service().calculateRiskScore(params);
    expect(db.kycProfile.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT_A, userId: COMPLIANCE_USER } });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: COMPLIANCE_USER, tenantId: TENANT_A },
      select: { createdAt: true, profile: { select: { countryCode: true } } } });
  });
  it('refuses to score a user that is absent from the requested tenant', async () => {
    db.user.findFirst.mockResolvedValueOnce(null);
    await expect(service().calculateRiskScore(params)).rejects.toThrow('not found for this tenant'); expect(db.riskScoreRecord.create).not.toHaveBeenCalled();
  });
  it('does not return or audit a successfully calculated score when required persistence failed', async () => {
    const failure = new Error('risk evidence unavailable'); db.riskScoreRecord.create.mockRejectedValueOnce(failure);
    await expect(service().calculateRiskScore(params)).rejects.toBe(failure); expect(audit.recordRiskScoreCalculated).not.toHaveBeenCalled();
  });
  it('reconstructs rules and methodology from the actual contributingFactors JSON column', async () => {
    expect(await service().getLatestScore(TENANT_A, COMPLIANCE_USER)).toMatchObject({ score: 20, riskLevel: RiskLevel.LOW,
      methodology: 'unit-weighted-method', contributingRules: [{ ruleId: 'ACCOUNT_AGE', weight: 15, score: 20, description: 'Age evidence' }] });
  });
  it.each([[], {}, { rules: [], methodology: 17 }])('refuses missing/malformed stored risk provenance %s', async (contributingFactors) => {
    db.riskScoreRecord.findFirst.mockResolvedValueOnce(riskRecord({ contributingFactors }));
    await expect(service().getLatestScore(TENANT_A, COMPLIANCE_USER)).rejects.toThrow('provenance');
  });
  it('refuses malformed rule provenance rather than reporting empty rules with an invented methodology', async () => {
    db.riskScoreRecord.findFirst.mockResolvedValueOnce(riskRecord({ contributingFactors: { methodology: 'stored', rules: [{ ruleId: 'bad', weight: 'unknown', score: 20 }] } }));
    await expect(service().getLatestScore(TENANT_A, COMPLIANCE_USER)).rejects.toThrow('rule provenance');
  });
});

describe('Strategy runtime metadata and required policy evidence', () => {
  let module: TestingModule;
  const db = {
    traderProfile: { findFirst: jest.fn<(args: Prisma.TraderProfileFindFirstArgs) => Promise<TraderProfile | null>>(), count: jest.fn<(args: Prisma.TraderProfileCountArgs) => Promise<number>>() },
    traderStrategy: { findFirst: jest.fn<(args: Prisma.TraderStrategyFindFirstArgs) => Promise<TraderStrategy | null>>() },
    tradingSymbol: { findFirst: jest.fn<(args: Prisma.TradingSymbolFindFirstArgs) => Promise<null>>() },
    tradingAccount: { findMany: jest.fn<(args: Prisma.TradingAccountFindManyArgs) => Promise<[]>>() },
    complianceCase: { findFirst: jest.fn<(args: Prisma.ComplianceCaseFindFirstArgs) => Promise<ComplianceCase | null>>() },
    tenant: { findFirst: jest.fn<(args: Prisma.TenantFindFirstArgs) => Promise<Tenant | null>>() },
    killSwitch: { findMany: jest.fn<(args: Prisma.KillSwitchFindManyArgs) => Promise<[]>>() },
  };
  const input: StrategyValidationInput = { tenantId: TENANT_A, traderId: 'trader-1', userId: COMPLIANCE_USER,
    name: 'Unit strategy', type: TraderStrategyType.MANUAL, supportedSymbols: ['BTC-USDT'], supportedVenues: ['BINANCE'] };
  beforeEach(async () => {
    db.traderProfile.findFirst.mockReset().mockResolvedValue(traderRecord()); db.traderProfile.count.mockReset().mockResolvedValue(1);
    db.traderStrategy.findFirst.mockReset().mockResolvedValue(traderStrategyRecord()); db.tradingSymbol.findFirst.mockReset().mockResolvedValue(null);
    db.tradingAccount.findMany.mockReset().mockResolvedValue([]); db.complianceCase.findFirst.mockReset().mockResolvedValue(null);
    db.tenant.findFirst.mockReset().mockResolvedValue(complianceTenant()); db.killSwitch.findMany.mockReset().mockResolvedValue([]);
    module = await Test.createTestingModule({ providers: [StrategyValidationService, ExchangeRegistryService, { provide: PrismaService, useValue: db }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<StrategyValidationService>(StrategyValidationService); }
  it('uses the tenant and requesting user to verify trader ownership', async () => {
    db.traderProfile.findFirst.mockResolvedValueOnce(traderRecord({ userId: 'other-user' }));
    const result = await service().validate(input); expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('TRADER_OWNERSHIP_MISMATCH');
    expect(db.traderProfile.findFirst).toHaveBeenCalledWith({ where: { id: 'trader-1', tenantId: TENANT_A } });
  });
  it.each(['MARKET', [1], { order: 'MARKET' }])('rejects untyped orderTypes %s rather than iterating/coercing unsupported input', async (orderTypes) => {
    const result = await service().validate({ ...input, strategyConfig: { orderTypes } });
    expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('INVALID_ORDER_TYPES');
  });
  it('does not silently downgrade an unsupported exchange order type', async () => {
    const result = await service().validate({ ...input, strategyConfig: { orderTypes: ['UNSUPPORTED'] } });
    expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('UNSUPPORTED_ORDER_TYPE');
  });
  it.each(['0', '-2', '5suffix', 5, false])('refuses permissive/partially parsed risk decimals %s', async (maxOrderQuantity) => {
    const result = await service().validate({ ...input, riskProfile: { maxOrderQuantity } });
    expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('INVALID_DECIMAL');
  });
  it('propagates a failed required compliance read instead of treating it as no blocking case', async () => {
    const failure = new Error('blocking compliance evidence unavailable'); db.complianceCase.findFirst.mockRejectedValueOnce(failure);
    await expect(service().validate(input)).rejects.toBe(failure);
  });
  it('queries specifically for blocking open compliance cases, not an arbitrary first case', async () => {
    db.complianceCase.findFirst.mockResolvedValueOnce(amlCaseRecord({ decision: 'BLOCK' }));
    const result = await service().validate(input); expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('COMPLIANCE_BLOCKED');
    expect(db.complianceCase.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT_A, userId: COMPLIANCE_USER,
      state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] }, decision: 'BLOCK' } });
  });
  it('propagates a failed required trader-limit count rather than using zero', async () => {
    db.tenant.findFirst.mockResolvedValueOnce(complianceTenant({ maxTraders: 1 }));
    const failure = new Error('trader count unavailable'); db.traderProfile.count.mockRejectedValueOnce(failure);
    await expect(service().validate(input)).rejects.toBe(failure);
  });
  it('does not publish a malformed persisted JSON configuration', async () => {
    db.traderStrategy.findFirst.mockResolvedValueOnce(traderStrategyRecord({ strategyConfig: [] }));
    const result = await service().validateForPublication(TENANT_A, 'strategy-1');
    expect(result.valid).toBe(false); expect(result.errors.map((error) => error.code)).toContain('INVALID_PERSISTED_CONFIGURATION');
  });
});

describe('KYC adapter availability is not established by credentials alone', () => {
  const keys = ['KYC_PROVIDER', 'SUMSUB_API_KEY', 'JUMIO_API_TOKEN', 'ONFIDO_API_TOKEN'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = Object.fromEntries(keys.map((key) => [key, process.env[key]])); });
  afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  it.each([['SUMSUB', 'SUMSUB_API_KEY'], ['JUMIO', 'JUMIO_API_TOKEN'], ['ONFIDO', 'ONFIDO_API_TOKEN']])('does not relabel a mock as a real available %s provider', (name, key) => {
    process.env.KYC_PROVIDER = name; process.env[key] = 'unit-noncredential';
    const factory = new KycProviderFactory(); expect(factory.isProviderAvailable()).toBe(false);
    expect(factory.getConfiguredProvider().providerName).toBe('UNAVAILABLE'); expect(factory.listAvailableProviders()).not.toContain(name);
  });
  it('retains explicitly selected mock KYC as a pending development provider, never VERIFIED evidence', async () => {
    process.env.KYC_PROVIDER = 'MOCK';
    const provider = new KycProviderFactory().getConfiguredProvider();
    const result = await provider.getVerificationStatus({ tenantId: TENANT_A, userId: COMPLIANCE_USER, providerReference: 'unit-ref' });
    expect(result.status).toBe(KycState.PENDING); expect(result.decision).toBe(ComplianceDecision.PENDING);
  });
});
