// # NEW — JSON schemas for the existing customer, billing, trading, and account events

import { eventPayloadSchema, type DeveloperEventPayloadSchema, type EventJsonSchemaProperty } from './event-schema.types';

const identifier: EventJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 255 };
const status: EventJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 64 };
const decimal: EventJsonSchemaProperty = { type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$', maxLength: 64 };
const currency: EventJsonSchemaProperty = { type: 'string', pattern: '^[A-Z0-9]{2,12}$', maxLength: 12 };
const isoDateTime: EventJsonSchemaProperty = { type: 'string', format: 'date-time', maxLength: 64 };

function resourceEvent(
  eventType: string,
  resourceKey: string,
  description: string,
  exampleStatus?: string,
): DeveloperEventPayloadSchema {
  const properties: Record<string, EventJsonSchemaProperty> = { [resourceKey]: identifier };
  const example: Record<string, unknown> = { [resourceKey]: `${resourceKey}-example` };
  if (exampleStatus !== undefined) {
    properties.status = status;
    example.status = exampleStatus;
  }
  return eventPayloadSchema(eventType, description, [resourceKey], properties, example);
}

function monetaryResourceEvent(
  eventType: string,
  resourceKey: string,
  description: string,
  exampleStatus: string,
): DeveloperEventPayloadSchema {
  return eventPayloadSchema(
    eventType,
    description,
    [resourceKey, 'amount', 'currency', 'status'],
    {
      [resourceKey]: identifier,
      amount: decimal,
      currency,
      status,
    },
    {
      [resourceKey]: `${resourceKey}-example`,
      amount: '100.00',
      currency: 'USD',
      status: exampleStatus,
    },
  );
}

const customerCreated = resourceEvent('customer.created', 'customerId', 'A customer record was created.');
const customerUpdated = resourceEvent('customer.updated', 'customerId', 'A customer record was updated.');
const subscriptionCreated = resourceEvent('subscription.created', 'subscriptionId', 'A platform subscription was created.', 'ACTIVE');
const subscriptionChanged = resourceEvent('subscription.changed', 'subscriptionId', 'A platform subscription changed state or plan.', 'ACTIVE');
const subscriptionCancelled = resourceEvent('subscription.cancelled', 'subscriptionId', 'A platform subscription was cancelled.', 'CANCELLED');
const paymentSucceeded = monetaryResourceEvent('payment.succeeded', 'paymentId', 'A payment was confirmed as successful.', 'SUCCEEDED');
const paymentFailed = monetaryResourceEvent('payment.failed', 'paymentId', 'A payment attempt failed.', 'FAILED');
const invoiceCreated = monetaryResourceEvent('invoice.created', 'invoiceId', 'An invoice was created.', 'OPEN');
const invoicePaid = monetaryResourceEvent('invoice.paid', 'invoiceId', 'An invoice was paid.', 'PAID');
const fundingRequested = monetaryResourceEvent('funding.requested', 'fundingRequestId', 'A funding request was submitted.', 'REQUESTED');
const fundingConfirmed = monetaryResourceEvent('funding.confirmed', 'fundingRequestId', 'A funding request was confirmed.', 'CONFIRMED');
const withdrawalRequested = monetaryResourceEvent('withdrawal.requested', 'withdrawalRequestId', 'A withdrawal request was submitted.', 'REQUESTED');
const withdrawalConfirmed = monetaryResourceEvent('withdrawal.confirmed', 'withdrawalRequestId', 'A withdrawal request was confirmed.', 'CONFIRMED');

function orderEvent(eventType: string, description: string, exampleStatus: string): DeveloperEventPayloadSchema {
  return eventPayloadSchema(
    eventType,
    description,
    ['orderId', 'status'],
    {
      orderId: identifier,
      status: { type: 'string', enum: [exampleStatus], maxLength: 64 },
      symbol: { type: ['string', 'null'], maxLength: 64 },
      side: { type: ['string', 'null'], enum: ['BUY', 'SELL', null] },
      quantity: { type: ['string', 'null'], pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
      price: { type: ['string', 'null'], pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
    },
    { orderId: 'order-example', status: exampleStatus, symbol: 'BTC-USDT', side: 'BUY', quantity: '0.125', price: '64000.00' },
  );
}

const portfolioSnapshotCreated = eventPayloadSchema(
  'portfolio.snapshot.created',
  'A portfolio snapshot was persisted from authoritative accounting records.',
  ['snapshotId', 'asOf'],
  { snapshotId: identifier, asOf: isoDateTime },
  { snapshotId: 'snapshot-example', asOf: '2026-10-09T00:00:00.000Z' },
);
const statementGenerated = eventPayloadSchema(
  'statement.generated',
  'A statement artifact was generated.',
  ['statementId', 'generatedAt'],
  { statementId: identifier, generatedAt: isoDateTime },
  { statementId: 'statement-example', generatedAt: '2026-10-09T00:00:00.000Z' },
);
const complianceReviewRequired = eventPayloadSchema(
  'compliance.review.required',
  'A compliance review entered a state requiring operator review.',
  ['reviewId', 'reasonCode'],
  { reviewId: identifier, reasonCode: { type: 'string', minLength: 1, maxLength: 96 } },
  { reviewId: 'review-example', reasonCode: 'DOCUMENT_REVIEW_REQUIRED' },
);
const securityEvent = eventPayloadSchema(
  'security.event',
  'A security event was recorded. Payloads must not contain credentials or raw secrets.',
  ['securityEventId', 'category', 'severity'],
  {
    securityEventId: identifier,
    category: { type: 'string', minLength: 1, maxLength: 96 },
    severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
  },
  { securityEventId: 'security-event-example', category: 'MFA_CHALLENGE', severity: 'INFO' },
);

export const CORE_DEVELOPER_EVENT_SCHEMAS: Readonly<Record<string, DeveloperEventPayloadSchema>> = {
  'customer.created': customerCreated,
  'customer.updated': customerUpdated,
  'subscription.created': subscriptionCreated,
  'subscription.changed': subscriptionChanged,
  'subscription.cancelled': subscriptionCancelled,
  'payment.succeeded': paymentSucceeded,
  'payment.failed': paymentFailed,
  'invoice.created': invoiceCreated,
  'invoice.paid': invoicePaid,
  'funding.requested': fundingRequested,
  'funding.confirmed': fundingConfirmed,
  'withdrawal.requested': withdrawalRequested,
  'withdrawal.confirmed': withdrawalConfirmed,
  'order.created': orderEvent('order.created', 'An order was created in the OMS.', 'CREATED'),
  'order.acknowledged': orderEvent('order.acknowledged', 'An execution venue acknowledged an order.', 'ACKNOWLEDGED'),
  'order.filled': orderEvent('order.filled', 'An order was filled by the execution venue.', 'FILLED'),
  'order.rejected': orderEvent('order.rejected', 'An order was rejected by validation or the execution venue.', 'REJECTED'),
  'portfolio.snapshot.created': portfolioSnapshotCreated,
  'statement.generated': statementGenerated,
  'compliance.review.required': complianceReviewRequired,
  'security.event': securityEvent,
};
