import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import type { SsoAuthTransaction, SsoConfiguration, SsoProviderType } from '@prisma/client';
import { ErrorCode, type LoginResultDto } from '@wlct/shared-types';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';
import type { TenantContext } from '../../../common/types/request.types';
import { AuthService, type AuthRequestContext } from '../auth.service';
import { OidcProviderService, OidcTransportError } from '../../security/oidc-provider.service';
import { SamlProviderService } from '../../security/saml-provider.service';
import type { VerifiedSsoIdentity } from '../../security/sso-provider.interface';
import {
  SSO_TRANSACTION_TTL_SECONDS,
  SsoAuditEventCode,
  SsoAuthError,
  SsoReasonCode,
  failureStageForReason,
  isAllowedSsoUrl,
  isSafeReturnTo,
} from '../../security/sso-flow.types';
import { SsoAuditService } from './sso-audit.service';
import { SsoIdentityService } from './sso-identity.service';
import { SsoTransactionService } from './sso-transaction.service';

export interface SsoStartInput {
  /** Omitted: the tenant's enabled provider (see loadDefaultConfig). */
  providerType?: SsoProviderType | null;
  deviceId: string;
  returnTo?: string | null;
}

/** Result of POST /v1/auth/sso/logout-url. `logoutUrl` is null when only a local logout applies. */
export interface SsoLogoutUrlResult {
  logoutUrl: string | null;
  providerType: 'OIDC' | 'SAML' | null;
  /**
   * Why there is no URL: NOT_SSO_SESSION, or an SSO reason code (for SAML for
   * example SAML_SLO_NOT_CONFIGURED or SAML_SLO_CONTEXT_MISSING).
   */
  reason: string | null;
}

/** Outcome of GET /v1/auth/sso/saml/slo. */
export interface SsoSamlLogoutOutcome {
  /** Where to 303-redirect the browser; null when nothing verifiable arrived (respond 400). */
  redirectTo: string | null;
}

export interface SsoStartResult {
  providerType: SsoProviderType;
  /** IdP URL the browser must be sent to. Contains state / nonce / PKCE challenge or the AuthnRequest; no secrets. */
  authorizationUrl: string;
  /**
   * Secret binding this login to the client that started it. The caller
   * (the web BFF or the mobile app) keeps it out of reach of page scripts
   * (HttpOnly cookie / secure storage) and presents it at completion.
   */
  bindingToken: string;
  expiresIn: number;
}

export interface SsoCompleteInput {
  state: string;
  code?: string | null;
  error?: string | null;
  bindingToken: string;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}

export interface SsoCompleteResult {
  /** A session (token pair + profile) or a two-factor challenge, exactly as password login returns. */
  result: LoginResultDto;
  /** Validated app-relative path chosen at start, if any. */
  returnTo: string | null;
}

export interface SsoAcsOutcome {
  /** Where to 303-redirect the browser; null when the transaction is unknown (respond 401). */
  redirectTo: string | null;
}

const GENERIC_MESSAGE =
  'Single sign-on could not be completed. Please try again or contact your administrator.';

interface FailureContext {
  tenantId: string;
  correlationId: string;
  ipHash: string | null;
  transaction?: SsoAuthTransaction | null;
  config?: Pick<SsoConfiguration, 'id' | 'providerType'> | null;
  providerType?: SsoProviderType | null;
  userId?: string | null;
}

/**
 * SSO login orchestration (OIDC authorization-code flow with PKCE, and SAML
 * Web-SSO with a one-time hand-off). Providers verify; this service owns the
 * transaction lifecycle, identity mapping, session issuance via AuthService,
 * durable audit and metrics.
 *
 * Every refusal is recorded with its specific reason code and surfaced to
 * the client as one generic error, so responses never reveal whether a
 * tenant, provider, transaction or account exists.
 */
