import { Catch, HttpStatus, Injectable, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Translates Prisma engine errors into safe API responses.
 *
 * Database driver messages routinely contain table names, column names and
 * sometimes parameter values, so they are logged but never returned.
 */
@Injectable()
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(PrismaExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const mapped = this.map(exception);

    this.logger.error(
      {
        event: 'database.error',
        requestId: request?.requestId,
        tenantId: request?.tenantContext?.tenantId,
        userId: request?.actor?.userId,
        prismaCode:
          exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined,
        sqlState:
          exception instanceof Prisma.PrismaClientUnknownRequestError ? postgresSqlState(exception) : undefined,
        statusCode: mapped.statusCode,
        stack: exception.stack,
      },
      `Prisma error: ${exception.message.split('\n')[0]}`,
    );

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.statusCode,
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    httpAdapter.reply(response, body, mapped.statusCode);
  }

  private map(exception: Error): { statusCode: number; code: ErrorCode; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A record with these details already exists.',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation references a record that does not exist.',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: ErrorCode.NOT_FOUND,
            message: 'The requested resource was not found.',
          };
        case 'P2023':
          // A malformed UUID in a path/query value (e.g. GET /traders/abc)
          // reaches the engine as "Inconsistent column data: Error creating
          // UUID". That is a client error; 312 path parameters across the
          // controllers have no ParseUuidPipe, and this used to be a 500.
          // Any other P2023 (stored data not matching the schema) stays a 500.
          if (isMalformedUuid(exception)) {
            return {
              statusCode: HttpStatus.BAD_REQUEST,
              code: ErrorCode.BAD_REQUEST,
              message: 'A malformed identifier was supplied.',
            };
          }
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
        case 'P2034':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicted with a concurrent change. Please retry.',
          };
        default:
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      // Errors the engine has no P-code for arrive here with the PostgreSQL SQLSTATE inside the
      // message (verified on PostgreSQL 17 / Prisma 5.22: an RLS WITH CHECK rejection is
      // `PostgresError { code: "42501", message: "new row violates row-level security policy
      // for table ..." }`). Only the SQLSTATE is used; the message is logged, never returned.
      switch (postgresSqlState(exception)) {
        case '42501':
          // insufficient_privilege - raised by row-level security when the row is outside the
          // transaction's tenant (app.tenant_id). Refused, never a 500 that invites retries.
          return {
            statusCode: HttpStatus.FORBIDDEN,
            code: ErrorCode.FORBIDDEN,
            message: 'The operation is not permitted in this tenant context.',
          };
        case '40001':
        case '40P01':
          // serialization_failure / deadlock_detected - the transaction lost a race.
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicted with a concurrent change. Please retry.',
          };
        case '57014':
          // query_canceled - statement_timeout or an operator cancel.
          return {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'The database did not answer in time. Please retry shortly.',
          };
        default:
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'The request could not be processed due to invalid parameters.',
      };
    }

    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'The database is temporarily unavailable. Please retry shortly.',
    };
  }
}

/**
 * The PostgreSQL SQLSTATE embedded in an unknown-request error's message
 * (`PostgresError { code: "42501", ... }`), or undefined when there is none.
 */
export function postgresSqlState(exception: Prisma.PrismaClientUnknownRequestError): string | undefined {
  const match = /PostgresError\s*\{\s*code:\s*\\?"([0-9A-Z]{5})\\?"/.exec(exception.message);
  return match ? match[1] : undefined;
}

function isMalformedUuid(exception: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = exception.meta as { message?: unknown } | undefined;
  const text = `${exception.message} ${typeof meta?.message === 'string' ? meta.message : ''}`;
  return /Error creating UUID/i.test(text);
}
