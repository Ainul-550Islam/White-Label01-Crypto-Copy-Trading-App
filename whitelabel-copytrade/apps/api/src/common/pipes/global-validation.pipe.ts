import { Injectable, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Global class-validator pipe for DTO based endpoints.
 *
 * Hardening choices:
 *   - `whitelist` strips unknown properties (mass-assignment protection).
 *   - `forbidNonWhitelisted` rejects requests that try to send them at all.
 *   - `transform` produces real class instances so `@Type` conversions apply.
 *   - errors are flattened into the platform's ValidationErrorDetail contract.
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationException(flattenValidationErrors(errors)),
    });
  }
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetail[] {
  const details: ValidationErrorDetail[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      for (const [constraint, message] of Object.entries(error.constraints)) {
        details.push({ field: path, constraint, message });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, path));
    }
  }

  return details;
}
