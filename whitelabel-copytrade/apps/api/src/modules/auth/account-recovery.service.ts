// # Responsibility: issues and redeems single-use account-recovery tokens that exist only as hashes, answer identically for unknown accounts, and revoke every session on success.
//
// THE TWO PROPERTIES THAT MATTER
// ------------------------------
// 1. IT MUST NOT BE AN ACCOUNT ORACLE. "No account with that email" turns the
//    recovery form into a free membership check for a breached password list. So
//    `request` returns the same shape, the same message and the same amount of
//    work whether the account exists or not; the token is created only when it
//    does, and is never returned in the response - it goes to the delivery
//    channel, which is the mailbox. The result carries `deliveryQueued` for the
//    caller's own logging, and the controller must not forward it.
//
// 2. IT MUST NOT BE A PERSISTENT BACKDOOR. The token is 256 bits of randomness,
//    stored only as an HMAC, valid for 30 minutes, single use, and bound to the
//    account. Completing a recovery revokes every session and every step-up proof
//    for that user in that tenant, because the reason a customer recovers an
//    account is usually that someone else has it. Leaving the attacker's session
//    alive would defeat the entire flow.
//
// WHY THE TOKEN IS COMPARED IN CONSTANT TIME
// ------------------------------------------
// The lookup is by hash, so a timing difference in the comparison itself does not
// reveal the token. It is compared in constant time anyway: the lookup returns a
// row for a *near* match on some storage backends, and a salt-and-compare loop is
// cheap insurance against a future store that returns candidates rather than an
// exact row.
import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type RecoveryStage = 'REQUESTED' | 'VERIFIED' | 'COMPLETED';

export interface RecoveryTokenRecord {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface RecoveryAccount {
  tenantId: string;
  userId: string;
}

export interface AccountRecoveryRepository {
  /**
   * Lookup by hashed token. Deliberately not tenant-scoped: the hash is an HMAC of
   * 256 random bits, so it identifies exactly one row, and the caller of a public
   * recovery form does not know their tenant. The tenant is read FROM the row and
   * then used for every subsequent scoped write.
   */
  findByHash(input: { tokenHash: string }): Promise<RecoveryTokenRecord | null>;
  createToken(input: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestIpHash: string | null;
  }): Promise<RecoveryTokenRecord>;
  markUsed(input: { tenantId: string; id: string; usedAt: Date }): Promise<boolean>;
  /** Burn every outstanding token for the account. Called on completion. */
  invalidateUserTokens(input: { tenantId: string; userId: string; at: Date }): Promise<number>;
  countRecentRequests(input: {
    tenantId: string | null;
    userId: string | null;
    ipHash: string | null;
    since: Date;
  }): Promise<number>;
}

export interface AccountLookupPort {
  /** Resolves an address to exactly one account. Ambiguity resolves to null, never to a guess. */
  findByEmail(email: string): Promise<RecoveryAccount | null>;
}

export interface SessionRevocationPort {
  revokeAllSessions(input: { tenantId: string; userId: string; reason: string }): Promise<number>;
  /** Drops every outstanding step-up proof for the user in this tenant. */
  revokeStepUpState(input: { tenantId: string; userId: string }): Promise<void>;
}

export interface RecoveryAuditPort {
  record(entry: {
    tenantId: string | null;
    userId: string | null;
    event: 'RECOVERY_REQUESTED' | 'RECOVERY_VERIFIED' | 'RECOVERY_COMPLETED' | 'RECOVERY_REFUSED';
    result: 'SUCCESS' | 'FAILURE' | 'THROTTLED';
    reasonCode: string;
    ipHash: string | null;
    requestId?: string;
  }): Promise<void>;
}

export type RecoveryRefusal =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_USED'
  | 'THROTTLED'
  | 'UNKNOWN_ACCOUNT';

export interface RecoveryRequestResult {
  /** Always true. Present so the controller has one shape to return. */
  accepted: true;
  message: string;
  /**
   * Caller-side fact, for logging and the queue. NOT for the response body:
   * forwarding it would restore exactly the oracle the identical message avoids.
   */
  deliveryQueued: boolean;
  /** The plaintext token, present only when one was created - it goes to the mailbox, never to the client. */
  tokenForDelivery: string | null;
  expiresAt: string | null;
}

export interface RecoveryVerifyResult {
  valid: boolean;
  reason: RecoveryRefusal | null;
  message: string;
}

export interface RecoveryCompleteResult {
  status: 'RECOVERED' | 'REFUSED';
  reason: RecoveryRefusal | null;
  message: string;
  sessionsRevoked: number;
  requiresTwoFactorEnrolment: boolean;
}

export interface AccountRecoveryOptions {
  /**
   * Key for the token HMAC: either the key itself, or a provider called on first
   * use. The provider form exists because the deployment's key material is
   * assembled at runtime; resolving it during construction would make a missing
   * key a module-wiring failure at boot instead of a refusal at the moment a token
   * is presented, which is both later and louder than it needs to be.
   */
  hashKey?: string;
  keyProvider?: () => string;
  tokenTtlMinutes?: number;
  /** Requests allowed per account and per address inside the window. */
  maxRequestsPerWindow?: number;
  windowMinutes?: number;
  now?: () => Date;
}

