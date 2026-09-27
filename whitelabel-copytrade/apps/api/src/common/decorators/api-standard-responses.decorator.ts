import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-response.dto';

/**
 * Documents the error envelopes that any endpoint may return, so the generated
 * OpenAPI document matches what the exception filter actually produces.
 */
export const ApiStandardResponses = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status: 400,
      description: 'Malformed request.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 401,
      description: 'Missing, expired or invalid access token.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 403,
      description: 'Authenticated but not permitted (RBAC, tenancy or feature flag).',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 422,
      description: 'Validation failed. `error.details` lists the offending fields.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 429,
      description: 'Rate limit exceeded.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 500,
      description: 'Unexpected server error. Quote the `meta.requestId` in support tickets.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
  );