@Injectable()
export class SsoLoginService {
  private readonly logger = new Logger(SsoLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly oidc: OidcProviderService,
    private readonly saml: SamlProviderService,
    private readonly transactions: SsoTransactionService,
    private readonly identities: SsoIdentityService,
    private readonly audit: SsoAuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  async start(
    tenant: TenantContext,
    input: SsoStartInput,
    context: AuthRequestContext,
  ): Promise<SsoStartResult> {
    const correlationId = randomUUID();
    const failure: FailureContext = {
      tenantId: tenant.tenantId,
      correlationId,
      ipHash: context.ipHash,
      providerType: input.providerType ?? null,
    };
    try {
      const returnTo = input.returnTo ?? null;
      if (returnTo !== null && !isSafeReturnTo(returnTo)) {
        throw new SsoAuthError(
          SsoReasonCode.RETURN_TO_INVALID,
          'returnTo must be an app-relative path',
        );
      }

      const config = input.providerType
        ? await this.loadEnabledConfig(tenant.tenantId, input.providerType)
        : await this.loadDefaultConfig(tenant.tenantId);
      failure.config = config;
      failure.providerType = config.providerType;

      if (config.providerType === 'OIDC') {
        this.oidc.assertConfigUsable(config);
        const endpoints = await this.oidc.resolveEndpoints(config);
        const created = await this.transactions.create({
          tenantId: tenant.tenantId,
          configurationId: config.id,
          providerType: 'OIDC',
          deviceId: input.deviceId,
          redirectUri: String(config.redirectUri),
          returnTo,
          ipHash: context.ipHash,
          correlationId,
          withNonce: true,
          withPkce: this.oidc.usesPkce(config),
        });
        failure.transaction = created.transaction;
        const authorizationUrl = this.oidc.buildAuthorizationUrl(config, endpoints, {
          state: created.state,
          nonce: String(created.nonce),
          codeChallenge: created.codeChallenge ?? undefined,
        });
        await this.recordStarted(
          tenant.tenantId,
          correlationId,
          config,
          created.transaction,
          context.ipHash,
        );
        return {
          providerType: 'OIDC',
          authorizationUrl,
          bindingToken: created.bindingToken,
          expiresIn: SSO_TRANSACTION_TTL_SECONDS,
        };
      }

      this.saml.assertConfigUsable(config);
      if (!config.redirectUri || !isAllowedSsoUrl(config.redirectUri)) {
        throw new SsoAuthError(
          SsoReasonCode.CONFIG_INVALID,
          'SAML completion redirect URI must be a registered https URL',
        );
      }
      const requestId = `_${randomBytes(20).toString('hex')}`;
      const created = await this.transactions.create({
        tenantId: tenant.tenantId,
        configurationId: config.id,
        providerType: 'SAML',
        deviceId: input.deviceId,
        redirectUri: config.redirectUri,
        returnTo,
        ipHash: context.ipHash,
        correlationId,
        withNonce: false,
        withPkce: false,
        samlRequestId: requestId,
      });
      failure.transaction = created.transaction;
      const authorizationUrl = await this.saml.buildAuthorizationUrl(config, {
        relayState: created.state,
        requestId,
      });
      await this.recordStarted(
        tenant.tenantId,
        correlationId,
        config,
        created.transaction,
        context.ipHash,
      );
      return {
        providerType: 'SAML',
        authorizationUrl,
        bindingToken: created.bindingToken,
        expiresIn: SSO_TRANSACTION_TTL_SECONDS,
      };
    } catch (error) {
      throw await this.fail(error, failure, SsoReasonCode.PROVIDER_UNAVAILABLE);
    }
  }

  // ---------------------------------------------------------------------------
  // Callback / completion
  // ---------------------------------------------------------------------------

  async complete(
    tenant: TenantContext,
    input: SsoCompleteInput,
    context: AuthRequestContext,
  ): Promise<SsoCompleteResult> {
    const failure: FailureContext = {
      tenantId: tenant.tenantId,
      correlationId: randomUUID(),
      ipHash: context.ipHash,
    };
    try {
      if (!input.state) {
        throw new SsoAuthError(SsoReasonCode.STATE_MISSING, 'state missing');
      }
      const tx = await this.transactions.findByState(input.state);
      if (!tx) {
        throw new SsoAuthError(SsoReasonCode.STATE_UNKNOWN, 'state does not match any login');
      }
      failure.transaction = tx;
      failure.providerType = tx.providerType;
      // The transaction's correlation id is only adopted once it is known to be this tenant's.
      if (tx.tenantId === tenant.tenantId) failure.correlationId = tx.correlationId;

      // A foreign tenant's transaction is never referenced from this tenant's audit trail.
      const ownTx = tx.tenantId === tenant.tenantId;
      await this.recordBestEffort({
        tenantId: tenant.tenantId,
        correlationId: failure.correlationId,
        eventCode: SsoAuditEventCode.CALLBACK_RECEIVED,
        outcome: 'INFO',
        providerType: tx.providerType,
        configurationId: ownTx ? tx.configurationId : null,
        transactionId: ownTx ? tx.id : null,
        ipHash: context.ipHash,
      });

      this.transactions.assertUsable(tx, {
        tenantId: tenant.tenantId,
        status: tx.providerType === 'SAML' ? 'VERIFIED' : 'PENDING',
        deviceId: input.deviceId,
        bindingToken: input.bindingToken,
      });

      const config = await this.loadConfigForTransaction(tenant.tenantId, tx);
      failure.config = config;

      if (input.error) {
        throw new SsoAuthError(SsoReasonCode.IDP_ERROR, 'IdP returned an error');
      }

      let userId: string;
      if (tx.providerType === 'OIDC') {
        this.oidc.assertConfigUsable(config);
        // One-time use: claim the transaction before talking to the IdP, so a
        // second callback with the same state can never redeem anything.
        await this.transactions.claimPending(tx.id);
        const codeVerifier = this.transactions.decryptVerifier(tx);
        const endpoints = await this.oidc.resolveEndpoints(config);
        const idToken = await this.oidc.redeemCode(config, endpoints, {
          code: input.code ?? '',
          redirectUri: tx.redirectUri,
          codeVerifier,
        });
        const identity: VerifiedSsoIdentity = await this.oidc.verifyIdToken(
          config,
          endpoints,
          idToken,
          { nonceHash: tx.nonceHash },
        );
        const resolved = await this.identities.resolveUser(tenant.tenantId, config, identity);
        userId = resolved.userId;
      } else {
        this.saml.assertConfigUsable(config);
        userId = await this.transactions.claimVerified(tx, input.code ?? '');
        await this.identities.assertUserUsable(tenant.tenantId, userId);
      }
      failure.userId = userId;

      const result = await this.issueSession(userId, tenant, input, context, failure);
      return { result, returnTo: tx.returnTo ?? null };
    } catch (error) {
      throw await this.fail(error, failure, SsoReasonCode.SESSION_ISSUANCE_FAILED);
    }
  }

  // ---------------------------------------------------------------------------
  // SAML Assertion Consumer Service
  // ---------------------------------------------------------------------------

  /**
   * Verifies the IdP's POSTed SAMLResponse for the transaction named by
   * RelayState, maps the user and hands the starting client a one-time code
   * (valid for SSO_HANDOFF_TTL_SECONDS) by redirecting the browser to the
   * configured completion URI. The session itself is only issued when that
   * client completes with its binding secret and device id.
   */
  async consumeSamlResponse(
    tenant: TenantContext,
    body: { SAMLResponse?: unknown; RelayState?: unknown },
    context: AuthRequestContext,
  ): Promise<SsoAcsOutcome> {
    const failure: FailureContext = {
      tenantId: tenant.tenantId,
      correlationId: randomUUID(),
      ipHash: context.ipHash,
      providerType: 'SAML',
    };
    const relayState = typeof body.RelayState === 'string' ? body.RelayState : '';
    const samlResponse = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
    let tx: SsoAuthTransaction | null = null;
    try {
      if (!relayState) {
        throw new SsoAuthError(
          SsoReasonCode.STATE_MISSING,
          'RelayState missing (IdP-initiated SSO is not accepted)',
        );
      }
      tx = await this.transactions.findByState(relayState);
      if (!tx) {
        throw new SsoAuthError(SsoReasonCode.STATE_UNKNOWN, 'RelayState does not match any login');
      }
      failure.transaction = tx;
      if (tx.tenantId === tenant.tenantId) failure.correlationId = tx.correlationId;

      const ownTx = tx.tenantId === tenant.tenantId;
      await this.recordBestEffort({
        tenantId: tenant.tenantId,
        correlationId: failure.correlationId,
        eventCode: SsoAuditEventCode.CALLBACK_RECEIVED,
        outcome: 'INFO',
        providerType: 'SAML',
        configurationId: ownTx ? tx.configurationId : null,
        transactionId: ownTx ? tx.id : null,
        ipHash: context.ipHash,
      });

      this.transactions.assertUsable(tx, {
        tenantId: tenant.tenantId,
        providerType: 'SAML',
        status: 'PENDING',
      });
      if (!tx.samlRequestId) {
        throw new SsoAuthError(
          SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH,
          'Transaction has no AuthnRequest ID',
        );
      }
      const config = await this.loadConfigForTransaction(tenant.tenantId, tx);
      failure.config = config;

      const verified = await this.saml.verifyResponse(config, {
        samlResponse,
        expectedRequestId: tx.samlRequestId,
      });
      await this.audit.record({
        tenantId: tenant.tenantId,
        correlationId: failure.correlationId,
        eventCode: SsoAuditEventCode.SAML_ASSERTION_VERIFIED,
        outcome: 'SUCCESS',
        providerType: 'SAML',
        configurationId: config.id,
        transactionId: tx.id,
        ipHash: context.ipHash,
      });

      const resolved = await this.identities.resolveUser(
        tenant.tenantId,
        config,
        verified.identity,
      );
      failure.userId = resolved.userId;
      // NameID / SessionIndex of the signed assertion, sealed, for Single Logout of the session.
      const samlLogout = this.transactions.sealSamlLogout(tenant.tenantId, config.id, verified.logoutContext);
      const handoff = await this.transactions.markVerified(tx.id, resolved.userId, undefined, samlLogout);

      const target = new URL(tx.redirectUri);
      target.searchParams.set('state', relayState);
      target.searchParams.set('code', handoff);
      return { redirectTo: target.toString() };
    } catch (error) {
      // The refusal is recorded durably; the browser only learns that SSO failed.
      await this.fail(error, failure, SsoReasonCode.SAML_MALFORMED);
      if (!tx) return { redirectTo: null };
      const target = new URL(tx.redirectUri);
      target.searchParams.set('error', 'sso_failed');
      return { redirectTo: target.toString() };
    }
  }

  // ---------------------------------------------------------------------------
  // Logout (RP-initiated)
  // ---------------------------------------------------------------------------

  /**
   * The IdP logout URL for the caller's CURRENT session, to be followed after
   * the local session is revoked (the web BFF asks for it first, then calls
   * POST /v1/auth/logout, then redirects the browser).
   *
   *  - a password session, or a session that is not the caller's / is
   *    revoked: no URL (NOT_SSO_SESSION) - local logout only;
   *  - an OIDC session: the OP's end_session_endpoint with client_id and
   *    post_logout_redirect_uri = <web origin>/login (OpenID Connect
   *    RP-Initiated Logout 1.0). The id_token is deliberately not retained
   *    after login, so no id_token_hint is sent; the OP may ask the user to
   *    confirm. Only when the issuing configuration is still the tenant's
   *    active one; otherwise (or when the OP publishes no end_session_endpoint)
   *    no URL, with the reason;
   *  - a SAML session (round 8, SAML Single Logout): the IdP SLO URL with a
   *    signed LogoutRequest for this session's NameID and SessionIndex, and a
   *    LOGOUT_PENDING transaction holding its ID; the IdP's LogoutResponse
   *    comes back to GET /v1/auth/sso/saml/slo. Only when the issuing
   *    configuration is still active and has Single Logout configured, and
   *    the session holds a logout context (sessions created before round 8 do
   *    not); otherwise no URL, with the reason (SAML_SLO_NOT_CONFIGURED,
   *    SAML_SLO_CONTEXT_MISSING, PROVIDER_NOT_CONFIGURED, ...).
   *
   * Never throws for a provider problem: logout must always complete locally.
   */
  async logoutUrl(
    tenantId: string,
    userId: string,
    sessionId: string,
    ipHash: string | null = null,
  ): Promise<SsoLogoutUrlResult> {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId, tenantId, revokedAt: null },
      select: { authMethod: true, ssoConfigurationId: true, deviceId: true, ssoLogoutContext: true },
    });
    if (!session || !session.ssoConfigurationId || (session.authMethod !== 'SSO_OIDC' && session.authMethod !== 'SSO_SAML')) {
      return { logoutUrl: null, providerType: null, reason: 'NOT_SSO_SESSION' };
    }
    if (session.authMethod === 'SSO_SAML') {
      return this.samlLogoutUrl(
        tenantId,
        userId,
        {
          ssoConfigurationId: session.ssoConfigurationId,
          deviceId: session.deviceId,
          ssoLogoutContext: session.ssoLogoutContext,
        },
        ipHash,
      );
    }
    try {
      const logoutUrl = await this.oidc.getLogoutUrl(tenantId, '/login', session.ssoConfigurationId);
      return { logoutUrl, providerType: 'OIDC', reason: null };
    } catch (error) {
      const reason = error instanceof SsoAuthError ? error.reason : 'PROVIDER_UNAVAILABLE';
      this.logger.warn(`sso.logout_url_unavailable tenant=${tenantId} reason=${reason}`);
      return { logoutUrl: null, providerType: 'OIDC', reason };
    }
  }

  // ---------------------------------------------------------------------------
  // SAML Single Logout endpoint (HTTP-Redirect binding)
  // ---------------------------------------------------------------------------

  /**
   * GET /v1/auth/sso/saml/slo. `rawQuery` is the query string exactly as
   * received (the redirect-binding signature covers its encoded bytes).
   *
   *  - SAMLResponse: the IdP's answer to our LogoutRequest. The transaction
   *    is found by RelayState and must be this tenant's, LOGOUT_PENDING and
   *    unexpired; the response must verify (signature, issuer, Destination,
   *    InResponseTo = the persisted request ID, Success). The transaction is
   *    then consumed once and the browser goes to the web login page. On any
   *    refusal the browser still goes there with ?sso=logout_unconfirmed:
   *    the local session was revoked before the IdP was involved.
   *  - SAMLRequest: IdP-initiated logout. It must verify (signature, issuer,
   *    Destination, freshness, not replayed); then the subject's sessions
   *    from this configuration (only the named SessionIndexes when given)
   *    are revoked and the browser is sent back to the IdP with our signed
   *    LogoutResponse. A request that does not verify revokes nothing and
   *    gets no LogoutResponse.
   *
   * Every refusal is recorded (SSO_SAML_LOGOUT_REJECTED with its reason).
   */
  async consumeSamlLogout(
    tenant: TenantContext,
    rawQuery: string,
    context: AuthRequestContext,
  ): Promise<SsoSamlLogoutOutcome> {
    const query = typeof rawQuery === 'string' ? rawQuery : '';
    const params = new URLSearchParams(query);
    if (params.has('SAMLResponse')) {
      return this.consumeLogoutResponse(tenant, query, params, context);
    }
    if (params.has('SAMLRequest')) {
      return this.consumeIdpLogoutRequest(tenant, query, params, context);
    }
    return { redirectTo: null };
  }

  private async consumeLogoutResponse(
    tenant: TenantContext,
    rawQuery: string,
    params: URLSearchParams,
    context: AuthRequestContext,
  ): Promise<SsoSamlLogoutOutcome> {
    let correlationId: string = randomUUID();
    let tx: SsoAuthTransaction | null = null;
    let configurationId: string | null = null;
    try {
      const relayState = params.get('RelayState') ?? '';
      if (!relayState) {
        throw new SsoAuthError(SsoReasonCode.STATE_MISSING, 'LogoutResponse carries no RelayState');
      }
      tx = await this.transactions.findByState(relayState);
      if (!tx) {
        throw new SsoAuthError(SsoReasonCode.STATE_UNKNOWN, 'RelayState does not match any logout');
      }
      if (tx.tenantId === tenant.tenantId) correlationId = tx.correlationId;
      this.transactions.assertUsable(tx, {
        tenantId: tenant.tenantId,
        providerType: 'SAML',
        status: 'LOGOUT_PENDING',
      });
      const config = await this.prisma.ssoConfiguration.findFirst({
        where: { id: tx.configurationId, tenantId: tenant.tenantId },
      });
      if (!config) {
        throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'SSO configuration no longer exists');
      }
      configurationId = config.id;
      await this.saml.verifyLogoutResponse(config, {
        rawQuery,
        expectedRequestId: tx.samlRequestId ?? '',
      });
      await this.transactions.claimLogout(tx.id);
      await this.recordBestEffort({
        tenantId: tenant.tenantId,
        correlationId,
        eventCode: SsoAuditEventCode.SAML_LOGOUT_COMPLETED,
        outcome: 'SUCCESS',
        providerType: 'SAML',
        configurationId: config.id,
        transactionId: tx.id,
        userId: tx.verifiedUserId,
        ipHash: context.ipHash,
      });
      return { redirectTo: tx.redirectUri };
    } catch (error) {
      const ownTx = tx && tx.tenantId === tenant.tenantId ? tx : null;
      if (!(error instanceof SsoAuthError)) {
        this.logger.error(
          `sso.saml_logout_unexpected_failure tenant=${tenant.tenantId} correlation=${correlationId}: ${(error as Error)?.name ?? 'Error'}`,
        );
        throw error;
      }
      if (ownTx && error.reason !== SsoReasonCode.STATE_CONSUMED && error.reason !== SsoReasonCode.STATE_EXPIRED) {
        await this.transactions.reject(ownTx.id, error.reason);
      }
      await this.recordLogoutRejection(tenant.tenantId, correlationId, error.reason, {
        configurationId: configurationId ?? (ownTx ? ownTx.configurationId : null),
        transactionId: ownTx ? ownTx.id : null,
        userId: ownTx ? ownTx.verifiedUserId : null,
        ipHash: context.ipHash,
      });
      if (!ownTx) return { redirectTo: null };
      const target = new URL(ownTx.redirectUri);
      target.searchParams.set('sso', 'logout_unconfirmed');
      return { redirectTo: target.toString() };
    }
  }

  private async consumeIdpLogoutRequest(
    tenant: TenantContext,
    rawQuery: string,
    params: URLSearchParams,
    context: AuthRequestContext,
  ): Promise<SsoSamlLogoutOutcome> {
    const correlationId = randomUUID();
    let configurationId: string | null = null;
    try {
      const config = await this.prisma.ssoConfiguration.findUnique({
        where: { tenantId_providerType: { tenantId: tenant.tenantId, providerType: 'SAML' } },
      });
      if (!config) {
        throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'No SAML configuration for this tenant');
      }
      configurationId = config.id;
      const verified = await this.saml.verifyLogoutRequest(config, { rawQuery });
      const revokedCount = await this.auth.revokeSamlIdpSessions({
        tenantId: tenant.tenantId,
        configurationId: config.id,
        subjectHash: this.transactions.samlSubjectHash(config.id, verified.nameID),
        sessionIndexHashes: verified.sessionIndexes.map((index) =>
          this.transactions.samlSessionIndexHash(config.id, index),
        ),
      });
      await this.recordBestEffort({
        tenantId: tenant.tenantId,
        correlationId,
        eventCode: SsoAuditEventCode.SAML_IDP_LOGOUT_COMPLETED,
        outcome: 'SUCCESS',
        providerType: 'SAML',
        configurationId: config.id,
        ipHash: context.ipHash,
        metadata: { revokedCount, indexCount: verified.sessionIndexes.length },
      });
      const redirectTo = await this.saml.buildLogoutResponseUrl(config, {
        inResponseTo: verified.requestId,
        relayState: params.get('RelayState'),
        responseId: `_${randomBytes(20).toString('hex')}`,
      });
      return { redirectTo };
    } catch (error) {
      if (!(error instanceof SsoAuthError)) {
        this.logger.error(
          `sso.saml_idp_logout_unexpected_failure tenant=${tenant.tenantId} correlation=${correlationId}: ${(error as Error)?.name ?? 'Error'}`,
        );
        throw error;
      }
      await this.recordLogoutRejection(tenant.tenantId, correlationId, error.reason, {
        configurationId,
        transactionId: null,
        userId: null,
        ipHash: context.ipHash,
      });
      return { redirectTo: null };
    }
  }

  /**
   * SP-initiated SAML logout URL for one session (see logoutUrl). Never
   * throws: any refusal or failure is returned as the reason, and the local
   * logout proceeds without the IdP.
   */
  private async samlLogoutUrl(
    tenantId: string,
    userId: string,
    session: { ssoConfigurationId: string; deviceId: string; ssoLogoutContext: unknown },
    ipHash: string | null,
  ): Promise<SsoLogoutUrlResult> {
    const correlationId = randomUUID();
    try {
      const config = await this.prisma.ssoConfiguration.findFirst({
        where: { id: session.ssoConfigurationId, tenantId, providerType: 'SAML' },
      });
      if (!config || !config.isActive || (config.state !== 'ENABLED' && config.state !== 'ENFORCED')) {
        throw new SsoAuthError(
          SsoReasonCode.PROVIDER_NOT_CONFIGURED,
          'The configuration that issued this session is no longer active',
        );
      }
      this.saml.assertSloUsable(config);
      const context = this.transactions.openSamlLogout(tenantId, config.id, session.ssoLogoutContext);
      if (!config.redirectUri || !isAllowedSsoUrl(config.redirectUri)) {
        throw new SsoAuthError(
          SsoReasonCode.SAML_SLO_NOT_CONFIGURED,
          'No registered https web redirect URI to return to after logout',
        );
      }
      const returnTo = new URL('/login', config.redirectUri).toString();
      const requestId = `_${randomBytes(20).toString('hex')}`;
      const created = await this.transactions.createLogout({
        tenantId,
        configurationId: config.id,
        userId,
        deviceId: session.deviceId,
        redirectUri: returnTo,
        samlRequestId: requestId,
        correlationId,
        ipHash,
      });
      const logoutUrl = await this.saml.buildLogoutRequestUrl(config, context, {
        requestId,
        relayState: created.relayState,
      });
      await this.recordBestEffort({
        tenantId,
        correlationId,
        eventCode: SsoAuditEventCode.SAML_LOGOUT_REQUESTED,
        outcome: 'INFO',
        providerType: 'SAML',
        configurationId: config.id,
        transactionId: created.transaction.id,
        userId,
        ipHash,
      });
      return { logoutUrl, providerType: 'SAML', reason: null };
    } catch (error) {
      const reason = error instanceof SsoAuthError ? error.reason : SsoReasonCode.PROVIDER_UNAVAILABLE;
      this.logger.warn(`sso.saml_logout_url_unavailable tenant=${tenantId} reason=${reason}`);
      return { logoutUrl: null, providerType: 'SAML', reason };
    }
  }

  /** Durable record + metric of a refused SAML logout message (never throws). */
  private async recordLogoutRejection(
    tenantId: string,
    correlationId: string,
    reason: SsoReasonCode,
    refs: { configurationId: string | null; transactionId: string | null; userId: string | null; ipHash: string | null },
  ): Promise<void> {
    this.audit.countFailure(failureStageForReason(reason));
    await this.recordBestEffort({
      tenantId,
      correlationId,
      eventCode: SsoAuditEventCode.SAML_LOGOUT_REJECTED,
      outcome: 'FAILURE',
      reasonCode: reason,
      providerType: 'SAML',
      configurationId: refs.configurationId,
      transactionId: refs.transactionId,
      userId: refs.userId,
      ipHash: refs.ipHash,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async issueSession(
    userId: string,
    tenant: TenantContext,
    input: SsoCompleteInput,
    context: AuthRequestContext,
    failure: FailureContext,
  ): Promise<LoginResultDto> {
    let result: LoginResultDto;
    try {
      result = await this.auth.completeSsoLogin(
        userId,
        tenant,
        {
          deviceId: input.deviceId,
          deviceName: input.deviceName ?? null,
          platform: input.platform ?? null,
          appVersion: input.appVersion ?? null,
        },
        context,
        failure.transaction && failure.config
          ? {
              providerType: failure.transaction.providerType,
              configurationId: failure.config.id,
              // The consumed login transaction: AuthService reads the SAML logout
              // context from it (also after a two-factor step).
              transactionId: failure.transaction.id,
            }
          : undefined,
      );
    } catch (error) {
      if (error instanceof AppException) {
        const code = error.code;
        if (
          code === ErrorCode.ACCOUNT_DISABLED ||
          code === ErrorCode.ACCOUNT_LOCKED ||
          code === ErrorCode.INVALID_CREDENTIALS
        ) {
          throw new SsoAuthError(SsoReasonCode.ACCOUNT_UNAVAILABLE, 'Account is not usable');
        }
      }
      throw error;
    }

    const base = {
      tenantId: tenant.tenantId,
      correlationId: failure.correlationId,
      providerType: failure.transaction?.providerType ?? null,
      configurationId: failure.config?.id ?? null,
      transactionId: failure.transaction?.id ?? null,
      userId,
      ipHash: context.ipHash,
    };

    if ('twoFactorRequired' in result && result.twoFactorRequired) {
      await this.audit.record({
        ...base,
        eventCode: SsoAuditEventCode.MFA_CHALLENGE_ISSUED,
        outcome: 'INFO',
      });
      this.audit.countLogin('succeeded');
      return result;
    }

    const sessionId = 'sessionId' in result ? result.sessionId : null;
    try {
      await this.audit.record({
        ...base,
        eventCode: SsoAuditEventCode.SESSION_CREATED,
        outcome: 'SUCCESS',
        metadata: { sessionId },
      });
      await this.audit.record({
        ...base,
        eventCode: SsoAuditEventCode.LOGIN_SUCCEEDED,
        outcome: 'SUCCESS',
      });
    } catch (error) {
      // A session without its durable audit trail is not acceptable: revoke it.
      if (sessionId) {
        try {
          await this.auth.revokeSsoSession(userId, sessionId);
        } catch (revokeError) {
          this.logger.error(
            `sso.session_revoke_failed tenant=${tenant.tenantId} correlation=${failure.correlationId}: ${(revokeError as Error).name}`,
          );
        }
      }
      throw new SsoAuthError(
        SsoReasonCode.SESSION_ISSUANCE_FAILED,
        `Audit write failed: ${(error as Error).name}`,
      );
    }
    this.audit.countLogin('succeeded');
    await this.audit.mirrorSuccess({
      tenantId: tenant.tenantId,
      userId,
      correlationId: failure.correlationId,
      providerType: (failure.transaction?.providerType ?? 'OIDC') as SsoProviderType,
      ipHash: context.ipHash,
    });
    return result;
  }

  private async loadEnabledConfig(
    tenantId: string,
    providerType: SsoProviderType,
  ): Promise<SsoConfiguration> {
    const config = await this.prisma.ssoConfiguration.findUnique({
      where: { tenantId_providerType: { tenantId, providerType } },
    });
    if (!config) {
      throw new SsoAuthError(
        SsoReasonCode.PROVIDER_NOT_CONFIGURED,
        'No SSO configuration for this provider',
      );
    }
    if (!config.isActive || (config.state !== 'ENABLED' && config.state !== 'ENFORCED')) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_DISABLED, 'SSO provider is disabled');
    }
    return config;
  }

  /**
   * The configuration a client gets when it does not name a provider (the web
   * login page's single "Sign in with SSO" button): the tenant's only enabled
   * configuration; with OIDC and SAML both enabled, the enforced one, and
   * OIDC when both or neither are enforced.
   */
  private async loadDefaultConfig(tenantId: string): Promise<SsoConfiguration> {
    const configs = await this.prisma.ssoConfiguration.findMany({
      where: { tenantId, isActive: true, state: { in: ['ENABLED', 'ENFORCED'] } },
    });
    if (configs.length === 0) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'No enabled SSO configuration');
    }
    if (configs.length === 1) return configs[0];
    const enforced = configs.filter((config) => config.state === 'ENFORCED');
    if (enforced.length === 1) return enforced[0];
    return configs.find((config) => config.providerType === 'OIDC') ?? configs[0];
  }

  private async loadConfigForTransaction(
    tenantId: string,
    tx: SsoAuthTransaction,
  ): Promise<SsoConfiguration> {
    const config = await this.prisma.ssoConfiguration.findFirst({
      where: { id: tx.configurationId, tenantId },
    });
    if (!config) {
      throw new SsoAuthError(
        SsoReasonCode.PROVIDER_NOT_CONFIGURED,
        'SSO configuration no longer exists',
      );
    }
    if (config.providerType !== tx.providerType) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_MISMATCH, 'Configuration provider changed');
    }
    if (!config.isActive || (config.state !== 'ENABLED' && config.state !== 'ENFORCED')) {
      throw new SsoAuthError(
        SsoReasonCode.PROVIDER_DISABLED,
        'SSO provider was disabled during the login',
      );
    }
    // The redirect URI is pinned at start; an operator change mid-login invalidates the transaction
    // rather than redeeming a code or handing off to a target the login was not started for.
    if (!config.redirectUri || config.redirectUri !== tx.redirectUri) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'Redirect URI changed during the login');
    }
    return config;
  }

  private async recordStarted(
    tenantId: string,
    correlationId: string,
    config: SsoConfiguration,
    tx: SsoAuthTransaction,
    ipHash: string | null,
  ): Promise<void> {
    await this.audit.record({
      tenantId,
      correlationId,
      eventCode: SsoAuditEventCode.AUTHORIZATION_STARTED,
      outcome: 'INFO',
      providerType: config.providerType,
      configurationId: config.id,
      transactionId: tx.id,
      ipHash,
    });
    this.audit.countLogin('started');
  }

  private async recordBestEffort(input: Parameters<SsoAuditService['record']>[0]): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (error) {
      this.logger.error(
        `sso.audit_write_failed event=${input.eventCode} tenant=${input.tenantId}: ${(error as Error).name}`,
      );
    }
  }

  /**
   * Records a refusal durably, burns the transaction, and returns the error
   * to throw: a generic AppException for SSO refusals, or the original error
   * for unexpected failures (which the global filter turns into a 500
   * without details).
   */
  private async fail(error: unknown, ctx: FailureContext, fallback: SsoReasonCode): Promise<Error> {
    let ssoError: SsoAuthError | null = null;
    if (error instanceof SsoAuthError) {
      ssoError = error;
    } else if (error instanceof OidcTransportError) {
      ssoError = new SsoAuthError(SsoReasonCode.PROVIDER_UNAVAILABLE, 'IdP unreachable');
    }

    const reason = ssoError?.reason ?? fallback;
    const tx = ctx.transaction;
    // Only a transaction of this tenant is burned; a foreign one is left to its owner and expires.
    if (
      tx &&
      tx.tenantId === ctx.tenantId &&
      reason !== SsoReasonCode.STATE_CONSUMED &&
      reason !== SsoReasonCode.STATE_EXPIRED
    ) {
      await this.transactions.reject(tx.id, reason);
    }
    await this.audit.recordRejection({
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      reasonCode: reason,
      providerType: ctx.config?.providerType ?? tx?.providerType ?? ctx.providerType ?? null,
      configurationId:
        ctx.config?.id ?? (tx && tx.tenantId === ctx.tenantId ? tx.configurationId : null),
      transactionId: tx && tx.tenantId === ctx.tenantId ? tx.id : null,
      userId: ctx.userId ?? null,
      ipHash: ctx.ipHash,
    });

    if (!ssoError) {
      this.logger.error(
        `sso.unexpected_failure tenant=${ctx.tenantId} correlation=${ctx.correlationId}: ${(error as Error)?.name ?? 'Error'}`,
      );
      return error instanceof Error ? error : new Error('SSO failure');
    }
    if (reason === SsoReasonCode.TOO_MANY_PENDING) {
      return new AppException({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many sign-in attempts. Please wait and try again.',
      });
    }
    return new AppException({ code: ErrorCode.UNAUTHORIZED, message: GENERIC_MESSAGE });
  }
}
