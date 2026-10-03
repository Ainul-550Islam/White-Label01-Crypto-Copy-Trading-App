import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Prisma, SsoAuthTransaction, SsoProviderType } from '@prisma/client';
import type { SealedPayload } from '@wlct/utils';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import {
  SSO_HANDOFF_TTL_SECONDS,
  SSO_MAX_PENDING_PER_CLIENT,
  SSO_TRANSACTION_TTL_SECONDS,
  SsoAuthError,
  SsoReasonCode,
} from '../../security/sso-flow.types';
import type { SamlLogoutContext } from '../../security/saml-provider.service';

/**
 * What a SAML session keeps for Single Logout, as stored on the login
 * transaction (sso_auth_transactions.saml_logout_context) and then copied to
 * the session row: the sealed NameID / SessionIndex and two keyed hashes used
 * to find sessions named by an IdP-initiated LogoutRequest.
 */
export interface SamlSessionLogoutData {
  /** Envelope-encrypted SamlLogoutContext, AAD bound to tenant + configuration. */
  context: SealedPayload;
  /** HMAC-SHA512 of configuration + NameID. */
  subjectHash: string;
  /** HMAC-SHA512 of configuration + SessionIndex; null when the IdP sent no SessionIndex. */
  sessionIndexHash: string | null;
}

/** Created SP-initiated logout round trip. */
export interface CreatedSsoLogoutTransaction {
  transaction: SsoAuthTransaction;
  /** RelayState sent with the LogoutRequest; only its hash is stored. */
  relayState: string;
}

/** AAD of a sealed SAML logout context. */
export function samlLogoutContextAad(tenantId: string, configurationId: string): string {
  return `${tenantId}:sso:${configurationId}:saml_logout_context`;
}

export interface CreatedSsoTransaction {
  transaction: SsoAuthTransaction;
  /** Raw values: returned to the caller once, never persisted. */
  state: string;
  nonce: string | null;
  codeVerifier: string | null;
  codeChallenge: string | null;
  bindingToken: string;
}

const b64url = (bytes: Buffer): string => bytes.toString('base64url');
const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function hexEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Server-side SSO login transactions.
 *
 * Secret material handling:
 *  - state, nonce, SAML hand-off code: only SHA-256 hashes are stored;
 *  - binding secret (held by the client that started the login): stored as
 *    a keyed HMAC (CryptoService.hashToken), compared in constant time;
 *  - PKCE code_verifier: must be sent verbatim at code redemption, so it is
 *    envelope-encrypted with AAD bound to the tenant and transaction.
 *
 * One-time use is enforced by conditional updates (`updateMany` on the
 * expected status with consumedAt null and expiresAt in the future): of two
 * concurrent callbacks for the same state exactly one gets count = 1.
 */
