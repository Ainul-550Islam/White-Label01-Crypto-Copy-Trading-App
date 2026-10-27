import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DEVELOPER_ERROR_CODES as C, DeveloperError } from './developer.types';

/** Known policy and validation failures are not internal-server errors. */
@Catch(DeveloperError)
export class DeveloperErrorFilter implements ExceptionFilter {
  catch(error: DeveloperError, host: ArgumentsHost): void {
    const forbidden: string[] = [C.TENANT_MISMATCH, C.SCOPE_NOT_ALLOWED, C.SCOPE_ESCALATION, C.APPLICATION_REVOKED, C.APPLICATION_SUSPENDED, C.POLICY_LIMIT, C.ENVIRONMENT_MISMATCH];
    const conflict: string[] = [C.INVALID_TRANSITION, C.CODE_REPLAYED, C.WEBHOOK_REPLAYED];
    const unauthorized: string[] = [C.CODE_INVALID, C.CODE_EXPIRED, C.TOKEN_REVOKED, C.PKCE_VERIFIER_MISMATCH];
    const status = forbidden.includes(error.code) ? HttpStatus.FORBIDDEN
      : conflict.includes(error.code) ? HttpStatus.CONFLICT
      : unauthorized.includes(error.code) ? HttpStatus.UNAUTHORIZED
      : error.code === C.NOT_FOUND ? HttpStatus.NOT_FOUND
      : error.code === C.RATE_LIMITED ? HttpStatus.TOO_MANY_REQUESTS
      : error.code === C.RECONCILIATION ? HttpStatus.INTERNAL_SERVER_ERROR
      : HttpStatus.BAD_REQUEST;
    const response = host.switchToHttp().getResponse<Response>();
    const retry = error.detail?.retryAfterSeconds;
    if (status === HttpStatus.TOO_MANY_REQUESTS && typeof retry === 'number' && Number.isInteger(retry) && retry > 0 && retry <= 3600) {
      response.setHeader('Retry-After', String(retry));
    }
    response.setHeader('Cache-Control', 'no-store');
    // Details and error.message may include caller input. The portal gets a
    // stable code and safe text, never stack traces or secret-bearing input.
    response.status(status).json({
      success: false,
      error: { code: error.code, message: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'The request could not be completed.' : 'The request is not permitted or is invalid.' },
    });
  }
}
