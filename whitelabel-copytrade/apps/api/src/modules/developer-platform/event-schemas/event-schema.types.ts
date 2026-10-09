// # NEW — Defines the JSON Schema vocabulary and fail-closed payload validation for developer events

export type JsonSchemaPrimitiveType = 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';

export interface EventJsonSchemaProperty {
  type: JsonSchemaPrimitiveType | JsonSchemaPrimitiveType[];
  description?: string;
  enum?: readonly (string | number | boolean | null)[];
  format?: 'date-time' | 'uuid';
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: EventJsonSchemaProperty;
  properties?: Record<string, EventJsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface DeveloperEventPayloadSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: string;
  title: string;
  description: string;
  type: 'object';
  additionalProperties: boolean;
  required: readonly string[];
  properties: Record<string, EventJsonSchemaProperty>;
  examples: readonly Record<string, unknown>[];
}

const EVENT_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema' as const;

export function eventPayloadSchema(
  eventType: string,
  description: string,
  required: readonly string[],
  properties: Record<string, EventJsonSchemaProperty>,
  example: Record<string, unknown>,
  additionalProperties = false,
): DeveloperEventPayloadSchema {
  return {
    $schema: EVENT_SCHEMA_DRAFT,
    $id: `urn:wlct:event-schema:${eventType}:v1`,
    title: `${eventType} v1 payload`,
    description,
    type: 'object',
    additionalProperties,
    required,
    properties,
    examples: [example],
  };
}

function matchesType(value: unknown, expected: EventJsonSchemaProperty['type']): boolean {
  const expectedTypes = Array.isArray(expected) ? expected : [expected];
  return expectedTypes.some((type) => {
    switch (type) {
      case 'array':
        return Array.isArray(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'null':
        return value === null;
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'string':
        return typeof value === 'string';
      default:
        return false;
    }
  });
}

function validateProperty(
  value: unknown,
  schema: EventJsonSchemaProperty,
  path: string,
  errors: string[],
): void {
  if (!matchesType(value, schema.type)) {
    const types = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
    errors.push(`${path} must be ${types}`);
    return;
  }

  if (value === null) return;

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path} does not match its required pattern`);
    }
    if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) {
      errors.push(`${path} must be an RFC 3339 date-time`);
    }
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${path} must be a UUID`);
    }
    if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
      errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
    if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
      errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
    }
  }

  if (typeof value === 'boolean' && schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    errors.push(`${path} is not an allowed value`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateProperty(item, schema.items as EventJsonSchemaProperty, `${path}[${index}]`, errors));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, required)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    for (const [key, nestedValue] of Object.entries(record)) {
      const nestedSchema = schema.properties[key];
      if (!nestedSchema) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
        continue;
      }
      validateProperty(nestedValue, nestedSchema, `${path}.${key}`, errors);
    }
  }
}

export function validateEventPayloadSchema(
  schema: DeveloperEventPayloadSchema,
  payload: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  validateProperty(payload, {
    type: schema.type,
    properties: schema.properties,
    required: schema.required,
    additionalProperties: schema.additionalProperties,
  }, '$', errors);
  return { valid: errors.length === 0, errors };
}
