import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger models mirroring the runtime envelopes in `@wlct/shared-types`. */

export class ResponseMetaDto {
  @ApiProperty({ example: '7f3c1d2e-0f8a-4a3b-9c1a-1d2e3f4a5b6c' })
  requestId!: string;

  @ApiProperty({ example: '2026-09-05T09:15:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '1' })
  version!: string;
}

export class ValidationErrorDetailDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'isEmail' })
  constraint!: string;

  @ApiProperty({ example: 'Must be a valid email address' })
  message!: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'The submitted data failed validation.' })
  message!: string;

  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiPropertyOptional({ type: [ValidationErrorDetailDto] })
  details?: ValidationErrorDetailDto[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta!: ResponseMetaDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 137 })
  totalItems!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}
