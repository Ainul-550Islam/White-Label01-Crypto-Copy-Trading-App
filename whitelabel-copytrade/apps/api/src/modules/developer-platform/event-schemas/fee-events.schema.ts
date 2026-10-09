// # NEW — JSON schemas for fee.* and payout.* events

import { eventPayloadSchema, type DeveloperEventPayloadSchema, type EventJsonSchemaProperty } from './event-schema.types';

const identifier: EventJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 255 };
const decimal: EventJsonSchemaProperty = {
  type: 'string',
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
  maxLength: 64,
};
const currency: EventJsonSchemaProperty = { type: 'string', pattern: '^[A-Z0-9]{2,12}$', maxLength: 12 };

const feeAccrued: DeveloperEventPayloadSchema = eventPayloadSchema(
  'fee.accrued',
  'A fee accrual was persisted from an authoritative fee source. Monetary values are exact decimal strings.',
  ['accrualId', 'sourceType', 'sourceId', 'feeType', 'grossAmount', 'feeAmount', 'currency', 'feeRateBps', 'status'],
  {
    accrualId: identifier,
    sourceType: { type: 'string', minLength: 1, maxLength: 64 },
    sourceId: identifier,
    feeType: { type: 'string', minLength: 1, maxLength: 64 },
    grossAmount: decimal,
    feeAmount: decimal,
    currency,
    feeRateBps: { type: 'integer', minimum: 0, maximum: 1000000 },
    status: { type: 'string', enum: ['ACCRUED'] },
  },
  {
    accrualId: 'accrual-example',
    sourceType: 'COPY_TRADING_SETTLEMENT',
    sourceId: 'settlement-source-example',
    feeType: 'PERFORMANCE_FEE',
    grossAmount: '100.00',
    feeAmount: '20.00',
    currency: 'USD',
    feeRateBps: 2000,
    status: 'ACCRUED',
  },
);

const feeSettled: DeveloperEventPayloadSchema = eventPayloadSchema(
  'fee.settled',
  'A fee settlement batch and all referenced accruals were finalized atomically. Monetary values are exact decimal strings.',
  ['settlementId', 'amount', 'currency', 'feeType', 'accrualIds', 'status'],
  {
    settlementId: identifier,
    amount: decimal,
    currency,
    feeType: { type: 'string', minLength: 1, maxLength: 64 },
    accrualIds: { type: 'array', minItems: 1, maxItems: 1000, items: identifier },
    status: { type: 'string', enum: ['FINALIZED'] },
  },
  {
    settlementId: 'settlement-example',
    amount: '20.00',
    currency: 'USD',
    feeType: 'PERFORMANCE_FEE',
    accrualIds: ['accrual-example'],
    status: 'FINALIZED',
  },
);

const payoutCompleted: DeveloperEventPayloadSchema = eventPayloadSchema(
  'payout.completed',
  'A payout provider reported success and the payout state was durably updated. Monetary values are exact decimal strings.',
  ['payoutId', 'settlementId', 'beneficiaryType', 'beneficiaryId', 'amount', 'currency', 'status'],
  {
    payoutId: identifier,
    settlementId: identifier,
    beneficiaryType: { type: 'string', enum: ['TRADER', 'PLATFORM', 'TENANT', 'AFFILIATE'] },
    beneficiaryId: identifier,
    amount: decimal,
    currency,
    status: { type: 'string', enum: ['SUCCEEDED'] },
  },
  {
    payoutId: 'payout-example',
    settlementId: 'settlement-example',
    beneficiaryType: 'TRADER',
    beneficiaryId: 'trader-example',
    amount: '20.00',
    currency: 'USD',
    status: 'SUCCEEDED',
  },
);

export const FEE_DEVELOPER_EVENT_SCHEMAS: Readonly<Record<string, DeveloperEventPayloadSchema>> = {
  'fee.accrued': feeAccrued,
  'fee.settled': feeSettled,
  'payout.completed': payoutCompleted,
};
