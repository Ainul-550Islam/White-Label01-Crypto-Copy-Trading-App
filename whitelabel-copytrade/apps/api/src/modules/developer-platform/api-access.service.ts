/**
 * Central backend authorization boundary for every developer API request.
 *
 * Resolves, in order: credential/token -> application -> tenant (from the
 * stored record, NEVER from headers) -> state checks -> API version gate ->
 * scope checks -> environment checks -> rate limit. The decision object is
 * the ONLY way a developer request reaches domain APIs through this module.
 * x-tenant-id / query tenantId / path tenantId are structurally ignored:
 * tenant identity comes exclusively from the credential row.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  constantTimeEqual,
  credentialDigest,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  parseScopeList,
  scopesIntersect,
  validateScopes,
} from './developer.types';
import { DeveloperCredentialService, DEVELOPER_SECRET_HMAC_KEY } from './developer-credential.service';
import { OAuthService } from './oauth.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
  type DeveloperPolicy,
} from './developer-policy.service';
import { ApiVersionService } from './api-version.service';
import { ApiRateLimitService, type RateLimitDecision } from './api-rate-limit.service';
import { DeveloperScopeService } from './developer-scope.service';

export interface DeveloperApiRequestContext {
  /** Bearer token (OAuth) or `keyId.secret` pair (API key). */
  authorization: string | null;
  /** Requested API version (explicit path/header/query already collapsed). */
  apiVersion: string;
  /** Endpoint capability class, e.g. `portfolio:read`. */
  requiredScope: string;
  endpointClass: string;
  nowIso: string;
  nowSeconds: number;
  /** Tenant context resolved by trusted server middleware, never a caller header. */
  resolvedTenantId: string;
  /** Environment of the server-mounted integration route. */
  expectedEnvironment: 'SANDBOX' | 'PRODUCTION';
  /** Client-supplied tenant hints are captured ONLY to be ignored. */
  clientTenantHint?: string;
}

export interface DeveloperAccessDecision {
  tenantId: string;
  applicationId: string;
  identityId: string;
  identityType: 'API_KEY' | 'OAUTH_TOKEN';
  /** Only an OAuth authorization carries an end-user subject. */
  userId: string | null;
  apiVersion: string;
  versionHeaders: Record<string, string>;
  effectiveScopes: string[];
  grantedScopes: string[];
  policy: DeveloperPolicy;
  rateLimit: RateLimitDecision;
  rateLimitHeaders: Record<string, string>;
  /** True when the credential came from a partner-owned application. */
  partnerId: string | null;
}