@Injectable()
export class SsoTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  static hashState(state: string): string {
    return sha256Hex(state);
  }

  static hashNonce(nonce: string): string {
    return sha256Hex(nonce);
  }

  static codeChallengeFor(verifier: string): string {
    return createHash('sha256').update(verifier, 'ascii').digest('base64url');
  }

  async create(input: {
    tenantId: string;
    configurationId: string;
    providerType: SsoProviderType;
    deviceId: string;
    redirectUri: string;
    returnTo: string | null;
    ipHash: string | null;
    correlationId: string;
    withNonce: boolean;
    withPkce: boolean;
    samlRequestId?: string | null;
    now?: Date;
  }): Promise<CreatedSsoTransaction> {
    const now = input.now ?? new Date();
    await this.pruneExpired(now);

    if (input.ipHash) {
      const pending = await this.prisma.ssoAuthTransaction.count({
        where: {
          tenantId: input.tenantId,
          ipHash: input.ipHash,
          status: { in: ['PENDING', 'VERIFIED'] },
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (pending >= SSO_MAX_PENDING_PER_CLIENT) {
        throw new SsoAuthError(
          SsoReasonCode.TOO_MANY_PENDING,
          'Too many unfinished SSO logins from this client',
        );
      }
    }

    const id = randomUUID();
    const state = b64url(randomBytes(32));
    const nonce = input.withNonce ? b64url(randomBytes(32)) : null;
    const codeVerifier = input.withPkce ? b64url(randomBytes(64)) : null;
    const codeChallenge = codeVerifier
      ? SsoTransactionService.codeChallengeFor(codeVerifier)
      : null;
    const bindingToken = b64url(randomBytes(32));

    const transaction = await this.prisma.ssoAuthTransaction.create({
      data: {
        id,
        tenantId: input.tenantId,
        configurationId: input.configurationId,
        providerType: input.providerType,
        stateHash: SsoTransactionService.hashState(state),
        nonceHash: nonce ? SsoTransactionService.hashNonce(nonce) : null,
        pkceVerifierCiphertext: codeVerifier
          ? (this.crypto.encrypt(
              codeVerifier,
              this.pkceAad(input.tenantId, id),
            ) as unknown as object)
          : undefined,
        bindingHash: this.crypto.hashToken(bindingToken),
        deviceId: input.deviceId,
        redirectUri: input.redirectUri,
        returnTo: input.returnTo,
        samlRequestId: input.samlRequestId ?? null,
        status: 'PENDING',
        correlationId: input.correlationId,
        ipHash: input.ipHash,
        expiresAt: new Date(now.getTime() + SSO_TRANSACTION_TTL_SECONDS * 1000),
      },
    });

    return { transaction, state, nonce, codeVerifier, codeChallenge, bindingToken };
  }

  findByState(state: string): Promise<SsoAuthTransaction | null> {
    return this.prisma.ssoAuthTransaction.findUnique({
      where: { stateHash: SsoTransactionService.hashState(state) },
    });
  }

  /**
   * Checks a transaction against the request it is being completed from.
   * Order matters only for the reported reason; every check must pass.
   */
  assertUsable(
    tx: SsoAuthTransaction,
    expected: {
      tenantId: string;
      providerType?: SsoProviderType | null;
      status: 'PENDING' | 'VERIFIED' | 'LOGOUT_PENDING';
      deviceId?: string;
      bindingToken?: string | null;
      now?: Date;
    },
  ): void {
    const now = expected.now ?? new Date();
    if (tx.tenantId !== expected.tenantId) {
      throw new SsoAuthError(
        SsoReasonCode.TENANT_MISMATCH,
        'Transaction belongs to another tenant',
      );
    }
    if (expected.providerType && tx.providerType !== expected.providerType) {
      throw new SsoAuthError(
        SsoReasonCode.PROVIDER_MISMATCH,
        'Transaction was started for another provider',
      );
    }
    if (tx.consumedAt || tx.status === 'CONSUMED' || tx.status === 'REJECTED') {
      throw new SsoAuthError(SsoReasonCode.STATE_CONSUMED, 'Transaction already used');
    }
    if (tx.expiresAt.getTime() <= now.getTime()) {
      throw new SsoAuthError(SsoReasonCode.STATE_EXPIRED, 'Transaction expired');
    }
    if (tx.status !== expected.status) {
      throw new SsoAuthError(
        SsoReasonCode.STATE_CONSUMED,
        `Transaction is ${tx.status}, expected ${expected.status}`,
      );
    }
    if (expected.deviceId !== undefined && tx.deviceId !== expected.deviceId) {
      throw new SsoAuthError(
        SsoReasonCode.DEVICE_MISMATCH,
        'Transaction was started on another device',
      );
    }
    if (expected.bindingToken !== undefined) {
      if (
        !expected.bindingToken ||
        !hexEqual(this.crypto.hashToken(expected.bindingToken), tx.bindingHash)
      ) {
        throw new SsoAuthError(
          SsoReasonCode.BINDING_MISMATCH,
          'Transaction is not bound to this client',
        );
      }
    }
  }

  /** OIDC: atomically PENDING -> CONSUMED. Exactly one caller wins. */
  async claimPending(id: string, now: Date = new Date()): Promise<void> {
    const result = await this.prisma.ssoAuthTransaction.updateMany({
      where: { id, status: 'PENDING', consumedAt: null, expiresAt: { gt: now } },
      data: { status: 'CONSUMED', consumedAt: now },
    });
    if (result.count !== 1) {
      throw new SsoAuthError(SsoReasonCode.STATE_CONSUMED, 'Transaction already used');
    }
  }

  /**
   * SAML ACS: atomically PENDING -> VERIFIED with the verified user and a
   * one-time hand-off code for the starting client. Returns the raw code.
   * `samlLogout` (sealed NameID / SessionIndex of the verified assertion) is
   * carried on the transaction to session issuance.
   */
  async markVerified(
    id: string,
    userId: string,
    now: Date = new Date(),
    samlLogout: SamlSessionLogoutData | null = null,
  ): Promise<string> {
    const handoff = b64url(randomBytes(32));
    const result = await this.prisma.ssoAuthTransaction.updateMany({
      where: { id, status: 'PENDING', consumedAt: null, expiresAt: { gt: now } },
      data: {
        status: 'VERIFIED',
        verifiedUserId: userId,
        handoffHash: sha256Hex(handoff),
        verifiedAt: now,
        ...(samlLogout ? { samlLogoutContext: samlLogout as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    if (result.count !== 1) {
      throw new SsoAuthError(SsoReasonCode.STATE_CONSUMED, 'Transaction already used');
    }
    return handoff;
  }

  /** SAML completion: atomically VERIFIED -> CONSUMED when the hand-off code matches and is fresh. */
  async claimVerified(
    tx: SsoAuthTransaction,
    handoffCode: string,
    now: Date = new Date(),
  ): Promise<string> {
    if (!handoffCode || !hexEqual(sha256Hex(handoffCode), tx.handoffHash)) {
      throw new SsoAuthError(SsoReasonCode.HANDOFF_INVALID, 'SAML hand-off code does not match');
    }
    if (
      !tx.verifiedAt ||
      now.getTime() - tx.verifiedAt.getTime() > SSO_HANDOFF_TTL_SECONDS * 1000
    ) {
      throw new SsoAuthError(SsoReasonCode.STATE_EXPIRED, 'SAML hand-off code expired');
    }
    if (!tx.verifiedUserId) {
      throw new SsoAuthError(SsoReasonCode.HANDOFF_INVALID, 'Transaction has no verified user');
    }
    const result = await this.prisma.ssoAuthTransaction.updateMany({
      where: {
        id: tx.id,
        status: 'VERIFIED',
        consumedAt: null,
        handoffHash: tx.handoffHash,
        expiresAt: { gt: now },
      },
      data: { status: 'CONSUMED', consumedAt: now },
    });
    if (result.count !== 1) {
      throw new SsoAuthError(SsoReasonCode.STATE_CONSUMED, 'Transaction already used');
    }
    return tx.verifiedUserId;
  }

  /** Burns a transaction after a refusal so it can never be retried. Never throws. */
  async reject(id: string, reason: SsoReasonCode, now: Date = new Date()): Promise<void> {
    try {
      await this.prisma.ssoAuthTransaction.updateMany({
        where: { id },
        data: { status: 'REJECTED', failureReason: reason, consumedAt: now },
      });
    } catch {
      // The transaction is short-lived and one-time anyway; the refusal stands.
    }
  }

  // ---------------------------------------------------------------------------
  // SAML Single Logout
  // ---------------------------------------------------------------------------

  /** Keyed hash locating the sessions of a SAML subject (never the NameID itself). */
  samlSubjectHash(configurationId: string, nameID: string): string {
    return this.crypto.hashToken(`saml-subject:${configurationId}:${nameID}`);
  }

  /** Keyed hash locating the session of one IdP SessionIndex. */
  samlSessionIndexHash(configurationId: string, sessionIndex: string): string {
    return this.crypto.hashToken(`saml-session-index:${configurationId}:${sessionIndex}`);
  }

  /** Seals a verified assertion's logout context for storage. */
  sealSamlLogout(tenantId: string, configurationId: string, context: SamlLogoutContext): SamlSessionLogoutData {
    const plain: SamlLogoutContext = {
      nameID: context.nameID,
      nameIDFormat: context.nameIDFormat,
      nameQualifier: context.nameQualifier ?? null,
      spNameQualifier: context.spNameQualifier ?? null,
      sessionIndex: context.sessionIndex ?? null,
    };
    return {
      context: this.crypto.encrypt(JSON.stringify(plain), samlLogoutContextAad(tenantId, configurationId)),
      subjectHash: this.samlSubjectHash(configurationId, context.nameID),
      sessionIndexHash: context.sessionIndex ? this.samlSessionIndexHash(configurationId, context.sessionIndex) : null,
    };
  }

  /** Unseals a stored logout context; anything unreadable is SAML_SLO_CONTEXT_MISSING. */
  openSamlLogout(tenantId: string, configurationId: string, sealed: unknown): SamlLogoutContext {
    if (!sealed) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_CONTEXT_MISSING, 'The session holds no SAML logout context');
    }
    let parsed: Partial<SamlLogoutContext>;
    try {
      parsed = JSON.parse(
        this.crypto.decrypt(sealed as SealedPayload, samlLogoutContextAad(tenantId, configurationId)),
      ) as Partial<SamlLogoutContext>;
    } catch {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_CONTEXT_MISSING, 'The SAML logout context cannot be read');
    }
    if (typeof parsed.nameID !== 'string' || parsed.nameID.length === 0 || typeof parsed.nameIDFormat !== 'string') {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_CONTEXT_MISSING, 'The SAML logout context is incomplete');
    }
    return {
      nameID: parsed.nameID,
      nameIDFormat: parsed.nameIDFormat,
      nameQualifier: typeof parsed.nameQualifier === 'string' ? parsed.nameQualifier : null,
      spNameQualifier: typeof parsed.spNameQualifier === 'string' ? parsed.spNameQualifier : null,
      sessionIndex: typeof parsed.sessionIndex === 'string' ? parsed.sessionIndex : null,
    };
  }

  /**
   * SP-initiated logout: a LOGOUT_PENDING transaction holding the
   * LogoutRequest ID (samlRequestId, unique) and the hash of the RelayState.
   * redirectUri is where the browser goes after the LogoutResponse. The
   * binding hash is of a secret nobody holds: a logout transaction can never
   * be completed as a login (login completion also requires PENDING/VERIFIED).
   */
  async createLogout(input: {
    tenantId: string;
    configurationId: string;
    userId: string;
    deviceId: string;
    redirectUri: string;
    samlRequestId: string;
    correlationId: string;
    ipHash: string | null;
    now?: Date;
  }): Promise<CreatedSsoLogoutTransaction> {
    const now = input.now ?? new Date();
    await this.pruneExpired(now);
    const relayState = b64url(randomBytes(32));
    const transaction = await this.prisma.ssoAuthTransaction.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        configurationId: input.configurationId,
        providerType: 'SAML',
        stateHash: SsoTransactionService.hashState(relayState),
        bindingHash: this.crypto.hashToken(b64url(randomBytes(32))),
        deviceId: input.deviceId,
        redirectUri: input.redirectUri,
        returnTo: null,
        samlRequestId: input.samlRequestId,
        status: 'LOGOUT_PENDING',
        verifiedUserId: input.userId,
        correlationId: input.correlationId,
        ipHash: input.ipHash,
        expiresAt: new Date(now.getTime() + SSO_TRANSACTION_TTL_SECONDS * 1000),
      },
    });
    return { transaction, relayState };
  }

  /** LogoutResponse accepted: atomically LOGOUT_PENDING -> CONSUMED. Exactly one caller wins. */
  async claimLogout(id: string, now: Date = new Date()): Promise<void> {
    const result = await this.prisma.ssoAuthTransaction.updateMany({
      where: { id, status: 'LOGOUT_PENDING', consumedAt: null, expiresAt: { gt: now } },
      data: { status: 'CONSUMED', consumedAt: now },
    });
    if (result.count !== 1) {
      throw new SsoAuthError(SsoReasonCode.STATE_CONSUMED, 'Logout transaction already used');
    }
  }

  decryptVerifier(tx: SsoAuthTransaction): string | null {
    if (!tx.pkceVerifierCiphertext) return null;
    try {
      return this.crypto.decrypt(
        tx.pkceVerifierCiphertext as unknown as SealedPayload,
        this.pkceAad(tx.tenantId, tx.id),
      );
    } catch {
      throw new SsoAuthError(SsoReasonCode.PKCE_FAILED, 'PKCE verifier cannot be decrypted');
    }
  }

  /** Deletes transactions and replay records well past expiry. Bounded and idempotent. */
  async pruneExpired(now: Date = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.ssoAuthTransaction.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await this.prisma.ssoAssertionReplay.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  }

  private pkceAad(tenantId: string, transactionId: string): string {
    return `${tenantId}:sso:${transactionId}:pkce_verifier`;
  }
}
