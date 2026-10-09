// # NEW — Executes catalog producers through tenant transactions and the real outbox writer

import { InvoiceRepository } from '../../modules/billing/finance/invoice.repository';
import { PaymentRepository } from '../../modules/billing/payments/payment.repository';
import { PaymentStatus } from '../../modules/billing/payments/payment.types';
import { SubscriptionsService } from '../../modules/billing/subscriptions.service';
import { FeeSettlementService } from '../../modules/billing/fees/fee-settlement.service';
import { PayoutRepository } from '../../modules/billing/fees/payout.repository';
import { PayoutStatus } from '../../modules/billing/fees/payout.types';
import { FundingRequestService } from '../../modules/client-lifecycle/funding-request.service';
import { WithdrawalRequestService } from '../../modules/client-lifecycle/withdrawal-request.service';
import { FundingRequestState, WithdrawalRequestState } from '../../modules/client-lifecycle/client-lifecycle.types';
import { validateDeveloperEventPayload } from '../../modules/developer-platform/event-schemas/developer-event-schemas';
import { KillSwitchOrchestratorService, KillSwitchRequestScope } from '../../modules/risk-management/kill-switch-orchestrator.service';
import { RiskDecisionService } from '../../modules/risk-management/risk-decision.service';
import { RiskState } from '../../modules/risk-management/risk-management.types';
import { TenantsService } from '../../modules/tenants/tenants.service';
import { OutboxService } from './outbox.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const FIXED_TIME = new Date('2026-10-09T00:00:00.000Z');

interface StoredOutboxEvent {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSequence: number;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId: string | null;
  createdAt: Date;
  status: string;
}

interface FakeOutboxTransaction {
  $queryRaw: jest.Mock;
  outboxEvent: {
    aggregate: jest.Mock;
    upsert: jest.Mock;
  };
  [key: string]: unknown;
}

interface OutboxHarness {
  tx: FakeOutboxTransaction;
  rows: StoredOutboxEvent[];
  service: OutboxService;
}

function makeOutboxHarness(): OutboxHarness {
  const rows: StoredOutboxEvent[] = [];
  const tx: FakeOutboxTransaction = {
    $queryRaw: jest.fn(async () => []),
    outboxEvent: {
      aggregate: jest.fn(async (query: Record<string, unknown>) => {
        const where = query.where as { tenantId: string; aggregateType: string; aggregateId: string };
        const matching = rows.filter((row) =>
          row.tenantId === where.tenantId &&
          row.aggregateType === where.aggregateType &&
          row.aggregateId === where.aggregateId,
        );
        const maximum = matching.length === 0
          ? null
          : Math.max(...matching.map((row) => row.aggregateSequence));
        return { _max: { aggregateSequence: maximum } };
      }),
      upsert: jest.fn(async (query: Record<string, unknown>) => {
        const where = query.where as { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } };
        const existing = rows.find((row) =>
          row.tenantId === where.tenantId_idempotencyKey.tenantId &&
          row.idempotencyKey === where.tenantId_idempotencyKey.idempotencyKey,
        );
        if (existing) return existing;
        const create = query.create as Omit<StoredOutboxEvent, 'id' | 'status'>;
        const stored = {
          ...create,
          id: `outbox-event-${rows.length + 1}`,
          status: 'PENDING',
        } as StoredOutboxEvent;
        rows.push(stored);
        return stored;
      }),
    },
  };
  return { tx, rows, service: new OutboxService() };
}

function expectStoredEvent(harness: OutboxHarness, eventType: string): StoredOutboxEvent {
  const event = harness.rows.find((row) => row.eventType === eventType);
  expect(event).toBeDefined();
  expect(event?.tenantId).toBe(TENANT_ID);
  expect(event?.status).toBe('PENDING');
  expect(validateDeveloperEventPayload(eventType, event?.payload)).toEqual({ valid: true, errors: [] });
  return event as StoredOutboxEvent;
}

function tenantTransaction(harness: OutboxHarness) {
  return jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => work(harness.tx));
}

function tenantContext(requestId: string) {
  return { actorId: 'admin-1', ipHash: 'ip-hash-1', requestId };
}

