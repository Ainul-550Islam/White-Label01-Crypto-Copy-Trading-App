// # Responsibility: issues, revokes and resolves signed, expiring, revocable public share links, projecting only the fields the owner opted into.
//
// THE THREE PROPERTIES
// --------------------
// 1. THE TOKEN IS SIGNED, AND THE SIGNATURE IS CHECKED BEFORE ANY LOOKUP. A share
//    link is a public URL that anyone can shorten, forward or edit. If the id were
//    taken from the path without a signature, editing one character would be a
//    free enumeration of every shared trader on the platform. Here the token is
//    `<uuid>.<hmac>` and the HMAC is verified first; a tampered token is a 404 with
//    the same body as an expired one.
//
// 2. THE PROJECTION IS AN ALLOW-LIST. `fieldsJson` is written when the link is
//    created and read when it is resolved; nothing outside it is ever copied into
//    the public view. A new column added to a trader profile next quarter is
//    therefore not published by accident - which is the only way to be sure that
//    follower identities and balances never leak.
//
// 3. REVOCATION IS A ROW CHANGE. The row carries `revokedAt`; revoking does not
//    require rotating the signing key, so one customer deleting a link does not
//    invalidate everyone else's.
//
// Everything here is deliberately synchronous-free of HTTP: it takes a repository
// port so the signature, expiry and projection rules can be tested exactly at
// their boundaries.
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type ShareSubjectType = 'TRADER' | 'STRATEGY';

/** Fields an owner may publish. Anything not in this union cannot be shared. */
export const SHAREABLE_FIELDS = [
  'displayName',
  'headline',
  'avatarUrl',
  'strategyName',
  'returnPercent30d',
  'returnPercent90d',
  'maxDrawdownPercent',
  'winRatePercent',
  'tradesLast30d',
  'riskScore',
  'startedAt',
] as const;

export type ShareableField = (typeof SHAREABLE_FIELDS)[number];

/** Fields that must never appear in a public projection, whatever is asked for. */
const FORBIDDEN_FIELDS = [
  'followers',
  'followerCount',
  'followerIds',
  'balance',
  'equity',
  'availableBalance',
  'withdrawals',
  'deposits',
  'email',
  'phone',
  'ipAddress',
  'apiKey',
  'accountId',
  'userId',
  'tenantId',
];

export interface PublicShareLinkRecord {
  id: string;
  tenantId: string;
  ownerUserId: string;
  subjectType: ShareSubjectType;
  subjectId: string;
  tokenId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  fieldsJson: unknown;
}

export interface PublicShareRepository {
  create(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
    tokenId: string;
    expiresAt: Date;
    fields: ShareableField[];
  }): Promise<PublicShareLinkRecord>;
  /** Lookup by the opaque token id from inside a verified signature. */
  findByTokenId(tokenId: string): Promise<PublicShareLinkRecord | null>;
  revoke(input: { tenantId: string; ownerUserId: string; id: string; at: Date }): Promise<PublicShareLinkRecord | null>;
  listForOwner(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType?: ShareSubjectType;
    subjectId?: string;
  }): Promise<PublicShareLinkRecord[]>;
}

/** Where the shareable facts about a trader or strategy come from. */
export interface ShareSubjectPort {
  /**
   * The subject's raw record. The service projects it; it never returns this to a
   * caller, so a projection bug cannot leak the whole row.
   */
  load(input: {
    tenantId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
  }): Promise<Record<string, unknown> | null>;

  /**
   * Whether the owner has opted this subject into search indexing. Optional: an
   * adapter that cannot answer leaves the shared page `noindex`, which is the
   * fail-closed direction for a page about someone's trading.
   */
  isIndexable?(input: {
    tenantId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
  }): Promise<boolean>;
}

export interface PublicShareOptions {
  /** HMAC key for the token signature. */
  signingKey?: string;
  keyProvider?: () => string;
  defaultExpiryDays?: number;
  maxExpiryDays?: number;
  now?: () => Date;
}

export type ShareRefusal =
  | 'INVALID_TOKEN'
  | 'EXPIRED'
  | 'REVOKED'
  | 'NOT_FOUND'
  | 'SUBJECT_UNAVAILABLE'
  | 'NOTHING_SHAREABLE';

