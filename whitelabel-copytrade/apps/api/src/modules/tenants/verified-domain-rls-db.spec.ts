import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TenantResolutionMiddleware } from '../../common/middleware/tenant-resolution.middleware';
import { TenantResolverService } from './tenant-resolver.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('verified custom-domain resolution under forced RLS', () => {
  const tenantId = randomUUID(), otherId = randomUUID();
  const domain = `secure-${randomUUID()}.customer.test`, unverified = `pending-${randomUUID()}.customer.test`;
  const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
  const db = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger);
  let admin: PrismaService, app: PrismaService, resolver: TenantResolverService;

  beforeAll(async () => {
    admin = db(adminUrl!); app = db(rlsUrl!);
    const flags = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.tenant_domains'::regclass
    `;
    expect(flags).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    await admin.tenant.createMany({ data: [tenantId, otherId].map((id) => ({ id, slug: `domain-${id}`, name: 'Domain test', status: 'ACTIVE' })) });
    await admin.tenantDomain.createMany({ data: [
      { tenantId, domain, isPrimary: true, status: 'ACTIVE', verificationToken: 'private-verification-token', verifiedAt: new Date(),
        certificateExpiry: new Date(Date.now() + 60000) },
      { tenantId: otherId, domain: unverified, status: 'ACTIVE', verificationToken: 'other-private-token', verifiedAt: null,
        certificateExpiry: new Date(Date.now() + 60000) },
    ] });
    resolver = new TenantResolverService(app, {} as never);
  });
  afterAll(async () => {
    if (admin) { await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }); await app.$disconnect(); await admin.$disconnect(); }
  });

  it('resolves only public tenant identity without opening unscoped table reads', async () => {
    expect(await app.tenantDomain.count()).toBe(0);
    const resolved = await resolver.resolveByDomain(domain.toUpperCase());
    expect(resolved).toMatchObject({ tenantId, slug: `domain-${tenantId}`, status: 'ACTIVE' });
    expect(JSON.stringify(resolved)).not.toContain('private-verification-token');
    expect(await resolver.resolveByDomain(unverified)).toBeNull();
    expect(await resolver.resolveByDomain(`absent-${randomUUID()}.customer.test`)).toBeNull();
    expect(await resolver.resolveByDomain(`${domain}/extra`)).toBeNull();
    const middleware = new TenantResolutionMiddleware(resolver, { platformRootDomain: 'platform.test', defaultTenantSlug: 'no-default' } as never);
    const request = { headers: { host: domain } } as any;
    await new Promise<void>((resolve) => { void middleware.use(request, {} as never, () => resolve()); });
    expect(request.tenantContext).toMatchObject({ tenantId, source: 'domain' });
  });

  it('stops resolving immediately when the certificate expires or the domain is disabled', async () => {
    await admin.tenantDomain.update({ where: { domain }, data: { certificateExpiry: new Date(Date.now() - 1000) } });
    expect(await resolver.resolveByDomain(domain)).toBeNull();
    await admin.tenantDomain.update({ where: { domain }, data: { certificateExpiry: new Date(Date.now() + 60000), status: 'FAILED' } });
    expect(await resolver.resolveByDomain(domain)).toBeNull();
  });
});
