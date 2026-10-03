import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';

import type { AppConfigService } from '../../config/app-config.service';

import { PrismaExceptionFilter, postgresSqlState } from './prisma-exception.filter';

/**
 * The P2023 fixtures are the exact code/meta/message Prisma 5.22 produced on
 * PostgreSQL 16 for `traderProfile.findFirst({ where: { id: 'not-a-uuid' } })`.
 * Before the fix this fell through to the default branch: HTTP 500 for any
 * request with a malformed id in a path parameter that has no ParseUuidPipe.
 */
describe('PrismaExceptionFilter', () => {
  function run(exception: Error) {
    const reply = jest.fn();
    const filter = new PrismaExceptionFilter(
      { httpAdapter: { reply } } as unknown as HttpAdapterHost,
      { defaultApiVersion: '1' } as unknown as AppConfigService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-1' }), getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    const [, body, status] = reply.mock.calls[0] as [unknown, { error: { code: string; message: string } }, number];
    return { status, body };
  }

  const known = (code: string, message: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0', meta });

  const UUID_MESSAGE =
    'Error creating UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1';

  it('maps a malformed UUID (P2023) to 400 without leaking the driver message', () => {
    const { status, body } = run(
      known('P2023', `\nInvalid \`prisma.traderProfile.findFirst()\` invocation:\n\nInconsistent column data: ${UUID_MESSAGE}`, {
        modelName: 'TraderProfile',
        message: UUID_MESSAGE,
      }),
    );
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('A malformed identifier was supplied.');
    expect(JSON.stringify(body)).not.toContain('TraderProfile');
  });

  it('keeps other P2023 data inconsistencies as 500', () => {
    const { status } = run(known('P2023', 'Inconsistent column data: Could not convert value "abc" of the field `amount`'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('keeps the existing mappings', () => {
    expect(run(known('P2002', 'Unique constraint failed')).status).toBe(HttpStatus.CONFLICT);
    expect(run(known('P2025', 'Record not found')).status).toBe(HttpStatus.NOT_FOUND);
    expect(run(new Prisma.PrismaClientValidationError('Argument `take` is missing.', { clientVersion: '5.22.0' })).status).toBe(
      HttpStatus.BAD_REQUEST,
    );
    expect(run(known('P2010', 'Raw query failed')).status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // Exact shape produced by Prisma 5.22 on PostgreSQL 17 (round-7 probe: FORCE ROW LEVEL SECURITY
  // on custody_wallets, insert by a NOBYPASSRLS role without app.tenant_id).
  const unknown = (sqlState: string, text: string) =>
    new Prisma.PrismaClientUnknownRequestError(
      `\nInvalid \`prisma.custodyWallet.create()\` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sqlState}", message: "${text}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
      { clientVersion: '5.22.0' },
    );

  it('maps a row-level security rejection (SQLSTATE 42501) to 403 without leaking the table', () => {
    const { status, body } = run(unknown('42501', 'new row violates row-level security policy for table \\"custody_wallets\\"'));
    expect(status).toBe(HttpStatus.FORBIDDEN);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('The operation is not permitted in this tenant context.');
    expect(JSON.stringify(body)).not.toContain('custody_wallets');
    expect(JSON.stringify(body)).not.toContain('row-level');
  });

  it('maps serialization failures and deadlocks to 409 and statement timeouts to 503', () => {
    expect(run(unknown('40001', 'could not serialize access due to concurrent update')).status).toBe(HttpStatus.CONFLICT);
    expect(run(unknown('40P01', 'deadlock detected')).status).toBe(HttpStatus.CONFLICT);
    expect(run(unknown('57014', 'canceling statement due to statement timeout')).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('keeps any other unknown request error a generic 500', () => {
    const { status, body } = run(unknown('22P02', 'invalid input syntax for type json'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe('An unexpected database error occurred.');
    expect(run(new Prisma.PrismaClientUnknownRequestError('engine said something odd', { clientVersion: '5.22.0' })).status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('extracts the SQLSTATE and nothing else', () => {
    expect(postgresSqlState(unknown('42501', 'x'))).toBe('42501');
    expect(postgresSqlState(new Prisma.PrismaClientUnknownRequestError('no code here', { clientVersion: '5.22.0' }))).toBeUndefined();
  });
});
