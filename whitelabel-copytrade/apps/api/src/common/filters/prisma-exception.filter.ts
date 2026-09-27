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
