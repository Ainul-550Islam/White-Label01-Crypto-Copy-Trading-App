import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

/**
 * TEST-ONLY in-memory stand-in for the Prisma models the SSO services use.
 *
 * It implements the semantics the services rely on rather than recording
 * calls: unique constraints raise P2002, `updateMany` returns the number of
 * rows whose CURRENT values match the filter (so conditional one-time
 * transitions behave exactly as in PostgreSQL under a single writer), and
 * filters support equality, null, `gt`, `lt` and `in`.
 *
 * (File name matches "*.fixture-spec.ts": excluded from the production build
 * and not collected as a test suite.)
 */

type Row = Record<string, any>;
type Where = Record<string, any>;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
    } else if (typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
      if ('gt' in cond && !(value !== null && value !== undefined && value > cond.gt)) return false;
      if ('lt' in cond && !(value !== null && value !== undefined && value < cond.lt)) return false;
      if ('equals' in cond && value !== cond.equals) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function p2002(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/** Expands compound unique selectors like { tenantId_providerType: {...} }. */
function flattenWhere(where: Where): Where {
  const out: Where = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      key.includes('_') &&
      value &&
      typeof value === 'object' &&
      !(value instanceof Date) &&
      !('in' in value) &&
      !('gt' in value) &&
      !('lt' in value)
    ) {
      Object.assign(out, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

class Table {
  readonly rows: Row[] = [];
  /** When set, the next create throws this error once. */
  failNextCreate: Error | null = null;
  /** When true, every create throws. */
  failAllCreates = false;

  constructor(
    private readonly name: string,
    private readonly uniques: string[][],
    private readonly defaults: () => Row = () => ({}),
  ) {}

  private checkUnique(candidate: Row, ignore?: Row): void {
    for (const fields of this.uniques) {
      if (fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;
      const clash = this.rows.find(
        (r) => r !== ignore && fields.every((f) => r[f] === candidate[f]),
      );
      if (clash) throw p2002(`${this.name}(${fields.join(',')})`);
    }
  }

  create = jest.fn(async ({ data }: { data: Row }) => {
    if (this.failAllCreates) throw new Error(`${this.name} write failed (injected)`);
    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }
    const { profile, ...rest } = data;
    const row: Row = { id: randomUUID(), createdAt: new Date(), ...this.defaults(), ...rest };
    this.checkUnique(row);
    this.rows.push(row);
    return { ...row };
  });

  findUnique = jest.fn(async ({ where }: { where: Where; select?: unknown }) => {
    const row = this.rows.find((r) => matches(r, flattenWhere(where)));
    return row ? { ...row } : null;
  });

  findFirst = jest.fn(async ({ where }: { where?: Where; select?: unknown } = {}) => {
    const row = this.rows.find((r) => matches(r, where ? flattenWhere(where) : undefined));
    return row ? { ...row } : null;
  });

  findMany = jest.fn(async ({ where }: { where?: Where } = {}) =>
    this.rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
  );

  count = jest.fn(
    async ({ where }: { where?: Where } = {}) => this.rows.filter((r) => matches(r, where)).length,
  );

  update = jest.fn(async ({ where, data }: { where: Where; data: Row }) => {
    const row = this.rows.find((r) => matches(r, flattenWhere(where)));
    if (!row)
      throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
    const next = { ...row, ...data };
    this.checkUnique(next, row);
    Object.assign(row, data);
    return { ...row };
  });

  updateMany = jest.fn(async ({ where, data }: { where?: Where; data: Row }) => {
    const targets = this.rows.filter((r) => matches(r, where));
    for (const row of targets) {
      this.checkUnique({ ...row, ...data }, row);
      Object.assign(row, data);
    }
    return { count: targets.length };
  });

  createMany = jest.fn(async ({ data }: { data: Row[] }) => {
    for (const d of data) await this.create({ data: d });
    return { count: data.length };
  });

  deleteMany = jest.fn(async ({ where }: { where?: Where } = {}) => {
    const keep = this.rows.filter((r) => !matches(r, where));
    const removed = this.rows.length - keep.length;
    this.rows.splice(0, this.rows.length, ...keep);
    return { count: removed };
  });
}

export function createInMemorySsoPrisma() {
  const db = {
    ssoAuthTransaction: new Table(
      'sso_auth_transactions',
      [['stateHash'], ['samlRequestId'], ['handoffHash']],
      () => ({
        status: 'PENDING',
        consumedAt: null,
        verifiedAt: null,
        verifiedUserId: null,
        handoffHash: null,
        failureReason: null,
        samlRequestId: null,
      }),
    ),
    ssoAssertionReplay: new Table('sso_assertion_replays', [['tenantId', 'issuer', 'assertionId']]),
    ssoAuditEvent: new Table('sso_audit_events', []),
    ssoConfiguration: new Table('sso_configurations', [['tenantId', 'providerType']]),
    ssoIdentity: new Table('sso_identities', [
      ['tenantId', 'providerType', 'issuer', 'subject'],
      ['tenantId', 'configurationId', 'userId'],
    ]),
    user: new Table('users', [['tenantId', 'emailIndex']], () => ({
      deletedAt: null,
      isPlatformUser: false,
      twoFactorEnabled: false,
    })),
    userRole: new Table('user_roles', [['userId', 'roleId']]),
    // Round 8 (SAML Single Logout): sessions and their refresh tokens.
    userSession: new Table('user_sessions', [], () => ({
      revokedAt: null,
      revokeReason: null,
      authMethod: 'PASSWORD',
      ssoConfigurationId: null,
      ssoLogoutContext: null,
      ssoSubjectHash: null,
      ssoSessionIndexHash: null,
    })),
    refreshToken: new Table('refresh_tokens', [], () => ({
      status: 'ACTIVE',
      revokedAt: null,
      revokeReason: null,
    })),
    $transaction: jest.fn(
      async (arg: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]): Promise<unknown> =>
        // Batch form: the operations already ran against the store, in order; collect results.
        Array.isArray(arg) ? Promise.all(arg) : arg(self),
    ),
  };
  // Interactive transactions run against the same store (single writer, like one PG transaction).
  const self: unknown = db;
  return db;
}

export type InMemorySsoPrisma = ReturnType<typeof createInMemorySsoPrisma>;

/** Deterministic stand-in for CryptoService: reversible "encryption" bound to the AAD, keyed hashes. */
export function fakeCryptoService() {
  const key = 'test-blind-index-key';
  return {
    encrypt: jest.fn((plaintext: string, aad?: string) => ({
      ciphertext: Buffer.from(plaintext).toString('base64'),
      aad,
      keyId: 'test',
    })),
    decrypt: jest.fn((payload: { ciphertext: string; aad?: string }, aad?: string) => {
      if (!payload || payload.aad !== aad) throw new Error('AAD mismatch');
      return Buffer.from(payload.ciphertext, 'base64').toString('utf8');
    }),
    hashToken: (token: string) => createHmac('sha512', key).update(token).digest('hex'),
    blindIndex: (value: string) =>
      createHmac('sha256', key).update(value.toLowerCase()).digest('hex'),
    hashIp: (ip: string) => createHmac('sha256', key).update(`ip:${ip}`).digest('hex').slice(0, 64),
    sha256: (value: string) => createHash('sha256').update(value).digest('hex'),
    generateToken: (bytes = 48) => randomBytes(bytes).toString('base64url'),
  };
}
