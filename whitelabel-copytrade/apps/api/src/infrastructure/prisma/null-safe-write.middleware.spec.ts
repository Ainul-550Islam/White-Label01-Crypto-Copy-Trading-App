import { Prisma } from '@prisma/client';

import {
  buildNullSafeFieldIndex,
  createNullSafeWriteMiddleware,
  normaliseWriteArgs,
  nullSafeFieldIndexFromClient,
  type NullSafeFieldIndex,
} from './null-safe-write.middleware';

const field = (
  name: string,
  type: string,
  extra: Partial<{ kind: string; isList: boolean; isRequired: boolean }> = {},
) => ({
  name,
  type,
  kind: extra.kind ?? 'scalar',
  isList: extra.isList ?? false,
  isRequired: extra.isRequired ?? false,
});

const MODELS = [
  {
    name: 'Widget',
    fields: [
      field('id', 'String', { isRequired: true }),
      field('metadata', 'Json'),
      field('payload', 'Json', { isRequired: true }),
      field('tags', 'String', { isList: true, isRequired: true }),
      field('note', 'String'),
      field('owner', 'User', { kind: 'object' }),
    ],
  },
  { name: 'Plain', fields: [field('id', 'String', { isRequired: true }), field('name', 'String')] },
];

describe('buildNullSafeFieldIndex', () => {
  const index = buildNullSafeFieldIndex(MODELS);

  it('classifies optional Json, required Json and scalar lists', () => {
    expect(index.get('Widget')?.get('metadata')).toBe('json-optional');
    expect(index.get('Widget')?.get('payload')).toBe('json-required');
    expect(index.get('Widget')?.get('tags')).toBe('list');
  });

  it('ignores plain scalars and relation fields', () => {
    expect(index.get('Widget')?.has('note')).toBe(false);
    expect(index.get('Widget')?.has('owner')).toBe(false);
  });

  it('omits models with nothing to rewrite', () => {
    expect(index.has('Plain')).toBe(false);
  });
});

describe('normaliseWriteArgs', () => {
  const index: NullSafeFieldIndex = buildNullSafeFieldIndex(MODELS);

  it('create: optional Json null becomes DbNull, required Json and list nulls are dropped', () => {
    const out = normaliseWriteArgs(index, 'Widget', 'create', {
      data: { id: 'w1', metadata: null, payload: null, tags: null, note: null },
    }) as { data: Record<string, unknown> };
    expect(out.data.metadata).toBe(Prisma.DbNull);
    expect('payload' in out.data).toBe(false);
    expect('tags' in out.data).toBe(false);
    // plain nullable scalars are Prisma-legal as null and must pass through
    expect(out.data.note).toBeNull();
    expect(out.data.id).toBe('w1');
  });

  it('update: a null list clears to [] instead of being dropped', () => {
    const out = normaliseWriteArgs(index, 'Widget', 'update', {
      where: { id: 'w1' },
      data: { tags: null, metadata: null },
    }) as { where: unknown; data: Record<string, unknown> };
    expect(out.data.tags).toEqual([]);
    expect(out.data.metadata).toBe(Prisma.DbNull);
    expect(out.where).toEqual({ id: 'w1' });
  });

  it('upsert rewrites create and update branches with their own rules', () => {
    const out = normaliseWriteArgs(index, 'Widget', 'upsert', {
      where: { id: 'w1' },
      create: { id: 'w1', tags: null },
      update: { tags: null },
    }) as { create: Record<string, unknown>; update: Record<string, unknown> };
    expect('tags' in out.create).toBe(false);
    expect(out.update.tags).toEqual([]);
  });

  it('createMany rewrites every row', () => {
    const out = normaliseWriteArgs(index, 'Widget', 'createMany', {
      data: [
        { id: 'a', metadata: null },
        { id: 'b', metadata: { k: 1 } },
      ],
    }) as { data: Array<Record<string, unknown>> };
    expect(out.data[0].metadata).toBe(Prisma.DbNull);
    expect(out.data[1].metadata).toEqual({ k: 1 });
  });

  it('never mutates the caller object', () => {
    const data = { id: 'w1', metadata: null };
    const args = { data };
    normaliseWriteArgs(index, 'Widget', 'create', args);
    expect(data.metadata).toBeNull();
    expect(args.data).toBe(data);
  });

  it('returns the same object when nothing needs rewriting', () => {
    const args = { data: { id: 'w1', metadata: { a: 1 } } };
    const out = normaliseWriteArgs(index, 'Widget', 'create', args) as { data: unknown };
    expect(out.data).toBe(args.data);
  });

  it('leaves reads, unknown models and raw queries alone', () => {
    const where = { where: { metadata: null } };
    expect(normaliseWriteArgs(index, 'Widget', 'findMany', where)).toBe(where);
    const plain = { data: { name: null } };
    expect(normaliseWriteArgs(index, 'Plain', 'create', plain)).toBe(plain);
    expect(normaliseWriteArgs(index, undefined, 'executeRaw', ['SELECT 1'])).toEqual(['SELECT 1']);
  });
});

describe('createNullSafeWriteMiddleware', () => {
  it('passes rewritten params to next and returns its result', async () => {
    const index = buildNullSafeFieldIndex(MODELS);
    const middleware = createNullSafeWriteMiddleware(index);
    const seen: unknown[] = [];
    const result = await middleware(
      { model: 'Widget', action: 'create', args: { data: { id: 'x', metadata: null } } },
      async (params) => {
        seen.push(params.args);
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect((seen[0] as { data: Record<string, unknown> }).data.metadata).toBe(Prisma.DbNull);
  });
});

describe('nullSafeFieldIndexFromClient (generated client)', () => {
  const index = nullSafeFieldIndexFromClient();

  it('reads the DMMF of the generated client', () => {
    expect(index).not.toBeNull();
  });

  it('covers the domain-persistence models whose services write plain null', () => {
    expect(index?.get('BillingCustomer')?.get('metadata')).toBe('json-optional');
    expect(index?.get('LegalHold')?.get('affectedSubjects')).toBe('list');
    expect(index?.get('WebhookEvent')?.get('payload')).toBeDefined();
  });
});
