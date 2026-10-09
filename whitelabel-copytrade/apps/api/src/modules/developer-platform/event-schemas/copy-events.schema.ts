// # NEW — JSON schemas for copy.* events and verified trader lifecycle events

import { eventPayloadSchema, type DeveloperEventPayloadSchema, type EventJsonSchemaProperty } from './event-schema.types';

const identifier: EventJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 255 };
const nullableIdentifier: EventJsonSchemaProperty = { type: ['string', 'null'], maxLength: 255 };
const nullableDecimal: EventJsonSchemaProperty = {
  type: ['string', 'null'],
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
  maxLength: 64,
};

function subscriptionEvent(eventType: string, lifecycleState: string): DeveloperEventPayloadSchema {
  return eventPayloadSchema(
    eventType,
    `A copy subscription entered the ${lifecycleState} lifecycle state.`,
    ['subscriptionId', 'followerId', 'traderId', 'strategyId', 'state'],
    {
      subscriptionId: identifier,
      followerId: identifier,
      traderId: identifier,
      strategyId: identifier,
      state: { type: 'string', enum: [lifecycleState] },
    },
    {
      subscriptionId: 'subscription-example',
      followerId: 'follower-example',
      traderId: 'trader-example',
      strategyId: 'strategy-example',
      state: lifecycleState,
    },
  );
}

function executionEvent(eventType: string, terminalStatus: string): DeveloperEventPayloadSchema {
  return eventPayloadSchema(
    eventType,
    `A copy execution reached the ${terminalStatus} terminal state.`,
    ['executionId', 'subscriptionId', 'followerId', 'traderId', 'strategyId', 'status', 'symbol', 'side', 'quantity'],
    {
      executionId: identifier,
      subscriptionId: identifier,
      followerId: identifier,
      traderId: identifier,
      strategyId: nullableIdentifier,
      status: { type: 'string', enum: terminalStatus === 'FAILED' ? ['FAILED', 'REJECTED'] : [terminalStatus] },
      symbol: { type: ['string', 'null'], maxLength: 64 },
      side: { type: ['string', 'null'], enum: ['BUY', 'SELL', null] },
      quantity: nullableDecimal,
    },
    {
      executionId: 'execution-example',
      subscriptionId: 'subscription-example',
      followerId: 'follower-example',
      traderId: 'trader-example',
      strategyId: 'strategy-example',
      status: terminalStatus,
      symbol: 'BTC-USDT',
      side: 'BUY',
      quantity: '0.125',
    },
  );
}

export const COPY_DEVELOPER_EVENT_SCHEMAS: Readonly<Record<string, DeveloperEventPayloadSchema>> = {
  'copy.subscription.created': subscriptionEvent('copy.subscription.created', 'ACTIVE'),
  'copy.subscription.paused': subscriptionEvent('copy.subscription.paused', 'PAUSED'),
  'copy.subscription.resumed': subscriptionEvent('copy.subscription.resumed', 'ACTIVE'),
  'copy.subscription.stopped': subscriptionEvent('copy.subscription.stopped', 'STOPPED'),
  'copy.subscription.cancelled': subscriptionEvent('copy.subscription.cancelled', 'CANCELLED'),
  'copy.execution.filled': executionEvent('copy.execution.filled', 'FILLED'),
  'copy.execution.failed': executionEvent('copy.execution.failed', 'FAILED'),
  'copy.execution.skipped': executionEvent('copy.execution.skipped', 'SKIPPED'),
  'trader.verified': eventPayloadSchema(
    'trader.verified',
    'A lead trader profile changed to the verified state after tenant-scoped review.',
    ['traderId', 'verifiedAt', 'verificationState'],
    {
      traderId: identifier,
      verifiedAt: { type: 'string', format: 'date-time', maxLength: 64 },
      verificationState: { type: 'string', enum: ['VERIFIED'] },
    },
    {
      traderId: 'trader-example',
      verifiedAt: '2026-10-09T00:00:00.000Z',
      verificationState: 'VERIFIED',
    },
  ),
};
