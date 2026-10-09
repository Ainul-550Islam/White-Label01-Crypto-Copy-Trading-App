// # NEW — JSON schemas for risk.* and kill_switch.* events

import { eventPayloadSchema, type DeveloperEventPayloadSchema, type EventJsonSchemaProperty } from './event-schema.types';

const identifier: EventJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 255 };
const nullableTarget: EventJsonSchemaProperty = { type: ['string', 'null'], maxLength: 255 };
const killSwitchScope: EventJsonSchemaProperty = {
  type: 'string',
  enum: ['GLOBAL', 'EXCHANGE', 'ACCOUNT', 'STRATEGY', 'SYMBOL', 'RISK'],
};
const riskPolicyScope: EventJsonSchemaProperty = {
  type: 'string',
  enum: ['PLATFORM', 'TENANT', 'TRADER', 'STRATEGY', 'FOLLOWER'],
};
const dateTime: EventJsonSchemaProperty = { type: 'string', format: 'date-time', maxLength: 64 };

const riskStopTriggered: DeveloperEventPayloadSchema = eventPayloadSchema(
  'risk.stop_triggered',
  'A persisted unified risk decision required an immediate stop. This event does not itself release or bypass a kill switch.',
  ['decisionId', 'ruleIds', 'policyVersion', 'scope', 'scopeId', 'severity', 'triggeredAt'],
  {
    decisionId: identifier,
    ruleIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 64 } },
    policyVersion: { type: 'string', minLength: 1, maxLength: 96 },
    scope: riskPolicyScope,
    scopeId: nullableTarget,
    severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL', 'EMERGENCY'] },
    triggeredAt: dateTime,
  },
  {
    decisionId: 'risk-decision-example',
    ruleIds: ['DAILY_LOSS_LIMIT'],
    policyVersion: 'policy-v1',
    scope: 'TENANT',
    scopeId: 'tenant-example',
    severity: 'CRITICAL',
    triggeredAt: '2026-10-09T00:00:00.000Z',
  },
);

function killSwitchEvent(eventType: 'kill_switch.activated' | 'kill_switch.released'): DeveloperEventPayloadSchema {
  const activated = eventType === 'kill_switch.activated';
  const timeKey = activated ? 'activatedAt' : 'releasedAt';
  return eventPayloadSchema(
    eventType,
    activated ? 'A tenant-owned kill switch was activated.' : 'A tenant-owned kill switch was released.',
    ['killSwitchId', 'scope', 'target', 'isEngaged', timeKey],
    {
      killSwitchId: identifier,
      scope: killSwitchScope,
      target: nullableTarget,
      isEngaged: { type: 'boolean', enum: [activated] },
      [timeKey]: dateTime,
    },
    {
      killSwitchId: 'kill-switch-example',
      scope: 'ACCOUNT',
      target: 'account-example',
      isEngaged: activated,
      [timeKey]: '2026-10-09T00:00:00.000Z',
    },
  );
}

export const RISK_DEVELOPER_EVENT_SCHEMAS: Readonly<Record<string, DeveloperEventPayloadSchema>> = {
  'risk.stop_triggered': riskStopTriggered,
  'kill_switch.activated': killSwitchEvent('kill_switch.activated'),
  'kill_switch.released': killSwitchEvent('kill_switch.released'),
};
