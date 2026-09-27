import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ValidationException } from '../errors/app.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates UUID route parameters before they reach Prisma. Postgres raises a
 * type error for malformed uuids, which would otherwise surface as a 500.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new ValidationException([
        {
          field: metadata.data ?? 'id',
          constraint: 'isUuid',
          message: 'Must be a valid UUID',
        },
      ]);
    }
    return value.toLowerCase();
  }
}
