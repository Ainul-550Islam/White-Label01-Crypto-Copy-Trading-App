import { ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../../common/constants/metadata.constants';
import { AccountRecoveryController } from './account-recovery.controller';
import { AccountRecoveryRuntimeService } from './account-recovery-runtime.service';

describe('account recovery fail-closed HTTP boundary', () => {
  it('does not reveal accounts or secrets when the recovery dependency is unavailable', async () => {
    const unavailable = () => { throw new ServiceUnavailableException('Account recovery is temporarily unavailable.'); };
    const module = await Test.createTestingModule({ controllers: [AccountRecoveryController], providers: [
      { provide: AccountRecoveryRuntimeService, useValue: { request: unavailable, verify: unavailable, complete: unavailable } },
    ] }).compile();
    const app = module.createNestApplication();
    app.use((req: { tenantContext?: unknown; requestId?: string; correlationId?: string; ipHash?: string; locale?: string }, _res: unknown, next: () => void) => {
      req.tenantContext = { tenantId: 'test-tenant', slug: 'test' }; req.requestId = 'test'; req.correlationId = 'test'; req.ipHash = 'test'; req.locale = 'en'; next();
    });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    try {
      const known = await request(app.getHttpServer()).post('/v1/auth/recovery/request').set('Idempotency-Key', 'request-known').send({ email: 'known@example.com' }).expect(503);
      const unknown = await request(app.getHttpServer()).post('/v1/auth/recovery/request').set('Idempotency-Key', 'request-unknown').send({ email: 'unknown@example.com' }).expect(503);
      expect(unknown.body).toEqual(known.body);
      expect(JSON.stringify(known.body)).not.toMatch(/known@example|deliveryQueued|tokenForDelivery/i);
      const verify = await request(app.getHttpServer()).post('/v1/auth/recovery/verify').send({ token: 'A'.repeat(43) }).expect(503);
      const complete = await request(app.getHttpServer()).post('/v1/auth/recovery/complete').set('Idempotency-Key', 'complete-retry').send({ token: 'A'.repeat(43), newPassword: 'StrongPassword!234' }).expect(503);
      expect(JSON.stringify([verify.body, complete.body])).not.toMatch(/A{20}|StrongPassword|RECOVERED/);
      const reflector = new Reflector();
      for (const method of ['request', 'verify', 'complete'] as const) expect(reflector.get(IS_PUBLIC_KEY, AccountRecoveryController.prototype[method])).toBe(true);
    } finally { await app.close(); }
  });
});
