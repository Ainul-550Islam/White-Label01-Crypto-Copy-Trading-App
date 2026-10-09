// # NEW — Registers every catalog event schema and provides a fail-closed payload validator

import { CORE_DEVELOPER_EVENT_SCHEMAS } from './core-events.schema';
import { COPY_DEVELOPER_EVENT_SCHEMAS } from './copy-events.schema';
import { FEE_DEVELOPER_EVENT_SCHEMAS } from './fee-events.schema';
import { RISK_DEVELOPER_EVENT_SCHEMAS } from './risk-events.schema';
import { validateEventPayloadSchema, type DeveloperEventPayloadSchema } from './event-schema.types';

export const DEVELOPER_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<string, DeveloperEventPayloadSchema>> = {
  ...CORE_DEVELOPER_EVENT_SCHEMAS,
  ...COPY_DEVELOPER_EVENT_SCHEMAS,
  ...FEE_DEVELOPER_EVENT_SCHEMAS,
  ...RISK_DEVELOPER_EVENT_SCHEMAS,
};

export function developerEventPayloadSchema(eventType: string): DeveloperEventPayloadSchema | undefined {
  return DEVELOPER_EVENT_PAYLOAD_SCHEMAS[eventType];
}

export function validateDeveloperEventPayload(
  eventType: string,
  payload: unknown,
): { valid: boolean; errors: string[] } {
  const schema = developerEventPayloadSchema(eventType);
  if (!schema) {
    return { valid: false, errors: [`no versioned payload schema is registered for ${eventType}`] };
  }
  return validateEventPayloadSchema(schema, payload);
}
