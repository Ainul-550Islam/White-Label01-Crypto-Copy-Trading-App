// # Responsibility: prove share links resist tampering, expire and revoke, and that their projection can never publish follower or balance data.
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  PublicShareRateLimiter,
  PublicShareService,
  type PublicShareLinkRecord,
  type PublicShareRepository,
  type ShareSubjectType,
  type ShareSubjectPort,
} from './public-share.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const SUBJECT = '44444444-4444-4444-8444-444444444444';
const KEY = 'unit-share-signing-key-0123456789';
const NOW = new Date('2026-10-26T12:00:00.000Z');

class MemoryShareRepository implements PublicShareRepository {
  rows: PublicShareLinkRecord[] = [];

  async create(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
    tokenId: string;
    expiresAt: Date;
    fields: string[];
  }): Promise<PublicShareLinkRecord> {
    const row: PublicShareLinkRecord = {
      id: `share-${this.rows.length + 1}`,
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tokenId: input.tokenId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      fieldsJson: input.fields,
    };
    this.rows.push(row);
    return row;
  }

  async findByTokenId(tokenId: string): Promise<PublicShareLinkRecord | null> {
    return this.rows.find((row) => row.tokenId === tokenId) ?? null;
  }

  async revoke(input: { tenantId: string; ownerUserId: string; id: string; at: Date }): Promise<PublicShareLinkRecord | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === input.id &&
        candidate.tenantId === input.tenantId &&
        candidate.ownerUserId === input.ownerUserId,
    );
    if (!row) return null;
    row.revokedAt = input.at;
    return row;
  }

  async listForOwner(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType?: ShareSubjectType;
    subjectId?: string;
  }): Promise<PublicShareLinkRecord[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === input.tenantId &&
        row.ownerUserId === input.ownerUserId &&
        (input.subjectType === undefined || row.subjectType === input.subjectType) &&
        (input.subjectId === undefined || row.subjectId === input.subjectId),
    );
  }
}

interface LoadInput {
  tenantId: string;
  subjectType: ShareSubjectType;
  subjectId: string;
}