@Injectable()
export class ApiAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: OAuthService,
    private readonly credentials: DeveloperCredentialService,
    private readonly policyService: DeveloperPolicyService,
    private readonly scopeService: DeveloperScopeService,
    private readonly versionService: ApiVersionService,
    private readonly rateLimitService: ApiRateLimitService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    @Inject(DEVELOPER_SECRET_HMAC_KEY) private readonly hmacKey: string,
  ) {}

  private parseAuthorization(header: string): { kind: 'BEARER' | 'API_KEY'; token: string; keyId?: string } {
    const trimmed = header.trim();
    if (trimmed.startsWith('Bearer ')) {
      return { kind: 'BEARER', token: trimmed.slice('Bearer '.length).trim() };
    }
    // API-key scheme: `Developer devkey_<id>.devsec_<secret>`
    if (trimmed.startsWith('Developer ')) {
      const payload = trimmed.slice('Developer '.length).trim();
      const separator = payload.indexOf('.');
      if (separator <= 0) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'malformed Developer credentials');
      }
      return {
        kind: 'API_KEY',
        keyId: payload.slice(0, separator),
        token: payload.slice(separator + 1),
      };
    }
    throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'unsupported authorization scheme');
  }

  async authorize(context: DeveloperApiRequestContext): Promise<DeveloperAccessDecision> {
    if (!context.authorization) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'authorization required');
    }
    const parsed = this.parseAuthorization(context.authorization);

    // Resolve the credential AND its tenant from storage, never from input.
    let tenantId: string;
    let applicationId: string;
    let grantedScopes: string[];
    let identityId: string;
    let identityType: DeveloperAccessDecision['identityType'];
    let userId: string | null = null;
    let expiresAt: Date | null = null;

    if (parsed.kind === 'BEARER') {
      const token = await this.oauth.resolveAccessToken(context.resolvedTenantId, parsed.token);
      if (!token) throw new NotFoundException('token not recognized');
      if (token.revokedAt) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.TOKEN_REVOKED, 'token has been revoked');
      }
      if (token.expiresAt.getTime() < Date.now()) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_EXPIRED, 'token expired');
      }
      tenantId = token.tenantId;
      applicationId = token.applicationId;
      grantedScopes = token.scopes;
      identityId = `token:${token.id}`;
      identityType = 'OAUTH_TOKEN';
      userId = token.userId;
      expiresAt = token.expiresAt;
    } else {
      const credential = await this.prisma.withTenantRls(context.resolvedTenantId, (tx) => tx.developerCredential.findUnique({
        where: { keyId: parsed.keyId ?? '' },
      }));
      if (!credential || credential.tenantId !== context.resolvedTenantId || credential.revokedAt) {
        throw new NotFoundException('credential not recognized');
      }
      if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.CODE_EXPIRED, 'credential expired');
      }
      const matches = constantTimeEqual(
        credentialDigest(parsed.token, this.hmacKey),
        credential.secretHash,
      );
      if (!matches) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'credential verification failed');
      }
      tenantId = credential.tenantId;
      applicationId = credential.applicationId;
      grantedScopes = credential.scopes;
      identityId = credential.keyId;
      identityType = 'API_KEY';
      expiresAt = credential.expiresAt;
    }
    void expiresAt;

    // Application state gates (CHECKS 13/14): revoked and suspended apps are
    // denied before any scope or business logic runs.
    const { application, pinnedVersion } = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const application = await tx.developerApplication.findUnique({ where: { id: applicationId } });
      const pins = await tx.$queryRaw<Array<{ version: string }>>`
        SELECT pinned_api_version AS version FROM developer_applications
        WHERE tenant_id = ${tenantId}::uuid AND id = ${applicationId}::uuid`;
      return { application, pinnedVersion: pins[0]?.version };
    });
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('application not found');
    }
    if (application.state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    if (application.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED, 'application is not active');
    }
    if (application.environment !== context.expectedEnvironment) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH, 'application environment does not match the route');
    }

    // Version gate (CHECKS 22/23/24).
    const plan = await this.policyData.planLimitViewForTenant(tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(tenantId);
    const policy = this.policyService.resolve(tenantId, plan, entitlements);
    const resolution = this.versionService.resolve({
      pathVersion: context.apiVersion,
      nowIso: context.nowIso,
    });
    this.versionService.assertVersionAllowed(resolution.contract.version, policy.allowedApiVersions);
    if (!pinnedVersion || resolution.contract.version !== pinnedVersion) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VERSION_UNSUPPORTED, 'requested API version does not match the application pin');
    }

    // Scope gate: intersection of application, policy and credential scopes
    // must cover the endpoint's required scope (CHECKS 25/26/53).
    const effective = this.scopeService.resolve({
      applicationScopes: application.scopes,
      policyAllowedScopes: policy.allowedScopes,
      subjectScopes: grantedScopes,
    }).effective;
    const requested = validateScopes([context.requiredScope]);
    assertNoExtra(requested, effective);

    // Rate limit (CHECKS 27/29) — policy-driven, backend-enforced.
    const rateLimit = await this.rateLimitService.enforce(
      policy,
      {
        tenantId,
        applicationId,
        identityId,
        endpointClass: context.endpointClass,
        apiVersion: resolution.contract.version,
      },
      context.nowSeconds,
    );
    if (!rateLimit.allowed) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.RATE_LIMITED, 'rate limit exceeded', {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        tier: rateLimit.tier,
        tenantId, applicationId, apiVersion: resolution.contract.version,
      });
    }

    return {
      tenantId,
      applicationId,
      identityId,
      identityType,
      userId,
      apiVersion: resolution.contract.version,
      versionHeaders: resolution.headers,
      effectiveScopes: effective,
      grantedScopes: scopesIntersect(grantedScopes, parseScopeList(application.scopes)),
      policy,
      rateLimit,
      rateLimitHeaders: this.rateLimitService.headersFor(rateLimit),
      partnerId: application.partnerId,
    };
  }
}

function assertNoExtra(requested: string[], effective: string[]): void {
  const effectiveSet = new Set(parseScopeList(effective));
  for (const scope of requested) {
    if (!effectiveSet.has(scope)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_ESCALATION,
        `required scope '${scope}' is not granted to this credential`,
      );
    }
  }
}
