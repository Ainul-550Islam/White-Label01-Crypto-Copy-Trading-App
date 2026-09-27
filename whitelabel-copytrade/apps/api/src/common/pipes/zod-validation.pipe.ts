import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema } from 'zod';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Runs a zod schema over an incoming payload and converts failures into the
 * platform's standard validation error envelope.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ValidationException(toValidationDetails(result.error));
  }
}

export function toValidationDetails(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    constraint: issue.code,
    message: issue.message,
  }));
}