export interface ResolvedShare {
  found: boolean;
  reason: ShareRefusal | null;
  tenantId: string | null;
  subjectType: ShareSubjectType | null;
  subjectId: string | null;
  /** Only the opted-in fields, already projected. Empty when nothing was found. */
  fields: Record<string, unknown>;
  expiresAt: string | null;
  ownerUserId: string | null;
  /** True only when the owner opted in and the subject is still public. */
  indexable: boolean;
}

export interface CreatedShare {
  id: string;
  token: string;
  expiresAt: string;
  fields: ShareableField[];
}

const DEFAULTS = { defaultExpiryDays: 30, maxExpiryDays: 365 };

@Injectable()
export class PublicShareService {
  private readonly keyProvider: () => string;
  private resolvedKey: string | null;
  private readonly defaultExpiryDays: number;
  private readonly maxExpiryDays: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: PublicShareRepository,
    private readonly subjects: ShareSubjectPort,
    options: PublicShareOptions,
  ) {
    if (!options?.signingKey && !options?.keyProvider) {
      throw new Error('PublicShareService needs a signing key');
    }
    this.keyProvider = options.keyProvider ?? (() => options.signingKey as string);
    this.resolvedKey = options.signingKey ?? null;
    this.defaultExpiryDays = options.defaultExpiryDays ?? DEFAULTS.defaultExpiryDays;
    this.maxExpiryDays = options.maxExpiryDays ?? DEFAULTS.maxExpiryDays;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Create a share link.
   *
   * The requested fields are filtered against `SHAREABLE_FIELDS` rather than
   * rejected wholesale: a client that sends one field this build does not publish
   * should share the rest, and the response says exactly which fields were kept so
   * the UI can tell the owner what will be visible.
   */
  async create(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
    fields: string[];
    expiryDays?: number;
  }): Promise<CreatedShare | { refused: ShareRefusal }> {
    const fields = this.filterFields(input.fields);
    if (fields.length === 0) return { refused: 'NOTHING_SHAREABLE' };

    const subject = await this.subjects.load({
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    });
    if (!subject) return { refused: 'SUBJECT_UNAVAILABLE' };

    const days = this.expiryDays(input.expiryDays);
    const tokenId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + days * 24 * 60 * 60 * 1_000);
    const row = await this.repository.create({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tokenId,
      expiresAt,
      fields,
    });

    return {
      id: row.id,
      token: this.sign(tokenId),
      expiresAt: expiresAt.toISOString(),
      fields,
    };
  }

  /** Revoke one link. Scoped to its owner and tenant; someone else's id is simply not found. */
  async revoke(input: { tenantId: string; ownerUserId: string; id: string }): Promise<{ revoked: boolean }> {
    const row = await this.repository.revoke({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      id: input.id,
      at: this.now(),
    });
    return { revoked: row !== null };
  }

  async list(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType?: ShareSubjectType;
    subjectId?: string;
  }): Promise<Array<{ id: string; subjectType: ShareSubjectType; subjectId: string; expiresAt: string; revokedAt: string | null }>> {
    const rows = await this.repository.listForOwner(input);
    return rows.map((row) => ({
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    }));
  }

  /**
   * Resolve a public token into a projection.
   *
   * Every failure returns `found: false` with the same shape; the `reason` is for
   * server-side logs and metrics and must not be echoed differently to the public
   * (a client that can distinguish "expired" from "unknown" can enumerate).
   */
  async resolve(token: string): Promise<ResolvedShare> {
    const empty: ResolvedShare = {
      found: false,
      reason: null,
      tenantId: null,
      subjectType: null,
      subjectId: null,
      fields: {},
      expiresAt: null,
      ownerUserId: null,
      indexable: false,
    };

    const tokenId = this.verify(token);
    if (!tokenId) return { ...empty, reason: 'INVALID_TOKEN' };

    const row = await this.repository.findByTokenId(tokenId);
    if (!row) return { ...empty, reason: 'NOT_FOUND' };
    if (row.revokedAt) return { ...empty, reason: 'REVOKED' };
    if (row.expiresAt.getTime() <= this.now().getTime()) return { ...empty, reason: 'EXPIRED' };

    const subject = await this.subjects.load({
      tenantId: row.tenantId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
    });
    if (!subject) return { ...empty, reason: 'SUBJECT_UNAVAILABLE' };

    const allowed = this.filterFields(
      Array.isArray(row.fieldsJson) ? (row.fieldsJson as string[]) : [],
    );
    const fields: Record<string, unknown> = {};
    for (const field of allowed) {
      const value = subject[field];
      if (value === undefined) continue;
      fields[field] = value;
    }

    return {
      found: true,
      reason: null,
      tenantId: row.tenantId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      fields,
      expiresAt: row.expiresAt.toISOString(),
      ownerUserId: row.ownerUserId,
      indexable: await this.indexable(row),
    };
  }

  /** `<uuid>.<base64url hmac>`; the signature covers the id only, so it cannot be re-pointed. */
  sign(tokenId: string): string {
    const signature = createHmac('sha256', this.signingKey()).update(`share:${tokenId}`).digest('base64url');
    return `${tokenId}.${signature}`;
  }

  /** The token id when the signature is valid, otherwise null. Never throws on malformed input. */
  verify(token: string): string | null {
    const trimmed = String(token ?? '').trim();
    const separator = trimmed.lastIndexOf('.');
    if (separator <= 0 || separator === trimmed.length - 1) return null;
    const tokenId = trimmed.slice(0, separator);
    const provided = trimmed.slice(separator + 1);
    // A uuid-shaped id keeps an obviously wrong token from reaching a database
    // query at all, without revealing anything about which ids exist.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenId)) return null;
    const expected = createHmac('sha256', this.signingKey()).update(`share:${tokenId}`).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return null;
    return timingSafeEqual(a, b) ? tokenId : null;
  }

  private filterFields(requested: string[]): ShareableField[] {
    const out = new Set<ShareableField>();
    for (const candidate of requested) {
      const field = String(candidate ?? '').trim();
      if (FORBIDDEN_FIELDS.includes(field)) continue;
      if ((SHAREABLE_FIELDS as readonly string[]).includes(field)) out.add(field as ShareableField);
    }
    // A stable order keeps the stored JSON byte-identical for the same request, so
    // "did the owner change what they share" is answerable by comparison.
    return [...out].sort();
  }

  private expiryDays(requested: number | undefined): number {
    if (requested === undefined || !Number.isFinite(requested)) return this.defaultExpiryDays;
    const days = Math.floor(requested);
    if (days < 1) return 1;
    if (days > this.maxExpiryDays) return this.maxExpiryDays;
    return days;
  }

  /** Fail closed: an adapter that throws or cannot answer means "do not index". */
  private async indexable(row: PublicShareLinkRecord): Promise<boolean> {
    if (typeof this.subjects.isIndexable !== 'function') return false;
    try {
      return await this.subjects.isIndexable({
        tenantId: row.tenantId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
      });
    } catch {
      return false;
    }
  }

  private signingKey(): string {
    if (this.resolvedKey === null) {
      const resolved = this.keyProvider();
      if (!resolved || resolved.length < 16) {
        throw new Error('PublicShareService needs a signing key of at least 16 characters');
      }
      this.resolvedKey = resolved;
    }
    return this.resolvedKey;
  }
}

/**
 * Sliding-window limiter for the public share endpoint.
 *
 * The edge throttler (`@Throttle`) is per-client-IP and global; this is the
 * per-token limit that runs in the request path, because the public endpoint
 * resolves an HMAC before it can be answered and a token that is being guessed
 * should not be allowed to consume the signing path at wire speed.
 *
 * It lives with the service rather than in a guard so the limit can be tested at
 * its boundary without booting a Nest application.
 */
@Injectable()
export class PublicShareRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 60,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Records one attempt and answers whether it may proceed. */
  check(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const at = this.now();
    const cutoff = at - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - at) / 1_000)),
      };
    }
    recent.push(at);
    this.hits.set(key, recent);
    // Bounded memory: a map with one entry per token seen in the last minute.
    if (this.hits.size > 10_000) {
      for (const [candidate, timestamps] of this.hits) {
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
          this.hits.delete(candidate);
        }
      }
    }
    return { allowed: true, remaining: this.limit - recent.length, retryAfterSeconds: 0 };
  }
}
