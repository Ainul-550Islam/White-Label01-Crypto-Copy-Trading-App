import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DeveloperController } from './developer.controller';
import { DeveloperApplicationService } from './developer-application.service';
import { DeveloperVersionPinService } from './developer-version-pin.service';
import { DeveloperError, DEVELOPER_ERROR_CODES } from './developer.types';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { StepUpGuard } from '../auth/step-up/step-up.guard';
import { ResponseTransformInterceptor } from '../../common/interceptors/response-transform.interceptor';
import { GlobalValidationPipe } from '../../common/pipes/global-validation.pipe';
import { FeatureFlagsController } from '../feature-flags/feature-flags.controller';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const actor = { tenantId: '11111111-1111-4111-8111-111111111111', userId: 'user', sessionId: 'session' };

describe('developer step-up HTTP boundary', () => {
  let app: INestApplication;
  let proof: string | null = null;
  const hooks = { pause: jest.fn(), resume: jest.fn(), revoke: jest.fn().mockResolvedValue(undefined) };
  const applications = { revoke: jest.fn().mockResolvedValue(undefined), requestReactivation: jest.fn().mockResolvedValue('ACTIVE') };
  const pins = { set: jest.fn().mockResolvedValue({ applicationId: actor.tenantId, version: 'v2' }) };
  const flags = { setForTenant: jest.fn().mockResolvedValue({ key: 'copy_trading', enabled: true }), upsertDefinition: jest.fn().mockResolvedValue({ key: 'copy_trading' }) };
  const consume = jest.fn(async (_actor: unknown, expected: string) => {
    if (proof !== expected) return false;
    proof = null;
    return true;
  });
  beforeAll(async () => {
    const dependencies = Reflect.getMetadata('design:paramtypes', DeveloperController) as Array<new (...args: never[]) => unknown>;
    const module = await Test.createTestingModule({
      controllers: [DeveloperController, FeatureFlagsController],
      providers: [...dependencies.map((type) => ({ provide: type, useValue: type === WebhookSubscriptionService ? hooks : type === DeveloperApplicationService ? applications : type === DeveloperVersionPinService ? pins : {} })), { provide: FeatureFlagsService, useValue: flags }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { actor?: unknown; user?: unknown; tenantContext?: unknown; requestId?: string; ipHash?: string }, _res: unknown, next: () => void) => {
      req.actor = actor; req.user = actor; req.tenantContext = { tenantId: actor.tenantId };
      req.requestId = 'req'; req.ipHash = 'hash'; next();
    });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalGuards(new StepUpGuard(new Reflector(), { consumeForRoute: consume } as never));
    app.useGlobalInterceptors(new ResponseTransformInterceptor(new Reflector(), { defaultApiVersion: 'v1' } as never));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { proof = null; consume.mockClear(); hooks.revoke.mockClear(); applications.revoke.mockClear(); applications.requestReactivation.mockClear(); flags.setForTenant.mockClear(); flags.upsertDefinition.mockClear(); });

  it('redirects the legacy multiplexed route without mutating; only a revoke proof can follow it', async () => {
    proof = 'WEBHOOK_PAUSE';
    const alias = await request(app.getHttpServer()).post('/developer-platform/webhooks/sub/actions')
      .set('Idempotency-Key', 'request-key-123').send({ action: 'revoke' }).expect(307);
    expect(alias.headers.location).toBe('/developer-platform/webhooks/sub/revoke');
    expect(hooks.revoke).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(alias.headers.location).set('Idempotency-Key', 'request-key-123').send({ action: 'revoke' }).expect(403);
    expect(hooks.revoke).not.toHaveBeenCalled();
    proof = 'WEBHOOK_REVOKE';
    await request(app.getHttpServer()).post(alias.headers.location).set('Idempotency-Key', 'request-key-123').send({ action: 'revoke' }).expect(201);
    expect(hooks.revoke).toHaveBeenCalledWith(expect.objectContaining({ tenantId: actor.tenantId, actorId: actor.userId }), 'sub', undefined, 'request-key-123');
    await request(app.getHttpServer()).post(alias.headers.location).set('Idempotency-Key', 'request-key-123').send({ action: 'revoke' }).expect(403);
    expect(hooks.revoke).toHaveBeenCalledTimes(1);
  });

  it('redirects application transitions to the action-specific proof gate', async () => {
    proof = 'DEVELOPER_APPLICATION_SUSPEND';
    const alias = await request(app.getHttpServer()).post('/developer-platform/applications/app/transitions')
      .set('Idempotency-Key', 'application-request-123').send({ targetState: 'REVOKED' }).expect(307);
    expect(alias.headers.location).toBe('/developer-platform/applications/app/revoke');
    expect(applications.revoke).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(alias.headers.location).set('Idempotency-Key', 'application-request-123').send({ targetState: 'REVOKED' }).expect(403);
    proof = 'DEVELOPER_APPLICATION_REVOKE';
    await request(app.getHttpServer()).post(alias.headers.location).set('Idempotency-Key', 'application-request-123').send({ targetState: 'REVOKED' }).expect(200);
    expect(applications.revoke).toHaveBeenCalledTimes(1);
    proof = 'DEVELOPER_APPLICATION_REACTIVATE';
    const result = await request(app.getHttpServer()).post('/developer-platform/applications/app/request-reactivation')
      .set('Idempotency-Key', 'application-request-124').send({ targetState: 'REACTIVATION_REVIEW' }).expect(200);
    expect(result.body.data.state).toBe('ACTIVE');
  });

  it('requires a version-pin-specific proof and an idempotency key', async () => {
    const path = `/developer-platform/applications/${actor.tenantId}/api-version`;
    proof = 'DEVELOPER_APPLICATION_UPDATE';
    await request(app.getHttpServer()).put(path).set('Idempotency-Key', 'version-pin-request').send({ version: 'v2' }).expect(403);
    expect(pins.set).not.toHaveBeenCalled();
    proof = 'DEVELOPER_APPLICATION_VERSION_PIN';
    await request(app.getHttpServer()).put(path).set('Idempotency-Key', 'version-pin-request').send({ version: 'v2' }).expect(200);
    expect(pins.set).toHaveBeenCalledWith(expect.objectContaining({ tenantId: actor.tenantId }), actor.tenantId, 'v2', 'version-pin-request');
  });

  it('requires and consumes a flag-specific proof before a real flag HTTP handler', async () => {
    const body = { key: 'copy_trading', enabled: true };
    await request(app.getHttpServer()).put('/feature-flags').set('Idempotency-Key', 'flag-request-key-123').send(body).expect(403);
    proof = 'WEBHOOK_PAUSE';
    await request(app.getHttpServer()).put('/feature-flags').set('Idempotency-Key', 'flag-request-key-123').send(body).expect(403);
    expect(flags.setForTenant).not.toHaveBeenCalled();
    proof = 'FEATURE_FLAG_LIVE_TOGGLE';
    await request(app.getHttpServer()).put('/feature-flags').set('Idempotency-Key', 'flag-request-key-123').send(body).expect(200);
    expect(flags.setForTenant).toHaveBeenCalledWith(actor.tenantId, body, expect.objectContaining({ actorId: actor.userId }), 'flag-request-key-123');
    await request(app.getHttpServer()).put('/feature-flags').set('Idempotency-Key', 'flag-request-key-123').send(body).expect(403);
    expect(flags.setForTenant).toHaveBeenCalledTimes(1);
  });

  it('requires an idempotency key for platform flag definitions', async () => {
    proof = 'FEATURE_FLAG_LIVE_TOGGLE';
    await request(app.getHttpServer()).post('/feature-flags/definitions').send({ key: 'copy_trading', name: 'Copy trading' }).expect(400);
    expect(flags.upsertDefinition).not.toHaveBeenCalled();
    proof = 'FEATURE_FLAG_LIVE_TOGGLE';
    await request(app.getHttpServer()).post('/feature-flags/definitions').set('Idempotency-Key', 'definition-request-123')
      .send({ key: 'copy_trading', name: 'Copy trading' }).expect(200);
    expect(flags.upsertDefinition).toHaveBeenCalledWith(expect.objectContaining({ key: 'copy_trading' }), expect.objectContaining({ tenantId: actor.tenantId }), 'definition-request-123');
  });

  it('accepts the exact platform kill-switch key but rejects other dotted definition keys', async () => {
    proof = 'FEATURE_FLAG_LIVE_TOGGLE';
    await request(app.getHttpServer()).post('/feature-flags/definitions').set('Idempotency-Key', 'definition-request-124')
      .send({ key: 'platform.kill_switch', name: 'Kill switch' }).expect(200);
    expect(flags.upsertDefinition).toHaveBeenCalledWith(expect.objectContaining({ key: 'platform.kill_switch' }), expect.anything(), 'definition-request-124');
    proof = 'FEATURE_FLAG_LIVE_TOGGLE';
    await request(app.getHttpServer()).post('/feature-flags/definitions').set('Idempotency-Key', 'definition-request-125')
      .send({ key: 'platform.other', name: 'Other' }).expect(422);
  });

  it('maps developer policy errors to safe HTTP responses without echoing secret input', async () => {
    proof = 'WEBHOOK_PAUSE';
    hooks.pause.mockRejectedValueOnce(new DeveloperError(DEVELOPER_ERROR_CODES.POLICY_LIMIT, 'devsec_never_echo_this'));
    const response = await request(app.getHttpServer()).post('/developer-platform/webhooks/sub/pause')
      .set('Idempotency-Key', 'request-key-123').send({}).expect(403);
    expect(response.body.error.code).toBe(DEVELOPER_ERROR_CODES.POLICY_LIMIT);
    expect(JSON.stringify(response.body)).not.toContain('devsec_');
  });

  it('requires distinct action metadata on each webhook mutation and on flag writes', () => {
    const expected: Record<string, string> = {
      createApplication: 'DEVELOPER_APPLICATION_CREATE', updateApplication: 'DEVELOPER_APPLICATION_UPDATE',
      addRedirectUri: 'DEVELOPER_APPLICATION_UPDATE', updateScopes: 'DEVELOPER_APPLICATION_SCOPE_CHANGE',
      activateApplication: 'DEVELOPER_APPLICATION_ACTIVATE', suspendApplication: 'DEVELOPER_APPLICATION_SUSPEND',
      requestApplicationReactivation: 'DEVELOPER_APPLICATION_REACTIVATE', revokeApplication: 'DEVELOPER_APPLICATION_REVOKE',
      approveApplicationReactivation: 'DEVELOPER_APPLICATION_APPROVE', pinApplicationVersion: 'DEVELOPER_APPLICATION_VERSION_PIN',
      createWebhook: 'WEBHOOK_CREATE', updateWebhook: 'WEBHOOK_UPDATE', pauseWebhook: 'WEBHOOK_PAUSE',
      resumeWebhook: 'WEBHOOK_RESUME', revokeWebhook: 'WEBHOOK_REVOKE',
      rotateWebhookSecret: 'WEBHOOK_SECRET_ROTATE', replayWebhook: 'WEBHOOK_REPLAY',
    };
    for (const [method, action] of Object.entries(expected)) {
      expect(Reflect.getMetadata('security:require-step-up', (DeveloperController.prototype as unknown as Record<string, object>)[method])).toBe(action);
    }
    expect(Reflect.getMetadata('security:require-step-up', FeatureFlagsController.prototype.setForTenant)).toBe('FEATURE_FLAG_LIVE_TOGGLE');
    expect(Reflect.getMetadata('security:require-step-up', FeatureFlagsController.prototype.upsertDefinition)).toBe('FEATURE_FLAG_LIVE_TOGGLE');
  });
});