const DEFAULTS = { tokenTtlMinutes: 30, maxRequestsPerWindow: 5, windowMinutes: 60 };

/** The one message every request returns, whatever the truth is. */
const GENERIC_MESSAGE =
  'If an account matches that address, we have sent a recovery link. It expires in 30 minutes.';

@Injectable()
export class AccountRecoveryService {
  private readonly keyProvider: () => string;
  private resolvedKey: string | null;
  private readonly tokenTtlMinutes: number;
  private readonly maxRequestsPerWindow: number;
  private readonly windowMinutes: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AccountRecoveryRepository,
    private readonly accounts: AccountLookupPort,
    private readonly sessions: SessionRevocationPort,
    private readonly audit: RecoveryAuditPort,
    options: AccountRecoveryOptions,
  ) {
    if (!options?.hashKey && !options?.keyProvider) {
      throw new Error('AccountRecoveryService needs a hash key of at least 16 characters');
    }
    if (options.hashKey !== undefined && options.hashKey.length < 16) {
      throw new Error('AccountRecoveryService needs a hash key of at least 16 characters');
    }
    this.keyProvider = options.keyProvider ?? (() => options.hashKey as string);
    this.resolvedKey = options.hashKey ?? null;
    this.tokenTtlMinutes = options.tokenTtlMinutes ?? DEFAULTS.tokenTtlMinutes;
    this.maxRequestsPerWindow = options.maxRequestsPerWindow ?? DEFAULTS.maxRequestsPerWindow;
    this.windowMinutes = options.windowMinutes ?? DEFAULTS.windowMinutes;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Start a recovery. Never reveals whether the address is registered.
   *
   * The work done for an unknown address is deliberately similar to the work done
   * for a known one: the lookup, the throttle read and one audit row happen in
   * both cases. Only the token insert is skipped, and it is the cheap part.
   */
  async request(input: {
    email: string;
    ipHash: string | null;
    tenantHint?: string | null;
    requestId?: string;
  }): Promise<RecoveryRequestResult> {
    const now = this.now();
    const email = String(input.email ?? '').trim().toLowerCase();
    const account = email ? await this.accounts.findByEmail(email) : null;

    const since = new Date(now.getTime() - this.windowMinutes * 60 * 1_000);
    const recent = await this.repository.countRecentRequests({
      tenantId: account?.tenantId ?? null,
      userId: account?.userId ?? null,
      ipHash: input.ipHash,
      since,
    });

    if (recent >= this.maxRequestsPerWindow) {
      // Throttled, and told nothing different. A distinct "too many requests"
      // message for a registered address only is another oracle.
      await this.audit.record({
        tenantId: account?.tenantId ?? null,
        userId: account?.userId ?? null,
        event: 'RECOVERY_REFUSED',
        result: 'THROTTLED',
        reasonCode: 'THROTTLED',
        ipHash: input.ipHash,
        requestId: input.requestId,
      });
      return {
        accepted: true,
        message: GENERIC_MESSAGE,
        deliveryQueued: false,
        tokenForDelivery: null,
        expiresAt: null,
      };
    }

    if (!account) {
      await this.audit.record({
        tenantId: null,
        userId: null,
        event: 'RECOVERY_REQUESTED',
        result: 'FAILURE',
        reasonCode: 'UNKNOWN_ACCOUNT',
        ipHash: input.ipHash,
        requestId: input.requestId,
      });
      return {
        accepted: true,
        message: GENERIC_MESSAGE,
        deliveryQueued: false,
        tokenForDelivery: null,
        expiresAt: null,
      };
    }

    const token = randomBytes(32).toString('base64url'); // 256 bits
    const expiresAt = new Date(now.getTime() + this.tokenTtlMinutes * 60 * 1_000);
    await this.repository.createToken({
      tenantId: account.tenantId,
      userId: account.userId,
      tokenHash: this.hashToken(token),
      expiresAt,
      requestIpHash: input.ipHash,
    });
    await this.audit.record({
      tenantId: account.tenantId,
      userId: account.userId,
      event: 'RECOVERY_REQUESTED',
      result: 'SUCCESS',
      reasonCode: 'TOKEN_ISSUED',
      ipHash: input.ipHash,
      requestId: input.requestId,
    });

    return {
      accepted: true,
      message: GENERIC_MESSAGE,
      deliveryQueued: true,
      tokenForDelivery: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Check a token without consuming it, so the form can show the "choose a new
   * password" step before the customer commits.
   */
  async verify(input: { token: string; tenantHint?: string | null }): Promise<RecoveryVerifyResult> {
    const resolved = await this.resolve(input.token, input.tenantHint ?? null);
    if ('reason' in resolved) {
      return { valid: false, reason: resolved.reason, message: resolved.message };
    }
    return { valid: true, reason: null, message: 'Continue to choose a new password.' };
  }

  /**
   * Redeem the token: single use, then every session and step-up proof for the
   * account is destroyed.
   *
   * The credential write itself happens in AuthService (this service never sees a
   * password hash); what this method guarantees is the ORDER - token burned, then
   * sessions revoked - so a failure in the second step cannot leave a reusable
   * token behind.
   */
  async complete(input: {
    token: string;
    tenantHint?: string | null;
    ipHash: string | null;
    requestId?: string;
  }): Promise<RecoveryCompleteResult> {
    const resolved = await this.resolve(input.token, input.tenantHint ?? null);
    if ('reason' in resolved) {
      await this.audit.record({
        tenantId: null,
        userId: null,
        event: 'RECOVERY_REFUSED',
        result: 'FAILURE',
        reasonCode: resolved.reason,
        ipHash: input.ipHash,
        requestId: input.requestId,
      });
      return {
        status: 'REFUSED',
        reason: resolved.reason,
        message: resolved.message,
        sessionsRevoked: 0,
        requiresTwoFactorEnrolment: false,
      };
    }

    const record = resolved.record;
    const now = this.now();
    // Burn first. If the process dies between here and the revocation below, the
    // token is spent and the customer must request a new one - the safe direction.
    const burned = await this.repository.markUsed({ tenantId: record.tenantId, id: record.id, usedAt: now });
    if (!burned) {
      // Another request redeemed it between the read and the write.
      return {
        status: 'REFUSED',
        reason: 'TOKEN_ALREADY_USED',
        message: 'This recovery link has already been used. Request a new one.',
        sessionsRevoked: 0,
        requiresTwoFactorEnrolment: false,
      };
    }

    const sessionsRevoked = await this.sessions.revokeAllSessions({
      tenantId: record.tenantId,
      userId: record.userId,
      reason: 'ACCOUNT_RECOVERY',
    });
    await this.sessions.revokeStepUpState({ tenantId: record.tenantId, userId: record.userId });
    await this.repository.invalidateUserTokens({ tenantId: record.tenantId, userId: record.userId, at: now });

    await this.audit.record({
      tenantId: record.tenantId,
      userId: record.userId,
      event: 'RECOVERY_COMPLETED',
      result: 'SUCCESS',
      reasonCode: 'SESSIONS_REVOKED',
      ipHash: input.ipHash,
      requestId: input.requestId,
    });

    return {
      status: 'RECOVERED',
      reason: null,
      message: 'Your account is secured. Every other device has been signed out.',
      sessionsRevoked,
      // Recovery is the moment to re-establish a second factor: whoever had the
      // account may also have had the old authenticator.
      requiresTwoFactorEnrolment: true,
    };
  }

  /**
   * The account a live token belongs to, WITHOUT consuming it.
   *
   * Used by the controller so the new password can be checked against the real
   * account before the token is burned: a password rejected by policy must leave
   * the customer's link usable. Returns null for anything not currently valid, so
   * a caller can never use this as a lookup oracle for arbitrary strings.
   */
  async resolveAccountForToken(token: string): Promise<RecoveryAccount | null> {
    const resolved = await this.resolve(token, null);
    if ('reason' in resolved) return null;
    return { tenantId: resolved.record.tenantId, userId: resolved.record.userId };
  }

  /** The HMAC of a token. Public so tests can assert that only hashes are stored. */
  hashToken(token: string): string {
    return createHmac('sha256', this.hashKey()).update(`recovery:${token.trim()}`).digest('hex');
  }

  /** The HMAC key, resolved and length-checked on first use. */
  private hashKey(): string {
    if (this.resolvedKey === null) {
      const resolved = this.keyProvider();
      if (!resolved || resolved.length < 16) {
        throw new Error('AccountRecoveryService needs a hash key of at least 16 characters');
      }
      this.resolvedKey = resolved;
    }
    return this.resolvedKey;
  }

  private async resolve(
    token: string,
    // Accepted for API symmetry with the DTO and intentionally unused for lookup:
    // a hint must never widen or narrow which row can match.
    _tenantHint: string | null,
  ): Promise<{ record: RecoveryTokenRecord } | { reason: RecoveryRefusal; message: string }> {
    const trimmed = String(token ?? '').trim();
    // A malformed token is the same refusal as a wrong one, with the same work:
    // no early return that would let a caller distinguish "bad shape" cheaply.
    const tokenHash = this.hashToken(trimmed);
    const record = trimmed ? await this.repository.findByHash({ tokenHash }).catch(() => null) : null;

    const matched = record && this.constantTimeEquals(record.tokenHash, tokenHash) ? record : null;
    if (!matched) {
      return { reason: 'INVALID_TOKEN', message: 'This recovery link is not valid. Request a new one.' };
    }
    if (matched.usedAt) {
      return { reason: 'TOKEN_ALREADY_USED', message: 'This recovery link has already been used. Request a new one.' };
    }
    if (matched.expiresAt.getTime() <= this.now().getTime()) {
      return { reason: 'TOKEN_EXPIRED', message: 'This recovery link has expired. Request a new one.' };
    }
    return { record: matched };
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
