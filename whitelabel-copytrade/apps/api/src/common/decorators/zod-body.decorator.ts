import { Body, Param, Query } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Validates a request body with a zod schema from `@wlct/validation`, which
 * keeps a single validation source of truth shared with the web and mobile
 * clients. Swagger documentation still comes from the DTO classes.
 */
export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** Query-string equivalent of {@link ZodBody}. */
export const ZodQuery = (schema: ZodSchema): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

/** Route-parameter equivalent of {@link ZodBody}. */
export const ZodParam = (property: string, schema: ZodSchema): ParameterDecorator =>
  Param(property, new ZodValidationPipe(schema));
