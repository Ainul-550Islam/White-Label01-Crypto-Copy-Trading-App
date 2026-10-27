/**
 * OAuth 2.0 authorization-code flow (PKCE S256 where policy requires),
 * backend-authoritative end to end.
 *
 * - authorization requests validate the client, EXACT redirect match and
 *   required `state`; PKCE is enforced when the tenant policy says so.
 * - authorization codes are single-use, expire on policy TTL and are stored
 *   ONLY as HMAC digests; codes are never logged anywhere.
 * - consent can REDUCE scopes but never expand them (scope reduction
 *   prevention is enforced in both directions).
 * - revocation of a token or grant is immediate and audited.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';

import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  assertScopesCovered,
  constantTimeEqual,
  credentialDigest,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  generateAccessToken,
  generateAuthorizationCode,
  idempotencyKey,
  scopesIntersect,
  validateScopes,
} from './developer.types';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';
import { claimMutationIntent } from './developer-mutation-intent';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
} from './developer-policy.service';
import { DeveloperScopeService } from './developer-scope.service';
import { DEVELOPER_SECRET_HMAC_KEY } from './developer-credential.service';

export interface AuthorizationRequestInput {
  tenantId: string;
  userId: string;
  correlationId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  requestedScopes?: string[];
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  nonce?: string;
}

export interface AuthorizationRequestResult {
  grantId: string;
  /** The consent view the user actually confirms in the portal. */
  consentedScopes: string[];
  redirectTo: string;
  clientName: string;
  environment: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly policyService: DeveloperPolicyService,
    private readonly scopeService: DeveloperScopeService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    @Inject(DEVELOPER_SECRET_HMAC_KEY) private readonly hmacKey: string,
  ) {}

  private async loadApplicationByClientId(tenantId: string, clientId: string) {
    const application = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerApplication.findUnique({
      where: { clientId },
    }));
    if (!application || application.tenantId !== tenantId) {
      // Cross-tenant client ids are indistinguishable from unknown ones.
      throw new NotFoundException('OAuth client not found');
    }
    if (application.state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    if (application.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED, 'application is not active');
    }
    return application;
  }

  /** Step 1-5: client auth, exact redirect validation, state, PKCE policy. */
  async createAuthorizationRequest(input: AuthorizationRequestInput): Promise<AuthorizationRequestResult> {
    const application = await this.loadApplicationByClientId(input.tenantId, input.clientId);
    if (!input.state || input.state.length < 16) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.OAUTH_STATE_REQUIRED, 'state parameter is required');
    }
    // EXACT match against the registered list — no prefix, no suffix, no
    // normalization (CHECK 15).
    if (!application.redirectUris.includes(input.redirectUri)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH,
        'redirect_uri does not exactly match a registered URI',
      );
    }
    const plan = await this.policyData.planLimitViewForTenant(input.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(input.tenantId);
    const policy = this.policyService.resolve(input.tenantId, plan, entitlements);

    const requested = validateScopes(input.requestedScopes ?? application.scopes);
    // The requestable set is bounded by the application's registered scopes.
    assertScopesCovered(requested, application.scopes);
    // Only the user-profile capability is exposed through the current OAuth
    // integration boundary. Never grant unavailable or write-level scopes.
    if (requested.length !== 1 || requested[0] !== 'profile:read' || !policy.allowedScopes.includes('profile:read')) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED, 'requested OAuth capability is unavailable');
    }

    // All interactive authorizations require PKCE. A browser cannot keep a
    // client secret, and allowing a non-PKCE grant would expose intercepted codes.
    if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.PKCE_REQUIRED,
        'PKCE (S256) is required for this authorization',
      );
    }

    const grantKey = idempotencyKey(input.tenantId, 'oauth.grant', `${application.id}|${input.userId}|${input.state}`);
    const grant = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      // Serialize the deterministic state key so retried/concurrent requests
      // return the existing grant, not a unique-index server error.
      await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${input.tenantId}::uuid FOR UPDATE`;
      const existing = await tx.developerOAuthGrant.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: grantKey } });
      if (existing) {
        const sameScopes = existing.requestedScopes.length === requested.length && requested.every((scope) => existing.requestedScopes.includes(scope));
        if (existing.redirectUri !== input.redirectUri || !sameScopes || existing.codeChallenge !== (input.codeChallenge ?? null)
          || existing.codeChallengeMethod !== (input.codeChallengeMethod ?? null) || existing.nonce !== (input.nonce ?? null)) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'authorization state was already used for a different request');
        }
        return existing;
      }
      const created = await tx.developerOAuthGrant.create({
        data: {
          tenantId: input.tenantId, applicationId: application.id, userId: input.userId,
          state: 'PENDING_CONSENT', redirectUri: input.redirectUri, requestedScopes: requested, consentedScopes: [],
          codeChallenge: input.codeChallenge ?? null, codeChallengeMethod: input.codeChallengeMethod ?? null,
          nonce: input.nonce ?? null, stateParameter: input.state, idempotencyKey: grantKey,
        },
      });
      await this.audit.record({
        tenantId: input.tenantId, applicationId: application.id, actorType: 'USER', actorId: input.userId,
        correlationId: input.correlationId, action: 'oauth.authorization_requested',
        detail: { grantId: created.id, scopes: requested },
      }, tx);
      return created;
    });
    return {
      grantId: grant.id,
      consentedScopes: requested,
      redirectTo: input.redirectUri,
      clientName: application.name,
      environment: application.environment,
    };
  }

  /** Step 6: user consent. Scopes may shrink; they can never grow. */
  async recordConsent(
    actor: DeveloperAuditActor,
    grantId: string,
    decision: 'GRANTED' | 'DENIED',
    consentedScopes?: string[],
  ): Promise<void> {
    const grant = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerOAuthGrant.findUnique({ where: { id: grantId } }));
    if (!grant || grant.tenantId !== actor.tenantId) {
      throw new NotFoundException('authorization grant not found');
    }
    if (grant.state !== 'PENDING_CONSENT') {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.INVALID_TRANSITION,
        `grant is ${grant.state}; consent already recorded`,
      );
    }
    if (grant.userId !== actor.actorId) {
      throw new NotFoundException('authorization grant not found');
    }
    let finalScopes: string[] = [];
    if (decision === 'GRANTED') {
      const requested = validateScopes(consentedScopes ?? grant.requestedScopes);
      // Consent may reduce, never expand (CHECK 20 direction).
      finalScopes = scopesIntersect(requested, grant.requestedScopes);
      if (finalScopes.length === 0) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED, 'consent reduced scopes to none');
      }
    }
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      const changed = await tx.developerOAuthGrant.updateMany({
        where: { id: grant.id, tenantId: actor.tenantId, userId: actor.actorId, state: 'PENDING_CONSENT' },
        data: { state: decision, consentedScopes: decision === 'GRANTED' ? finalScopes : [] },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'consent already recorded');
      await this.audit.record({
        ...actor,
        applicationId: grant.applicationId,
        action: decision === 'GRANTED' ? 'oauth.consent_granted' : 'oauth.consent_denied',
        detail: { grantId: grant.id, scopes: finalScopes },
      }, tx);
    });
  }

  /**
   * Steps 7-8: authorization code issuance happens when consent is GRANTED
   * (backend-issued, backend-held). The code is returned exactly once and
   * stored only as a digest.
   */
  async issueAuthorizationCode(actor: DeveloperAuditActor, grantId: string): Promise<{ code: string; expiresIn: number; redirectTo: string; state: string }> {
    const grant = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerOAuthGrant.findUnique({ where: { id: grantId } }));
    if (!grant || grant.tenantId !== actor.tenantId || grant.userId !== actor.actorId) {
      throw new NotFoundException('authorization grant not found');
    }
    if (grant.state !== 'GRANTED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'grant is not in GRANTED state');
    }
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    const code = generateAuthorizationCode();
    const expiresAt = new Date(Date.now() + policy.oauth.authorizationCodeTtlSeconds * 1000);
    // A code is one-time output. Never replace a code that was already issued,
    // including after an uncertain response; concurrent issuers race atomically.
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      const issued = await tx.developerOAuthGrant.updateMany({
        where: { id: grant.id, tenantId: actor.tenantId, userId: actor.actorId, state: 'GRANTED', codeHash: null },
        data: { codeHash: credentialDigest(code, this.hmacKey), codeExpiresAt: expiresAt },
      });
      if (issued.count !== 1) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'authorization code was already issued');
      }
      await this.audit.record({ ...actor, applicationId: grant.applicationId, action: 'oauth.code_issued', detail: { grantId: grant.id } }, tx);
    });
    return { code, expiresIn: policy.oauth.authorizationCodeTtlSeconds, redirectTo: grant.redirectUri, state: grant.stateParameter };
  }

  /** Step 9: token exchange. Code single-use, expiry, PKCE, exact redirect. */
  async exchangeToken(input: {
    tenantId: string;
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    clientSecret?: string;
    correlationId: string;
  }): Promise<TokenExchangeResult> {
    const application = await this.loadApplicationByClientId(input.tenantId, input.clientId);
    const codeHash = credentialDigest(input.code, this.hmacKey);
    const grant = await this.prisma.withTenantRls(input.tenantId, (tx) => tx.developerOAuthGrant.findFirst({
      where: { tenantId: input.tenantId, applicationId: application.id, codeHash },
    }));
    if (!grant || !grant.codeHash || !constantTimeEqual(codeHash, grant.codeHash) || grant.state !== 'GRANTED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'authorization code not recognized');
    }
    if (!grant.codeExpiresAt || grant.codeExpiresAt.getTime() <= Date.now()) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_EXPIRED, 'authorization code expired');
    }
    if (grant.redirectUri !== input.redirectUri) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH, 'redirect_uri mismatch');
    }
    if (grant.codeChallenge) {
      if (grant.codeChallengeMethod !== 'S256') {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.PKCE_VERIFIER_MISMATCH, 'unsupported PKCE method');
      }
      const verifier = input.codeVerifier ?? '';
      const derived = createHash('sha256').update(verifier, 'utf8').digest('base64url');
      if (!constantTimeEqual(derived, grant.codeChallenge)) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.PKCE_VERIFIER_MISMATCH, 'PKCE verification failed');
      }
    }
    // Confidential clients must present the client secret (digest compare).
    const confidential = await this.prisma.withTenantRls(input.tenantId, (tx) => tx.developerCredential.findFirst({
      where: { tenantId: input.tenantId, applicationId: application.id, kind: 'OAUTH_CLIENT', revokedAt: null },
    }));
    if (confidential) {
      if (!input.clientSecret) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'client authentication required');
      }
      const matches = constantTimeEqual(credentialDigest(input.clientSecret, this.hmacKey), confidential.secretHash);
      if (!matches) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'client authentication failed');
      }
    }

    // Authenticate the client and PKCE verifier before allowing a replay to
    // revoke an already-issued token. A stolen code alone cannot cause that.
    if (grant.codeRedeemedAt) {
      // Single-use: a replayed code revokes the tokens issued from it.
      await this.revokeTokensForCodeReplay(input, application.id, grant.id);
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_REPLAYED, 'authorization code already used');
    }

    const plan = await this.policyData.planLimitViewForTenant(input.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(input.tenantId);
    const policy = this.policyService.resolve(input.tenantId, plan, entitlements);
    const tokenScopes = this.scopeService.assertTokenScopesBounded(
      grant.consentedScopes,
      this.scopeService.resolve({
        applicationScopes: application.scopes,
        policyAllowedScopes: policy.allowedScopes,
        subjectScopes: policy.allowedScopes,
      }).effective,
    );

    const accessToken = generateAccessToken();
    const expiresAt = new Date(Date.now() + policy.oauth.accessTokenTtlSeconds * 1000);
    try {
      await this.prisma.withTenantRls(input.tenantId, async (tx: Prisma.TransactionClient) => {
        // Atomic compare-and-set prevents two concurrent exchanges from minting
        // two tokens from the same authorization code.
        const claimed = await tx.developerOAuthGrant.updateMany({
          where: {
            id: grant.id, tenantId: input.tenantId, applicationId: application.id,
            state: 'GRANTED', codeHash, codeRedeemedAt: null, codeExpiresAt: { gt: new Date() },
          },
          data: { codeRedeemedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_REPLAYED, 'authorization code already used or expired');
        }
        await tx.developerAccessToken.create({
          data: {
            tenantId: input.tenantId,
            applicationId: application.id,
            grantId: grant.id,
            tokenHash: credentialDigest(accessToken, this.hmacKey),
            scopes: tokenScopes,
            expiresAt,
          },
        });
        await this.audit.record({
          tenantId: input.tenantId, applicationId: application.id, actorType: 'SERVICE',
          actorId: input.clientId, correlationId: input.correlationId,
          action: 'oauth.token_issued', detail: { grantId: grant.id, scopes: tokenScopes, expiresAt: expiresAt.toISOString() },
        }, tx);
      });
    } catch (error) {
      // A concurrent winner may have committed a token after our first read.
      // Apply the same replay policy after the losing transaction rolls back.
      if (error instanceof DeveloperError && error.code === DEVELOPER_ERROR_CODES.CODE_REPLAYED) {
        await this.revokeTokensForCodeReplay(input, application.id, grant.id);
      }
      throw error;
    }
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: policy.oauth.accessTokenTtlSeconds,
      scope: tokenScopes.join(' '),
    };
  }

  private async revokeTokensForCodeReplay(
    input: { tenantId: string; clientId: string; correlationId: string },
    applicationId: string,
    grantId: string,
  ): Promise<void> {
    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      await tx.developerAccessToken.updateMany({
        where: { tenantId: input.tenantId, grantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        tenantId: input.tenantId, applicationId, actorType: 'SERVICE', actorId: input.clientId,
        correlationId: input.correlationId, action: 'oauth.code_replayed', detail: { grantId },
      }, tx);
    });
  }

  /** A user can inspect only their own granted authorizations. */
  async listUserGrants(tenantId: string, userId: string, limit = 50, cursor?: string) {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      if (cursor) {
        const owned = await tx.developerOAuthGrant.findFirst({ where: { id: cursor, tenantId, userId, state: 'GRANTED' }, select: { id: true } });
        if (!owned) throw new NotFoundException('authorization grant not found');
      }
      const rows = await tx.developerOAuthGrant.findMany({
        where: { tenantId, userId, state: 'GRANTED' },
        select: { id: true, consentedScopes: true, createdAt: true,
          application: { select: { name: true, environment: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return { rows: page.map((row) => ({ id: row.id, scopes: row.consentedScopes,
        clientName: row.application.name, environment: row.application.environment, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null };
    });
  }

  /** Revoke the owner's consent and all derived tokens atomically. */
  async revokeUserGrant(actor: DeveloperAuditActor, grantId: string, key: string): Promise<void> {
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; application_id: string; state: string }>>`
        SELECT id, application_id, state FROM developer_oauth_grants
        WHERE tenant_id=${actor.tenantId}::uuid AND user_id=${actor.actorId}::uuid AND id=${grantId}::uuid FOR UPDATE`;
      const grant = rows[0];
      if (!grant) throw new NotFoundException('authorization grant not found');
      await claimMutationIntent(tx, actor.tenantId, key, 'oauth.grant_revoke', grantId);
      if (grant.state !== 'GRANTED') throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'grant is not active');
      await tx.developerOAuthGrant.updateMany({ where: { id: grantId, tenantId: actor.tenantId, userId: actor.actorId, state: 'GRANTED' }, data: { state: 'REVOKED' } });
      await tx.developerAccessToken.updateMany({ where: { tenantId: actor.tenantId, grantId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ ...actor, applicationId: grant.application_id, action: 'oauth.grant_revoked', detail: { grantId } }, tx);
    });
  }

  /** Immediate revocation of a token (and thereby its API access). */
  async revokeToken(actor: DeveloperAuditActor, token: string): Promise<void> {
    const tokenHash = credentialDigest(token, this.hmacKey);
    const row = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerAccessToken.findUnique({ where: { tokenHash } }));
    if (!row || row.tenantId !== actor.tenantId) {
      // Revocation of unknown/foreign tokens is indistinguishable: no error.
      return;
    }
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      if (row.revokedAt) return;
      const revoked = await tx.developerAccessToken.updateMany({
        where: { id: row.id, tenantId: actor.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) return;
      await this.audit.record({
        ...actor,
        applicationId: row.applicationId,
        action: 'oauth.token_revoked',
        detail: { grantId: row.grantId },
      }, tx);
    });
  }

  /** Access resolution used by api-access.service (hash-lookup, scope output). */
  async resolveAccessToken(tenantId: string, token: string): Promise<{
    id: string;
    tenantId: string;
    applicationId: string;
    userId: string;
    scopes: string[];
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const row = await tx.developerAccessToken.findUnique({
        where: { tokenHash: credentialDigest(token, this.hmacKey) },
        include: { grant: { select: { tenantId: true, userId: true, state: true } } },
      });
      if (!row || row.tenantId !== tenantId || !row.grant || row.grant.tenantId !== tenantId || row.grant.state !== 'GRANTED') return null;
      // A disabled/deleted user cannot keep using old consent, even if an
      // independent OAuth token was not explicitly revoked during suspension.
      const subject = await tx.user.findFirst({
        where: { tenantId, id: row.grant.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true },
      });
      if (!subject) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        applicationId: row.applicationId,
        userId: subject.id,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      };
    });
  }

  /** A revoked application can never mint new tokens (CHECK 13). */
  assertApplicationCanHoldTokens(state: string): void {
    if (state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    if (state === 'SUSPENDED' || state === 'REACTIVATION_REVIEW') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED, 'application is not active');
    }
    void assertScopesCovered; // reference kept: escalation guard lives in scope service
  }
}