describe('Public share links', () => {
  let repository: MemoryShareRepository;
  let loadMock: jest.Mock<Promise<Record<string, unknown> | null>, [LoadInput]>;
  let subjects: ShareSubjectPort;
  let clock: Date;
  let service: PublicShareService;

  beforeEach(() => {
    repository = new MemoryShareRepository();
    clock = new Date(NOW);
    loadMock = jest.fn<Promise<Record<string, unknown> | null>, [LoadInput]>(async () => ({
        displayName: 'Ada Trader',
        headline: 'Momentum, mostly BTC',
        returnPercent30d: '12.40',
        maxDrawdownPercent: '6.10',
        // Facts a projection must never publish, present here on purpose.
        followerCount: 812,
        balance: '104000.00',
        email: 'ada@example.com',
    }));
    subjects = { load: loadMock };
    service = new PublicShareService(repository, subjects, { signingKey: KEY, now: () => clock });
  });

  async function createShare(fields = ['displayName', 'returnPercent30d']): Promise<string> {
    const created = await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'TRADER',
      subjectId: SUBJECT,
      fields,
    });
    if (!('token' in created)) throw new Error(`create refused: ${created.refused}`);
    return created.token;
  }

  it('issues a signed token and resolves it to the opted-in fields only', async () => {
    const token = await createShare(['displayName', 'returnPercent30d', 'maxDrawdownPercent']);

    const resolved = await service.resolve(token);

    expect(resolved.found).toBe(true);
    expect(resolved.fields).toEqual({
      displayName: 'Ada Trader',
      returnPercent30d: '12.40',
      maxDrawdownPercent: '6.10',
    });
    // The disallowed facts exist on the subject and are still absent.
    expect(JSON.stringify(resolved.fields)).not.toContain('812');
    expect(JSON.stringify(resolved.fields)).not.toContain('ada@example.com');
  });

  it('refuses a tampered signature', async () => {
    const token = await createShare();
    const [id] = token.split('.');
    const tampered = `${id}.${'A'.repeat(43)}`;

    expect((await service.resolve(tampered)).reason).toBe('INVALID_TOKEN');
    expect((await service.resolve(`${id}`)).reason).toBe('INVALID_TOKEN');
    expect((await service.resolve('')).reason).toBe('INVALID_TOKEN');
  });

  it('refuses a re-pointed token: a valid signature cannot be moved to another id', async () => {
    const token = await createShare();
    const signature = token.split('.')[1];
    const otherId = '55555555-5555-4555-8555-555555555555';

    expect((await service.resolve(`${otherId}.${signature}`)).reason).toBe('INVALID_TOKEN');
  });

  it('stays valid up to the expiry instant and expires at it', async () => {
    const token = await createShare();

    clock = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000 - 1);
    expect((await service.resolve(token)).found).toBe(true);

    clock = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000);
    expect(await service.resolve(token)).toMatchObject({ found: false, reason: 'EXPIRED', fields: {} });
  });

  it('refuses a revoked link immediately', async () => {
    const token = await createShare();
    const row = repository.rows[0];

    const revoked = await service.revoke({ tenantId: TENANT, ownerUserId: OWNER, id: row.id });

    expect(revoked.revoked).toBe(true);
    expect(await service.resolve(token)).toMatchObject({ found: false, reason: 'REVOKED' });
  });

  it('does not let another tenant or user revoke this link', async () => {
    const token = await createShare();
    const row = repository.rows[0];

    const otherTenant = await service.revoke({ tenantId: OTHER_TENANT, ownerUserId: OWNER, id: row.id });
    const otherUser = await service.revoke({ tenantId: TENANT, ownerUserId: 'someone-else', id: row.id });

    expect(otherTenant.revoked).toBe(false);
    expect(otherUser.revoked).toBe(false);
    expect((await service.resolve(token)).found).toBe(true);
  });

  it('drops every field that is not on the allow-list, whatever the client asks for', async () => {
    const token = await createShare([
      'displayName',
      'followerCount',
      'balance',
      'email',
      'followerIds',
      'notAField',
    ]);
    const row = repository.rows[0];

    expect(row.fieldsJson).toEqual(['displayName']);
    const resolved = await service.resolve(token);
    expect(Object.keys(resolved.fields)).toEqual(['displayName']);
  });

  it('refuses to create a link whose every requested field is unshareable', async () => {
    const created = await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'TRADER',
      subjectId: SUBJECT,
      fields: ['balance', 'email'],
    });

    expect(created).toEqual({ refused: 'NOTHING_SHAREABLE' });
    expect(repository.rows).toHaveLength(0);
  });

  it('refuses to create a link for a subject that does not belong to the tenant', async () => {
    loadMock.mockResolvedValueOnce(null);

    const created = await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'STRATEGY',
      subjectId: SUBJECT,
      fields: ['strategyName'],
    });

    expect(created).toEqual({ refused: 'SUBJECT_UNAVAILABLE' });
  });

  it('loads the subject in the link’s own tenant, not the caller’s', async () => {
    const token = await createShare();
    await service.resolve(token);

    expect(loadMock).toHaveBeenLastCalledWith({
      tenantId: TENANT,
      subjectType: 'TRADER',
      subjectId: SUBJECT,
    });
  });

  it('clamps the requested expiry instead of accepting it', async () => {
    const short = await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'TRADER',
      subjectId: SUBJECT,
      fields: ['displayName'],
      expiryDays: -5,
    });
    const long = await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'TRADER',
      subjectId: SUBJECT,
      fields: ['displayName'],
      expiryDays: 10_000,
    });

    expect('expiresAt' in short && short.expiresAt).toBe('2026-10-27T12:00:00.000Z');
    expect('expiresAt' in long && long.expiresAt).toBe('2027-10-26T12:00:00.000Z');
  });

  it('reports the projection as missing rather than empty when the subject vanished', async () => {
    const token = await createShare();
    loadMock.mockResolvedValueOnce(null);

    expect(await service.resolve(token)).toMatchObject({
      found: false,
      reason: 'SUBJECT_UNAVAILABLE',
      fields: {},
    });
  });

  it('lists only the owner’s links, optionally narrowed by subject', async () => {
    await createShare();
    await service.create({
      tenantId: TENANT,
      ownerUserId: OWNER,
      subjectType: 'STRATEGY',
      subjectId: '66666666-6666-4666-8666-666666666666',
      fields: ['strategyName'],
    });

    const all = await service.list({ tenantId: TENANT, ownerUserId: OWNER });
    const tradersOnly = await service.list({ tenantId: TENANT, ownerUserId: OWNER, subjectType: 'TRADER' });

    expect(all).toHaveLength(2);
    expect(tradersOnly).toHaveLength(1);
    expect(tradersOnly[0].subjectType).toBe('TRADER');
  });

  it('never returns the signing key or the raw subject row in any response', async () => {
    const token = await createShare();
    const resolved = await service.resolve(token);
    const listed = await service.list({ tenantId: TENANT, ownerUserId: OWNER });

    const serialised = JSON.stringify({ resolved, listed });
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain('followerCount');
    expect(token).toContain('.');
  });

  it('refuses to construct without a signing key', () => {
    expect(() => new PublicShareService(repository, subjects, {})).toThrow(/signing key/);
  });

  it('refuses a token signed with a different key, even when the id is real', async () => {
    await createShare();
    const otherKey = new PublicShareService(repository, subjects, { signingKey: 'another-key-0123456789', now: () => clock });
    const tokenId = repository.rows[0].tokenId;

    expect(otherKey.verify(otherKey.sign(tokenId))).toBe(tokenId);
    expect(service.verify(otherKey.sign(tokenId))).toBeNull();
    expect((await service.resolve(otherKey.sign(tokenId))).reason).toBe('INVALID_TOKEN');
  });

  it('answers noindex unless the subject owner opted in', async () => {
    const token = await createShare();

    // No isIndexable on the port: fail closed.
    expect((await service.resolve(token)).indexable).toBe(false);

    const optedIn: ShareSubjectPort = { load: loadMock, isIndexable: async () => true };
    const optingService = new PublicShareService(repository, optedIn, { signingKey: KEY, now: () => clock });
    expect((await optingService.resolve(token)).indexable).toBe(true);

    const throwing: ShareSubjectPort = {
      load: loadMock,
      isIndexable: async () => {
        throw new Error('profile service unavailable');
      },
    };
    const failingService = new PublicShareService(repository, throwing, { signingKey: KEY, now: () => clock });
    expect((await failingService.resolve(token)).indexable).toBe(false);
  });
});

describe('Public share rate limiter', () => {
  it('allows the budget, then refuses with a retry hint until the window passes', () => {
    let now = 1_000_000;
    const limiter = new PublicShareRateLimiter(3, 60_000, () => now);

    expect(limiter.check('ip-a').allowed).toBe(true);
    expect(limiter.check('ip-a').allowed).toBe(true);
    expect(limiter.check('ip-a').remaining).toBe(0);

    const refused = limiter.check('ip-a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    // A different client is unaffected.
    expect(limiter.check('ip-b').allowed).toBe(true);

    // The oldest hit ages out of the window and one slot reopens.
    now += 60_000;
    const reopened = limiter.check('ip-a');
    expect(reopened.allowed).toBe(true);
    expect(reopened.remaining).toBe(2);
  });

  it('does not grow without bound as new keys appear', () => {
    let now = 0;
    const limiter = new PublicShareRateLimiter(2, 1_000, () => now);
    for (let index = 0; index < 500; index += 1) limiter.check(`key-${index}`);
    now += 5_000;
    // A sweep happens on the next admitted request; the map must not keep the old keys.
    limiter.check('fresh');
    limiter.check('fresh');
    expect(limiter.check('fresh').allowed).toBe(false);
  });
});