function makeTenantDto(id: string, name: string) {
  return {
    id,
    slug: 'brand-one',
    name,
    legalName: null,
    status: 'ACTIVE',
    ownerUserId: null,
    defaultLocale: 'en',
    supportedLocales: ['en'],
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD'],
    timezone: 'UTC',
    contactEmail: 'ops@example.com',
    contactPhone: null,
    countryCode: 'BD',
    platformFeeBps: 0,
    performanceFeeBps: 0,
    maxUsers: null,
    maxTraders: null,
    branding: null,
    domains: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    deletedAt: null,
  };
}

function makeSubscriptionRecord(id: string, plan: Record<string, unknown>, status = 'ACTIVE') {
  return {
    id,
    tenantId: TENANT_ID,
    planId: plan.id,
    status,
    currentPeriodStart: FIXED_TIME,
    currentPeriodEnd: new Date('2026-11-09T00:00:00.000Z'),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelReason: null,
    externalCustomerId: null,
    externalSubscriptionId: null,
    seatsPurchased: 1,
    metadata: {},
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    plan,
  };
}

function makeSubscriptionsService(prisma: Record<string, unknown>, outbox: OutboxService) {
  const plans = { toDto: jest.fn(() => ({})) };
  const audit = { recordImmediate: jest.fn(async () => undefined) };
  const notifications = { enqueueTransactional: jest.fn(async () => undefined) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new SubscriptionsService(
    prisma as never,
    plans as never,
    audit as never,
    notifications as never,
    logger as never,
    undefined,
    outbox,
  );
  (service as unknown as { toDto: jest.Mock }).toDto = jest.fn(() => ({}));
  return { service, plans, audit, notifications };
}

describe('catalog domain producers persist schema-valid events with the real OutboxService', () => {
  it('persists customer.created in the tenant-provisioning transaction', async () => {
    const harness = makeOutboxHarness();
    const createdTenant = { id: TENANT_ID, slug: 'brand-one' };
    const tenantDelegate = { create: jest.fn(async () => createdTenant) };
    Object.assign(harness.tx, {
      tenant: tenantDelegate,
      role: { create: jest.fn(async () => undefined) },
      $executeRaw: jest.fn(async () => undefined),
    });
    const tenantDto = makeTenantDto(TENANT_ID, 'Brand One');
    const prisma = {
      tenant: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => tenantDto),
      },
      role: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(harness.tx)),
    };
    const resolver = { invalidate: jest.fn(async () => undefined) };
    const audit = {
      recordImmediate: jest.fn(async () => undefined),
      record: jest.fn(async () => undefined),
    };
    const featureFlags = { applyDefaultsForTenant: jest.fn(async () => undefined) };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new TenantsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      resolver as never,
      audit as never,
      featureFlags as never,
      logger as never,
      harness.service,
    );
    jest.spyOn(service, 'findById').mockResolvedValue(tenantDto as never);

    await service.create({
      slug: 'brand-one',
      name: 'Brand One',
      contactEmail: 'ops@example.com',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrency: 'USD',
      supportedCurrencies: ['USD'],
      timezone: 'UTC',
      platformFeeBps: 0,
      performanceFeeBps: 0,
    } as never, tenantContext('tenant-create-request'));

    const event = expectStoredEvent(harness, 'customer.created');
    expect(event.aggregateType).toBe('customer');
    expect(event.aggregateId).toBe(TENANT_ID);
    expect(event.payload).toEqual({ customerId: TENANT_ID });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tenantDelegate.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists customer.updated in the tenant update transaction', async () => {
    const harness = makeOutboxHarness();
    const before = makeTenantDto(TENANT_ID, 'Brand One');
    const updated = makeTenantDto(TENANT_ID, 'Brand One Updated');
    const tenantDelegate = { update: jest.fn(async () => updated) };
    Object.assign(harness.tx, { tenant: tenantDelegate });
    const prisma = {
      tenant: { findFirst: jest.fn(async () => before) },
      withTenantRls: tenantTransaction(harness),
    };
    const resolver = { invalidate: jest.fn(async () => undefined) };
    const audit = {
      record: jest.fn(async () => undefined),
      recordImmediate: jest.fn(async () => undefined),
    };
    const service = new TenantsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      resolver as never,
      audit as never,
      { applyDefaultsForTenant: jest.fn(async () => undefined) } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      harness.service,
    );
    (service as unknown as { toDto: jest.Mock }).toDto = jest.fn(() => ({ id: TENANT_ID }));

    await service.update(TENANT_ID, { name: 'Brand One Updated' } as never, tenantContext('tenant-update-request'));

    const event = expectStoredEvent(harness, 'customer.updated');
    expect(event.payload).toEqual({ customerId: TENANT_ID });
    expect(tenantDelegate.update).toHaveBeenCalledTimes(1);
    expect(resolver.invalidate).toHaveBeenCalledWith(TENANT_ID, 'brand-one', []);
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists subscription.created in the tenant subscription assignment transaction', async () => {
    const harness = makeOutboxHarness();
    const plan = { id: 'plan-one', code: 'starter', name: 'Starter', trialDays: 0, interval: 'MONTHLY', limits: {} };
    const created = makeSubscriptionRecord('subscription-created', plan);
    Object.assign(harness.tx, {
      tenantSubscription: { create: jest.fn(async () => created) },
    });
    const prisma = {
      subscriptionPlan: { findFirst: jest.fn(async () => plan) },
      tenantSubscription: { findFirst: jest.fn(async () => null) },
      tenant: {
        update: jest.fn(async () => undefined),
        findUnique: jest.fn(async () => null),
      },
      withTenantRls: tenantTransaction(harness),
    };
    const { service } = makeSubscriptionsService(prisma, harness.service);

    await service.assign(TENANT_ID, { planId: 'plan-one', seatsPurchased: 1 } as never, tenantContext('subscription-create-request'));

    const event = expectStoredEvent(harness, 'subscription.created');
    expect(event.payload).toEqual({ subscriptionId: 'subscription-created', status: 'ACTIVE' });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists subscription.changed in the tenant plan-change transaction', async () => {
    const harness = makeOutboxHarness();
    const oldPlan = { id: 'plan-old', code: 'old', name: 'Old', trialDays: 0, interval: 'MONTHLY', limits: {} };
    const newPlan = { id: 'plan-new', code: 'new', name: 'New', trialDays: 0, interval: 'MONTHLY', limits: {} };
    const existing = makeSubscriptionRecord('subscription-change', oldPlan);
    const changed = makeSubscriptionRecord('subscription-change', newPlan);
    Object.assign(harness.tx, {
      tenantSubscription: { update: jest.fn(async () => changed) },
    });
    const prisma = {
      subscriptionPlan: { findFirst: jest.fn(async () => newPlan) },
      tenantSubscription: { findFirst: jest.fn(async () => existing) },
      tenant: { update: jest.fn(async () => undefined) },
      withTenantRls: tenantTransaction(harness),
    };
    const { service } = makeSubscriptionsService(prisma, harness.service);

    await service.changePlan(TENANT_ID, { planId: 'plan-new', atPeriodEnd: false } as never, tenantContext('subscription-change-request'));

    const event = expectStoredEvent(harness, 'subscription.changed');
    expect(event.payload).toEqual({ subscriptionId: 'subscription-change', status: 'ACTIVE' });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists subscription.cancelled in the tenant cancellation transaction', async () => {
    const harness = makeOutboxHarness();
    const plan = { id: 'plan-one', code: 'starter', name: 'Starter', trialDays: 0, interval: 'MONTHLY', limits: {} };
    const existing = makeSubscriptionRecord('subscription-cancelled', plan);
    const cancelled = makeSubscriptionRecord('subscription-cancelled', plan, 'CANCELED');
    Object.assign(harness.tx, {
      tenantSubscription: { update: jest.fn(async () => cancelled) },
    });
    const prisma = {
      tenantSubscription: { findFirst: jest.fn(async () => existing) },
      tenant: { findUnique: jest.fn(async () => null) },
      withTenantRls: tenantTransaction(harness),
    };
    const { service } = makeSubscriptionsService(prisma, harness.service);

    await service.cancel(TENANT_ID, { atPeriodEnd: false, reason: 'operator request' } as never, tenantContext('subscription-cancel-request'));

    const event = expectStoredEvent(harness, 'subscription.cancelled');
    expect(event.payload).toEqual({ subscriptionId: 'subscription-cancelled', status: 'CANCELED' });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    [PaymentStatus.SUCCEEDED, 'payment.succeeded'],
    [PaymentStatus.FAILED, 'payment.failed'],
  ])('persists the %s payment transition through the tenant outbox', async (status, eventType) => {
    const harness = makeOutboxHarness();
    const existing = {
      id: 'payment-one',
      tenantId: TENANT_ID,
      planId: 'plan-one',
      subscriptionId: null,
      provider: 'STRIPE',
      status: 'CREATED',
      currency: 'USD',
      amount: '12.50',
      providerPaymentId: null,
      providerCheckoutId: null,
      providerSessionId: null,
      providerInvoiceId: null,
      providerReference: {},
      idempotencyKey: 'payment-one-key',
      orderId: 'order-one',
      metadata: {},
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    const paymentDelegate = {
      findFirst: jest.fn(async () => existing),
      update: jest.fn(async (query: { data: Record<string, unknown> }) => ({
        ...existing,
        ...query.data,
        updatedAt: FIXED_TIME,
      })),
    };
    Object.assign(harness.tx, { payment: paymentDelegate });
    const prisma = { withTenantRls: tenantTransaction(harness) };
    const repository = new PaymentRepository(prisma as never, harness.service);

    await repository.update('payment-one', { status } as never, TENANT_ID);

    const event = expectStoredEvent(harness, eventType);
    expect(event.payload).toEqual({
      paymentId: 'payment-one',
      amount: '12.50',
      currency: 'USD',
      status,
    });
    expect(paymentDelegate.update).toHaveBeenCalledTimes(1);
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists invoice.created in the tenant invoice-creation transaction', async () => {
    const harness = makeOutboxHarness();
    const created = {
      id: 'invoice-created',
      invoiceNumber: 'INV-20261009-0001',
      tenantId: TENANT_ID,
      paymentId: null,
      subscriptionId: null,
      currency: 'USD',
      status: 'DRAFT',
      issuedAt: FIXED_TIME,
      dueDate: null,
      subtotal: '12.50',
      taxTotal: '0.00',
      total: '12.50',
      amountPaid: '0.00',
      amountDue: '12.50',
      amountRefunded: '0.00',
      provider: null,
      planId: null,
      idempotencyKey: 'invoice-create-key',
      customer: {},
      taxSummary: [],
      metadata: { _invoice: { discountTotal: '0.00', amountCredited: '0' } },
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      finalizedAt: null,
      paidAt: null,
      voidedAt: null,
    };
    Object.assign(harness.tx, {
      invoice: { create: jest.fn(async () => created) },
    });
    const prisma = {
      invoice: { findFirst: jest.fn(async () => null) },
      withTenantRls: tenantTransaction(harness),
    };
    const repository = new InvoiceRepository(prisma as never, harness.service);

    await repository.create({
      tenantId: TENANT_ID,
      currency: 'USD',
      idempotencyKey: 'invoice-create-key',
      customer: { tenantId: TENANT_ID, billingName: 'Brand One', billingEmail: 'billing@example.com' },
      lines: [{
        type: 'SUBSCRIPTION',
        description: 'Monthly plan',
        quantity: 1,
        unitPrice: { amount: '12.50', currency: 'USD' },
        amount: { amount: '12.50', currency: 'USD' },
      }],
    } as never);

    const event = expectStoredEvent(harness, 'invoice.created');
    expect(event.payload).toEqual({ invoiceId: 'invoice-created', amount: '12.50', currency: 'USD', status: 'DRAFT' });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists invoice.paid in the tenant invoice-payment transaction', async () => {
    const harness = makeOutboxHarness();
    const existing = {
      id: 'invoice-paid',
      tenantId: TENANT_ID,
      paymentId: 'payment-one',
      subscriptionId: null,
      currency: 'USD',
      status: 'OPEN',
      total: '12.50',
      amountPaid: '0.00',
      amountDue: '12.50',
      amountRefunded: '0.00',
      idempotencyKey: 'invoice-paid-key',
      metadata: { _invoice: { discountTotal: '0.00', amountCredited: '0' } },
      issuedAt: FIXED_TIME,
      dueDate: null,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      paidAt: null,
      finalizedAt: null,
      voidedAt: null,
    };
    const paid = { ...existing, status: 'PAID', amountPaid: '12.50', amountDue: '0.00', paidAt: FIXED_TIME, updatedAt: FIXED_TIME };
    const invoiceDelegate = {
      findFirst: jest.fn(async () => existing),
      update: jest.fn(async () => paid),
    };
    Object.assign(harness.tx, { invoice: invoiceDelegate });
    const prisma = {
      invoice: { findUnique: jest.fn(async () => ({ tenantId: TENANT_ID })) },
      withTenantRls: tenantTransaction(harness),
    };
    const repository = new InvoiceRepository(prisma as never, harness.service);

    await repository.update('invoice-paid', { status: 'PAID', amountPaid: '12.50', amountDue: '0.00', paidAt: FIXED_TIME } as never);

    const event = expectStoredEvent(harness, 'invoice.paid');
    expect(event.payload).toEqual({ invoiceId: 'invoice-paid', amount: '12.50', currency: 'USD', status: 'PAID' });
    expect(invoiceDelegate.update).toHaveBeenCalledTimes(1);
  });

  it('persists funding.requested with the authoritative request amount', async () => {
    const harness = makeOutboxHarness();
    const account = { id: 'account-one', tenantId: TENANT_ID, clientProfileId: 'client-one', state: 'ACTIVE' };
    const created = {
      id: 'funding-one',
      tenantId: TENANT_ID,
      accountId: 'account-one',
      clientProfileId: 'client-one',
      requestedAmount: '25.75',
      currency: 'USD',
      state: FundingRequestState.REQUESTED,
      requestedAt: FIXED_TIME,
    };
    Object.assign(harness.tx, {
      fundingRequest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => created),
      },
    });
    const prisma = {
      institutionalAccount: { findFirst: jest.fn(async () => account) },
      fundingRequest: { findFirst: jest.fn(async () => null) },
      withTenantRls: tenantTransaction(harness),
    };
    const policyService = {
      resolvePolicy: jest.fn(async () => ({
        fundingControls: { allowedCurrencies: ['USD'], requireExternalReference: false, requireDestinationValidation: false },
        withdrawalRules: { requireComplianceCheck: false, requireRiskCheck: false },
      })),
    };
    const restrictionService = { hasRestriction: jest.fn(async () => false) };
    const auditService = { log: jest.fn(async () => undefined) };
    const service = new FundingRequestService(
      prisma as never,
      policyService as never,
      auditService as never,
      restrictionService as never,
      harness.service,
    );

    await service.createFundingRequest({
      tenantId: TENANT_ID,
      accountId: 'account-one',
      requestedAmount: '25.75',
      currency: 'USD',
      correlationId: 'funding-create-request',
    });

    const event = expectStoredEvent(harness, 'funding.requested');
    expect(event.payload).toEqual({
      fundingRequestId: 'funding-one',
      amount: '25.75',
      currency: 'USD',
      status: FundingRequestState.REQUESTED,
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists funding.confirmed only after the submitted request has external settlement evidence', async () => {
    const harness = makeOutboxHarness();
    const request = {
      id: 'funding-confirmed',
      tenantId: TENANT_ID,
      accountId: 'account-one',
      clientProfileId: 'client-one',
      state: FundingRequestState.SUBMITTED,
      requestedAmount: '25.75',
      confirmedAmount: null,
      currency: 'USD',
      externalReference: 'provider-funding-1',
    };
    const changed = {
      ...request,
      state: FundingRequestState.CONFIRMED,
      confirmedAmount: '25.75',
      confirmedAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    Object.assign(harness.tx, {
      fundingRequest: {
        findFirst: jest.fn(async () => request),
        update: jest.fn(async () => changed),
      },
    });
    const prisma = {
      fundingRequest: { findFirst: jest.fn(async () => request) },
      withTenantRls: tenantTransaction(harness),
    };
    const service = new FundingRequestService(
      prisma as never,
      {} as never,
      { log: jest.fn(async () => undefined) } as never,
      {} as never,
      harness.service,
    );

    await service.transitionFundingRequest({
      tenantId: TENANT_ID,
      fundingRequestId: 'funding-confirmed',
      toState: FundingRequestState.CONFIRMED,
      confirmedAmount: '25.75',
      externalReference: 'provider-funding-1',
      correlationId: 'funding-confirm-request',
    });

    const event = expectStoredEvent(harness, 'funding.confirmed');
    expect(event.payload).toEqual({
      fundingRequestId: 'funding-confirmed',
      amount: '25.75',
      currency: 'USD',
      status: FundingRequestState.CONFIRMED,
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists withdrawal.requested without trusting a client-side settlement claim', async () => {
    const harness = makeOutboxHarness();
    const account = {
      id: 'account-one',
      tenantId: TENANT_ID,
      clientProfileId: 'client-one',
      state: 'ACTIVE',
      complianceStatus: null,
      riskStatus: null,
    };
    const created = {
      id: 'withdrawal-one',
      tenantId: TENANT_ID,
      accountId: 'account-one',
      clientProfileId: 'client-one',
      requestedAmount: '8.25',
      currency: 'USD',
      state: WithdrawalRequestState.REQUESTED,
      requestedAt: FIXED_TIME,
    };
    Object.assign(harness.tx, {
      withdrawalRequest: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => created),
      },
    });
    const prisma = {
      institutionalAccount: { findFirst: jest.fn(async () => account) },
      withdrawalRequest: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
      },
      withTenantRls: tenantTransaction(harness),
    };
    const policyService = {
      resolvePolicy: jest.fn(async () => ({
        fundingControls: { allowedCurrencies: ['USD'], requireExternalReference: false, requireDestinationValidation: false },
        withdrawalRules: { requireComplianceCheck: false, requireRiskCheck: false },
      })),
    };
    const restrictionService = { hasRestriction: jest.fn(async () => false) };
    const auditService = { log: jest.fn(async () => undefined) };
    const service = new WithdrawalRequestService(
      prisma as never,
      policyService as never,
      auditService as never,
      restrictionService as never,
      harness.service,
    );

    await service.createWithdrawalRequest({
      tenantId: TENANT_ID,
      accountId: 'account-one',
      requestedAmount: '8.25',
      currency: 'USD',
      correlationId: 'withdrawal-create-request',
    });

    const event = expectStoredEvent(harness, 'withdrawal.requested');
    expect(event.payload).toEqual({
      withdrawalRequestId: 'withdrawal-one',
      amount: '8.25',
      currency: 'USD',
      status: WithdrawalRequestState.REQUESTED,
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists withdrawal.confirmed only after external settlement evidence', async () => {
    const harness = makeOutboxHarness();
    const request = {
      id: 'withdrawal-confirmed',
      tenantId: TENANT_ID,
      accountId: 'account-one',
      clientProfileId: 'client-one',
      state: WithdrawalRequestState.SUBMITTED,
      requestedAmount: '8.25',
      confirmedAmount: null,
      currency: 'USD',
      externalReference: 'custody-withdrawal-1',
    };
    const changed = {
      ...request,
      state: WithdrawalRequestState.CONFIRMED,
      confirmedAmount: '8.25',
      confirmedAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    Object.assign(harness.tx, {
      withdrawalRequest: {
        findFirst: jest.fn(async () => request),
        update: jest.fn(async () => changed),
      },
    });
    const prisma = {
      withdrawalRequest: { findFirst: jest.fn(async () => request) },
      withTenantRls: tenantTransaction(harness),
    };
    const service = new WithdrawalRequestService(
      prisma as never,
      {} as never,
      { log: jest.fn(async () => undefined) } as never,
      {} as never,
      harness.service,
    );

    await service.transitionWithdrawalRequest({
      tenantId: TENANT_ID,
      withdrawalRequestId: 'withdrawal-confirmed',
      toState: WithdrawalRequestState.CONFIRMED,
      confirmedAmount: '8.25',
      externalReference: 'custody-withdrawal-1',
      correlationId: 'withdrawal-confirm-request',
    });

    const event = expectStoredEvent(harness, 'withdrawal.confirmed');
    expect(event.payload).toEqual({
      withdrawalRequestId: 'withdrawal-confirmed',
      amount: '8.25',
      currency: 'USD',
      status: WithdrawalRequestState.CONFIRMED,
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists kill_switch.activated and kill_switch.released in tenant state-transition transactions', async () => {
    const harness = makeOutboxHarness();
    let currentKillSwitch: Record<string, unknown> | null = null;
    const killSwitchDelegate = {
      findFirst: jest.fn(async () => currentKillSwitch),
      create: jest.fn(async (query: { data: Record<string, unknown> }) => {
        currentKillSwitch = {
          id: 'kill-switch-one',
          tenantId: TENANT_ID,
          scope: query.data.scope,
          target: query.data.target,
          isEngaged: true,
          createdAt: FIXED_TIME,
          ...query.data,
        };
        return currentKillSwitch;
      }),
      update: jest.fn(async (query: { data: Record<string, unknown> }) => {
        currentKillSwitch = { ...(currentKillSwitch as Record<string, unknown>), ...query.data };
        return currentKillSwitch;
      }),
    };
    Object.assign(harness.tx, { killSwitch: killSwitchDelegate });
    const prisma = {
      withTenantRls: tenantTransaction(harness),
      killSwitch: { findUnique: jest.fn(async () => currentKillSwitch) },
      auditLog: { create: jest.fn(async () => undefined) },
    };
    const eventService = { emitThresholdBreached: jest.fn(async () => undefined) };
    const service = new KillSwitchOrchestratorService(prisma as never, eventService as never, harness.service);

    await service.requestKillSwitch({
      tenantId: TENANT_ID,
      scope: KillSwitchRequestScope.ACCOUNT,
      target: 'account-one',
      reason: 'Risk threshold breached and trading must stop immediately',
      triggeredByRule: 'MAX_DRAWDOWN',
      policyVersion: 'risk-policy-v1',
      requestedByUserId: 'admin-1',
    });
    const activated = expectStoredEvent(harness, 'kill_switch.activated');
    expect(activated.payload).toMatchObject({
      killSwitchId: 'kill-switch-one',
      scope: KillSwitchRequestScope.ACCOUNT,
      target: 'account-one',
      isEngaged: true,
    });

    await service.clearKillSwitch({
      killSwitchId: 'kill-switch-one',
      tenantId: TENANT_ID,
      clearedByUserId: 'admin-1',
      reason: 'Risk controls were reviewed and safely restored',
    });
    const released = expectStoredEvent(harness, 'kill_switch.released');
    expect(released.payload).toMatchObject({
      killSwitchId: 'kill-switch-one',
      scope: KillSwitchRequestScope.ACCOUNT,
      target: 'account-one',
      isEngaged: false,
    });
    expect(released.aggregateSequence).toBe(activated.aggregateSequence + 1);
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it('persists risk.stop_triggered with the risk decision in one tenant transaction', async () => {
    const harness = makeOutboxHarness();
    Object.assign(harness.tx, {
      riskDecisionRecord: { create: jest.fn(async () => undefined) },
    });
    const empty = async () => [];
    const policy = {
      effectiveVersion: 'risk-policy-v1',
      scopeChain: [],
      thresholds: {
        maxGrossExposure: '1000000',
        maxPositionNotional: '1000000',
        maxSymbolExposure: '1000000',
        marketDataMaxAgeMs: 60000,
        exchangeHealthMaxAgeMs: 60000,
        liquidationCriticalDistance: '0.05',
        liquidationWarningDistance: '0.10',
        marginCriticalUtilization: '0.90',
      },
    };
    const prisma = {
      withTenantRls: tenantTransaction(harness),
      riskDecisionRecord: { create: jest.fn(async () => undefined) },
      complianceScreeningRequest: { findFirst: jest.fn(async () => null) },
      securityThreatSignal: { findFirst: jest.fn(async () => null) },
    };
    const riskService = new RiskDecisionService(
      prisma as never,
      { resolveEffectivePolicy: jest.fn(async () => policy) } as never,
      {
        calculateExposure: jest.fn(async () => ({
          state: RiskState.NORMAL,
          grossExposure: '0',
          symbolExposures: [],
          staleSymbols: [],
        })),
      } as never,
      { evaluatePositionRisk: empty } as never,
      { evaluateMargin: empty } as never,
      { evaluateLeverage: empty } as never,
      { evaluateLiquidationRisk: empty } as never,
      { evaluateConcentration: empty } as never,
      { evaluateDrawdown: empty } as never,
      { evaluateDailyLoss: empty } as never,
      { evaluateCorrelation: empty } as never,
      { evaluateVar: empty } as never,
      { runStressTests: empty } as never,
      { isBlocked: jest.fn(async () => false) } as never,
      { isEngaged: jest.fn(async () => true) } as never,
      {} as never,
      { emitThresholdBreached: jest.fn(async () => undefined) } as never,
      harness.service,
    );

    const decision = await riskService.evaluateUnifiedRisk({ tenantId: TENANT_ID, requestId: 'risk-decision-request' });

    expect(decision.decision).toBe('KILL_SWITCH_REQUIRED');
    const event = expectStoredEvent(harness, 'risk.stop_triggered');
    expect(event.payload).toMatchObject({
      decisionId: decision.id,
      ruleIds: ['KILL_SWITCH_ENGAGED'],
      policyVersion: 'risk-policy-v1',
      scope: 'TENANT',
      scopeId: TENANT_ID,
      severity: 'CRITICAL',
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists fee.settled atomically with settlement and all accrual finalizations', async () => {
    const harness = makeOutboxHarness();
    const settlement = {
      id: 'settlement-one',
      tenantId: TENANT_ID,
      currency: 'USD',
      grossFeeAmount: '20.00',
      adjustments: '0',
      finalSettlementAmount: '20.00',
      numberOfAccruals: 1,
      feeType: 'PERFORMANCE_FEE',
      status: 'APPROVED',
      idempotencyKey: 'settlement-one-key',
      accrualIds: ['accrual-one'],
    };
    const txSettlement = {
      ...settlement,
      status: 'APPROVED',
    };
    Object.assign(harness.tx, {
      feeSettlement: {
        findFirst: jest.fn(async () => txSettlement),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      feeAccrual: { updateMany: jest.fn(async () => ({ count: 1 })) },
    });
    const prisma = { withTenantRls: tenantTransaction(harness) };
    const settlementRepository = { findById: jest.fn(async () => settlement) };
    const auditService = { logSettlementFinalized: jest.fn(async () => undefined) };
    const service = new FeeSettlementService(
      {} as never,
      settlementRepository as never,
      auditService as never,
      prisma as never,
      harness.service,
    );

    await service.finalizeSettlement('settlement-one', TENANT_ID);

    const event = expectStoredEvent(harness, 'fee.settled');
    expect(event.payload).toEqual({
      settlementId: 'settlement-one',
      amount: '20.00',
      currency: 'USD',
      feeType: 'PERFORMANCE_FEE',
      accrualIds: ['accrual-one'],
      status: 'FINALIZED',
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists payout.completed only after the tenant payout state reaches SUCCEEDED', async () => {
    const harness = makeOutboxHarness();
    const existing = {
      id: 'payout-one',
      settlementId: 'settlement-one',
      beneficiaryId: 'trader-one',
      beneficiaryType: 'TRADER',
      tenantId: TENANT_ID,
      amount: '20.00',
      currency: 'USD',
      destination: { type: 'crypto_wallet', reference: 'wallet-ref', maskedReference: '****1234', currency: 'USD' },
      provider: 'CRYPTO',
      providerPayoutId: 'provider-payout-one',
      providerReference: 'provider-ref-one',
      status: PayoutStatus.PROCESSING,
      failureReason: null,
      idempotencyKey: 'payout-one-key',
      metadata: {},
      safeMetadata: {},
      processedAt: FIXED_TIME,
      succeededAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    const updated = {
      ...existing,
      status: PayoutStatus.SUCCEEDED,
      succeededAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    };
    const payoutDelegate = {
      findFirst: jest.fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated),
      updateMany: jest.fn(async () => ({ count: 1 })),
    };
    Object.assign(harness.tx, { payout: payoutDelegate });
    const prisma = {
      payout: { findFirst: jest.fn(async () => existing) },
      withTenantRls: tenantTransaction(harness),
    };
    const repository = new PayoutRepository(prisma as never, harness.service);

    const result = await repository.updateStatus('payout-one', { status: PayoutStatus.SUCCEEDED });

    expect(result?.status).toBe(PayoutStatus.SUCCEEDED);
    const event = expectStoredEvent(harness, 'payout.completed');
    expect(event.payload).toEqual({
      payoutId: 'payout-one',
      settlementId: 'settlement-one',
      beneficiaryType: 'TRADER',
      beneficiaryId: 'trader-one',
      amount: '20.00',
      currency: 'USD',
      status: 'SUCCEEDED',
    });
    expect(harness.tx.outboxEvent.upsert).toHaveBeenCalledTimes(1);
  });
});
