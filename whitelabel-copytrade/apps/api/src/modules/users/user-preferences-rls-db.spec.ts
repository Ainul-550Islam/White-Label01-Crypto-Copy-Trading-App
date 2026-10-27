import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GlobalValidationPipe } from '../../common/pipes/global-validation.pipe';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('user preferences with forced PostgreSQL RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID();
  const tables = ['users', 'user_preferences'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: UserPreferencesService, app: INestApplication;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `prefs-${id}`, name: 'Preferences RLS test' })) });
    await admin.user.create({ data: { id: user, tenantId: tenant, email: `${user}@example.test`, emailIndex: user.replace(/-/g, ''),
      passwordHash: 'not-a-real-secret', status: 'ACTIVE' } });
    service = new UserPreferencesService(db);
    const module = await Test.createTestingModule({
      controllers: [UserPreferencesController],
      providers: [{ provide: UserPreferencesService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    // Only the test harness injects an actor; the real PermissionsGuard,
    // controller, validation and tenant-scoped PostgreSQL service run below.
    app.use((req: { headers: Record<string, string | undefined>; actor?: unknown }, _res: unknown, next: () => void) => {
      if (req.headers['x-test-actor'] === 'owner') req.actor = { tenantId: tenant, userId: user };
      if (req.headers['x-test-actor'] === 'other-tenant') req.actor = { tenantId: otherTenant, userId: user };
      next();
    });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalGuards(new PermissionsGuard(new Reflector(), {} as never, {} as never));
    await app.init();
  });
  afterAll(async () => {
    if (!admin) return;
    if (app) await app.close();
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('persists all supported locales under the caller’s tenant without exposing another tenant', async () => {
    expect((await service.get(tenant, user)).locale).toBe('en');
    for (const locale of ['en', 'bn', 'ar', 'es', 'tr'] as const) {
      await service.update(tenant, user, { locale, displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' });
      expect((await service.get(tenant, user)).locale).toBe(locale);
    }
    await expect(service.get(otherTenant, user)).rejects.toThrow('User preferences not found');
    expect(await db.userPreferences.count()).toBe(0);
    expect(await admin.userPreferences.count({ where: { tenantId: tenant, userId: user } })).toBe(1);
    await expect(admin.userPreferences.update({ where: { tenantId_userId: { tenantId: tenant, userId: user } }, data: { locale: 'fr' } })).rejects.toThrow();
  });

  it('serves the authenticated self-service HTTP route under forced tenant RLS', async () => {
    const path = '/v1/users/me/preferences';
    const body = { locale: 'ar', displayCurrency: 'USD', timezone: 'Asia/Dhaka', dateFormat: 'ISO' };
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).put(path).send(body).expect(401);
    await request(app.getHttpServer()).get(path).set('x-test-actor', 'other-tenant').expect(404);
    await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner').send({ ...body, locale: 'fr' }).expect(422);
    const saved = await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner')
      .set('Idempotency-Key', 'preferences-intent-123').send(body).expect(200);
    expect(saved.body).toMatchObject(body);
    const reloaded = await request(app.getHttpServer()).get(path).set('x-test-actor', 'owner').expect(200);
    expect(reloaded.body).toMatchObject(body);
    expect(await db.userPreferences.count()).toBe(0);
  });
});
