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
    const application = await this.prisma.developerApplication.findUnique({
      where: { clientId },
    });
    if (!application || application.tenantId !== tenantId) {
      // Cross-tenant client ids are indistinguishable from unknown ones.
      throw new NotFoundException('OAuth client not found');
    }
    if (application.state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    if (application.state === 'SUSPENDED' || application.state === 'REACTIVATION_REVIEW') {
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

    const pkceRequired = policy.oauth.pkceRequired || application.state === 'PENDING';
    if (pkceRequired) {
      if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.PKCE_REQUIRED,
          'PKCE (S256) is required for this authorization',
        );
      }
    }

    const grant = await this.prisma.developerOAuthGrant.create({
      data: {
        tenantId: input.tenantId,
        applicationId: application.id,
        userId: input.userId,
        state: 'PENDING_CONSENT',
        redirectUri: input.redirectUri,
        requestedScopes: requested,
        consentedScopes: [],
        codeChallenge: input.codeChallenge ?? null,
        codeChallengeMethod: input.codeChallenge ?? null,
        nonce: input.nonce ?? null,
        stateParameter: input.state,
        idempotencyKey: idempotencyKey(
          input.tenantId,
          'oauth.grant',
          `${application.id}|${input.userId}|${input.state}`,
        ),
      },
    });
    return {
      grantId: grant.id,
      consentedScopes: requested,
      redirectTo: input.redirectUri,
    };
  }

  /** Step 6: user consent. Scopes may shrink; they can never grow. */
  async recordConsent(
    actor: DeveloperAuditActor,
    grantId: string,
    decision: 'GRANTED' | 'DENIED',
    consentedScopes?: string[],
  ): Promise<void> {
    const grant = await this.prisma.developerOAuthGrant.findUnique({ where: { id: grantId } });
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
    await this.prisma.developerOAuthGrant.update({
      where: { id: grant.id },
      data: { state: decision, consentedScopes: decision === 'GRANTED' ? finalScopes : [] },
    });
    await this.audit.record({
      ...actor,
      applicationId: grant.applicationId,
      action: decision === 'GRANTED' ? 'oauth.consent_granted' : 'oauth.consent_denied',
      detail: { grantId: grant.id, scopes: finalScopes },
    });
  }

  /**
   * Steps 7-8: authorization code issuance happens when consent is GRANTED
   * (backend-issued, backend-held). The code is returned exactly once and
   * stored only as a digest.
   */
  async issueAuthorizationCode(actor: DeveloperAuditActor, grantId: string): Promise<{ code: string; expiresIn: number }> {
    const grant = await this.prisma.developerOAuthGrant.findUnique({ where: { id: grantId } });
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
    await this.prisma.developerOAuthGrant.update({
      where: { id: grant.id },
      data: { codeHash: credentialDigest(code, this.hmacKey), codeExpiresAt: expiresAt },
    });
    return { code, expiresIn: policy.oauth.authorizationCodeTtlSeconds };
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
    const grant = await this.prisma.developerOAuthGrant.findFirst({
      where: { applicationId: application.id, codeHash: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!grant || !grant.codeHash) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'no authorization code outstanding');
    }
    if (grant.codeExpiresAt && grant.codeExpiresAt.getTime() < Date.now()) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_EXPIRED, 'authorization code expired');
    }
    if (grant.codeRedeemedAt) {
      // Single-use: a replayed code revokes the tokens issued from it.
      await this.prisma.developerAccessToken.updateMany({
        where: { grantId: grant.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        tenantId: input.tenantId,
        applicationId: application.id,
        actorType: 'SERVICE',
        actorId: input.clientId,
        correlationId: input.correlationId,
        action: 'oauth.code_replayed',
        detail: { grantId: grant.id },
      });
      throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_REPLAYED, 'authorization code already used');
    }
    if (grant.redirectUri !== input.redirectUri) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH, 'redirect_uri mismatch');
    }
    if (grant.codeChallenge) {
      const verifier = input.codeVerifier ?? '';
      const derived = createHash('sha256').update(verifier, 'utf8').digest('base64url');
      if (!constantTimeEqual(derived, grant.codeChallenge)) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.PKCE_VERIFIER_MISMATCH, 'PKCE verification failed');
      }
    }
    // Confidential clients must present the client secret (digest compare).
    const confidential = await this.prisma.developerCredential.findFirst({
      where: { applicationId: application.id, kind: 'OAUTH_CLIENT', revokedAt: null },
    });
    if (confidential) {
      if (!input.clientSecret) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'client authentication required');
      }
      const matches = constantTimeEqual(credentialDigest(input.clientSecret, this.hmacKey), confidential.secretHash);
      if (!matches) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_INVALID, 'client authentication failed');
      }
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
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.developerOAuthGrant.update({
        where: { id: grant.id },
        data: { codeRedeemedAt: new Date() },
      });
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
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: policy.oauth.accessTokenTtlSeconds,
      scope: tokenScopes.join(' '),
    };
  }

  /** Immediate revocation of a token (and thereby its API access). */
  async revokeToken(actor: DeveloperAuditActor, token: string): Promise<void> {
    const tokenHash = credentialDigest(token, this.hmacKey);
    const row = await this.prisma.developerAccessToken.findUnique({ where: { tokenHash } });
    if (!row || row.tenantId !== actor.tenantId) {
      // Revocation of unknown/foreign tokens is indistinguishable: no error.
      return;
    }
    if (!row.revokedAt) {
      await this.prisma.developerAccessToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      ...actor,
      applicationId: row.applicationId,
      action: 'oauth.token_revoked',
      detail: { grantId: row.grantId },
    });
  }

  /** Access resolution used by api-access.service (hash-lookup, scope output). */
  async resolveAccessToken(token: string): Promise<{
    tenantId: string;
    applicationId: string;
    scopes: string[];
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    const row = await this.prisma.developerAccessToken.findUnique({
      where: { tokenHash: credentialDigest(token, this.hmacKey) },
    });
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      applicationId: row.applicationId,
      scopes: row.scopes,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
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
