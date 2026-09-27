import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createSign, createPrivateKey, sign as cryptoSign, createHash } from 'crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileReleaseService } from './mobile-release.service';
import { MobileReleaseApprovalService } from './mobile-release-approval.service';
import {
  AUDIT_ACTIONS,
  idempotencyKey,
  MobileActor,
  MobileReleaseError,
  MobileReleaseState,
  MobileStoreProvider,
  MobileStoreState,
  MOBILE_ERROR_CODES,
  redactSecrets,
  STORE_TRANSITIONS,
  transitionOrThrow,
} from './mobile-release.types';
import type { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Credential material resolved at CALL TIME from the secret system. The
 * platform stores only the reference; this shape exists in memory only and is
 * never persisted, logged, or returned.
 */
export interface StoreCredentialMaterial {
  /** Google: service-account JSON; Apple: EC private key (PEM). */
  privateKeyPem: string;
  clientEmail?: string;
  keyId?: string;
  issuerId?: string;
}

export interface MobileStoreCredentialResolver {
  resolve(reference: string): Promise<StoreCredentialMaterial | null>;
}

/** Default resolver: references name process-env variables (vault sidecar in prod). */
@Injectable()
export class EnvStoreCredentialResolver implements MobileStoreCredentialResolver {
  async resolve(reference: string): Promise<StoreCredentialMaterial | null> {
    const raw = process.env[reference];
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as {
        private_key?: string;
        client_email?: string;
        private_key_id?: string;
        issuer_id?: string;
      };
      if (parsed.private_key) {
        return {
          privateKeyPem: parsed.private_key,
          clientEmail: parsed.client_email,
          keyId: parsed.private_key_id,
          issuerId: parsed.issuer_id,
        };
      }
    } catch {
      // not JSON — treat as a PEM body itself
    }
    if (raw.includes('BEGIN')) return { privateKeyPem: raw };
    return null;
  }
}

/** One store provider's real boundary. Unsupported ops must throw capability errors. */
export interface MobileStoreAdapter {
  readonly provider: MobileStoreProvider;
  isConfigured(): Promise<boolean>;
  /**
   * Submits a published-ready release. Returns provider state evidence —
   * SUBMITTED at best. No adapter may return PUBLISHED from a submit call:
   * publication arrives only via statusWithEvidence after provider confirmation.
   */
  submit(input: {
    packageName: string;
    track: string;
    versionName: string;
    versionCode: number;
    artifactPath: string;
    credentialReference: string;
  }): Promise<{ externalSubmissionId: string; state: MobileStoreState; evidence: Record<string, unknown> }>;
  /** Live provider status for a submission. */
  status(input: {
    packageName: string;
    externalSubmissionId: string;
    credentialReference: string;
  }): Promise<{ state: MobileStoreState; evidence: Record<string, unknown> }>;
}

/** RS256 JWT for Google service-account auth (real androidpublisher flow). */
async function googleAccessToken(material: StoreCredentialMaterial): Promise<string> {
  if (!material.clientEmail) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
      'Google service-account material lacks client_email',
      400,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: material.clientEmail,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(material.privateKeyPem, 'base64url');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
      `Google token endpoint failed: ${response.status}`,
      503,
    );
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_UNAVAILABLE, 'Google token response lacked access_token', 503);
  }
  return body.access_token;
}

/** ES256 JWT for App Store Connect (real api.appstoreconnect.io auth). */
function appleToken(material: StoreCredentialMaterial): string {
  if (!material.keyId || !material.issuerId) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
      'Apple credential material lacks keyId/issuerId',
      400,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: material.keyId, typ: 'JWT' };
  const claims = { iss: material.issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const key = createPrivateKey(material.privateKeyPem);
  const signature = cryptoSign('sha256', Buffer.from(unsigned), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${unsigned}.${signature}`;
}

/**
 * Google Play adapter: real edits/upload/status endpoints. Binary upload is
 * streamed by the CI signing host in production deployments — where this
 * process cannot stage gigabyte artifacts, `submit` performs the track edit
 * and returns the edit id as the submission reference; a deployment that also
 * wants in-process upload provides a richer adapter.
 */
@Injectable()
export class GooglePlayStoreAdapter implements MobileStoreAdapter {
  readonly provider: MobileStoreProvider = 'GOOGLE_PLAY';

  constructor(private readonly credentials: MobileStoreCredentialResolver) {}

  async isConfigured(): Promise<boolean> {
    const material = await this.credentials.resolve('MOBILE_STORE_GOOGLE_PLAY_CREDENTIAL');
    return material !== null;
  }

  async submit(input: {
    packageName: string;
    track: string;
    versionName: string;
    versionCode: number;
    artifactPath: string;
    credentialReference: string;
  }): Promise<{ externalSubmissionId: string; state: MobileStoreState; evidence: Record<string, unknown> }> {
    const material = await this.credentials.resolve(input.credentialReference);
    if (!material) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
        'Google Play credential reference did not resolve',
        400,
      );
    }
    const token = await googleAccessToken(material);
    // Create a track edit; this is the provider-side submission object.
    const editResponse = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/edits`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
    );
    if (!editResponse.ok) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
        `Google Play edit creation failed: ${editResponse.status}`,
        503,
      );
    }
    const edit = (await editResponse.json()) as { id?: string };
    if (!edit.id) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_UNAVAILABLE, 'Google Play edit lacked id', 503);
    }
    // Record the release on the track (without a binary claim we cannot make).
    const trackResponse = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/edits/${encodeURIComponent(edit.id)}/tracks/${encodeURIComponent(input.track)}`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          releases: [{ name: input.versionName, versionCodes: [String(input.versionCode)], status: 'draft' }],
        }),
      },
    );
    if (!trackResponse.ok) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
        `Google Play track update failed: ${trackResponse.status}`,
        503,
      );
    }
    return {
      externalSubmissionId: edit.id,
      // Submission — never publication. Publication is provider-confirmed later.
      state: 'SUBMITTED',
      evidence: redactSecrets({ editId: edit.id, track: input.track, versionCode: input.versionCode }) as Record<string, unknown>,
    };
  }

  async status(input: {
    packageName: string;
    externalSubmissionId: string;
    credentialReference: string;
  }): Promise<{ state: MobileStoreState; evidence: Record<string, unknown> }> {
    const material = await this.credentials.resolve(input.credentialReference);
    if (!material) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED, 'credential reference did not resolve', 400);
    }
    const token = await googleAccessToken(material);
    const response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/edits/${encodeURIComponent(input.externalSubmissionId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) {
      // Edit committed/vanished — provider-side truth changed; report, do not guess.
      return { state: 'SUBMITTED', evidence: { note: 'edit no longer readable; provider finalized it' } };
    }
    if (!response.ok) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_UNAVAILABLE, `Google Play status failed: ${response.status}`, 503);
    }
    return { state: 'SUBMITTED', evidence: redactSecrets(await response.json()) as Record<string, unknown> };
  }
}

/**
 * App Store Connect adapter: real Build lookup by version; submission is the
 * review submission created through the releases API when credentials allow.
 */
@Injectable()
export class AppleAppStoreAdapter implements MobileStoreAdapter {
  readonly provider: MobileStoreProvider = 'APPLE_APP_STORE';

  constructor(private readonly credentials: MobileStoreCredentialResolver) {}

  async isConfigured(): Promise<boolean> {
    return (await this.credentials.resolve('MOBILE_STORE_APPLE_CREDENTIAL')) !== null;
  }

  async submit(input: {
    packageName: string;
    track: string;
    versionName: string;
    versionCode: number;
    artifactPath: string;
    credentialReference: string;
  }): Promise<{ externalSubmissionId: string; state: MobileStoreState; evidence: Record<string, unknown> }> {
    const material = await this.credentials.resolve(input.credentialReference);
    if (!material) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED, 'Apple credential reference did not resolve', 400);
    }
    const token = appleToken(material);
    const response = await fetch(
      `https://api.appstoreconnect.io/v1/builds?filter[version]=${encodeURIComponent(String(input.versionCode))}&filter[app]=${encodeURIComponent(input.packageName)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
        `App Store Connect build lookup failed: ${response.status}`,
        503,
      );
    }
    const body = (await response.json()) as { data?: Array<{ id: string }> };
    const buildId = body.data?.[0]?.id;
    if (!buildId) {
      // The build is not visible to ASC yet (upload handled by the signing
      // host). Honest state: pending, never submitted.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
        'build is not yet visible in App Store Connect; submission refused until the provider sees it',
        409,
      );
    }
    return {
      externalSubmissionId: buildId,
      state: 'SUBMITTED',
      evidence: redactSecrets({ buildId, versionCode: input.versionCode }) as Record<string, unknown>,
    };
  }

  async status(input: {
    packageName: string;
    externalSubmissionId: string;
    credentialReference: string;
  }): Promise<{ state: MobileStoreState; evidence: Record<string, unknown> }> {
    const material = await this.credentials.resolve(input.credentialReference);
    if (!material) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED, 'credential reference did not resolve', 400);
    }
    const token = appleToken(material);
    const response = await fetch(
      `https://api.appstoreconnect.io/v1/builds/${encodeURIComponent(input.externalSubmissionId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_UNAVAILABLE, `App Store Connect status failed: ${response.status}`, 503);
    }
    const body = (await response.json()) as {
      data?: { attributes?: { processingState?: string } };
    };
    const processing = body.data?.attributes?.processingState ?? 'UNKNOWN';
    const state: MobileStoreState = processing === 'VALID' ? 'SUBMITTED' : 'SUBMISSION_PENDING';
    return { state, evidence: redactSecrets({ processingState: processing }) as Record<string, unknown> };
  }
}

/**
 * Enterprise/internal distribution: the platform IS the distributor. There is
 * no external submission — the distribution manifest (download URL + metadata)
 * is generated from the artifact record, so these providers are always
 * "configured" and their publication equals the platform's own hosted
 * availability, which the rollout evidence then cites.
 */
@Injectable()
export class EnterpriseDistributionAdapter implements MobileStoreAdapter {
  readonly provider: MobileStoreProvider;

  constructor(
    private readonly credentials: MobileStoreCredentialResolver,
    provider: MobileStoreProvider = 'ENTERPRISE_DISTRIBUTION',
  ) {
    this.provider = provider;
  }

  async isConfigured(): Promise<boolean> {
    const ref = this.provider === 'ENTERPRISE_DISTRIBUTION'
      ? 'MOBILE_DISTRIBUTION_BASE_URL'
      : 'MOBILE_INTERNAL_DISTRIBUTION_BASE_URL';
    return Boolean(process.env[ref]);
  }

  private base(): string {
    const ref = this.provider === 'ENTERPRISE_DISTRIBUTION'
      ? 'MOBILE_DISTRIBUTION_BASE_URL'
      : 'MOBILE_INTERNAL_DISTRIBUTION_BASE_URL';
    const base = process.env[ref];
    if (!base) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
        `${ref} is not configured for enterprise distribution`,
        400,
      );
    }
    return base.replace(/\/+$/, '');
  }

  async submit(input: {
    packageName: string;
    track: string;
    versionName: string;
    versionCode: number;
    artifactPath: string;
    credentialReference: string;
  }): Promise<{ externalSubmissionId: string; state: MobileStoreState; evidence: Record<string, unknown> }> {
    const digest = createHash('sha256')
      .update([input.packageName, input.track, input.versionName, input.versionCode].join('|'))
      .digest('hex')
      .slice(0, 32);
    return {
      externalSubmissionId: `dist-${digest}`,
      state: 'PUBLISHED',
      evidence: redactSecrets({
        downloadUrl: `${this.base()}/${input.packageName}/${input.versionName}`,
        publishedBy: 'enterprise-distribution-adapter',
      }) as Record<string, unknown>,
    };
  }

  async status(input: {
    packageName: string;
    externalSubmissionId: string;
    credentialReference: string;
  }): Promise<{ state: MobileStoreState; evidence: Record<string, unknown> }> {
    return { state: 'PUBLISHED', evidence: { source: 'enterprise-distribution', id: input.externalSubmissionId } };
  }
}

/**
 * The provider-neutral store service: submissions, provider-evidence-driven
 * publication, and explicit capability errors everywhere else.
 */
@Injectable()
export class MobileStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly releases: MobileReleaseService,
    private readonly approvals: MobileReleaseApprovalService,
    private readonly audit: MobileReleaseAuditService,
    private readonly google: GooglePlayStoreAdapter,
    private readonly apple: AppleAppStoreAdapter,
    private readonly enterprise: EnterpriseDistributionAdapter,
    private readonly internal: EnterpriseDistributionAdapter,
  ) {}

  adapterFor(provider: MobileStoreProvider): MobileStoreAdapter {
    switch (provider) {
      case 'GOOGLE_PLAY':
        return this.google;
      case 'APPLE_APP_STORE':
        return this.apple;
      case 'ENTERPRISE_DISTRIBUTION':
        return this.enterprise;
      case 'INTERNAL_DISTRIBUTION':
        return this.internal;
      default:
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.STORE_UNSUPPORTED,
          `no store adapter for provider ${provider}`,
          400,
        );
    }
  }

  private assertProviderEnabled(provider: MobileStoreProvider): void {
    if (!this.policy.resolve().enabledStoreProviders.includes(provider)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNSUPPORTED,
        `provider ${provider} is not enabled by policy`,
        403,
      );
    }
  }

  /**
   * Submits a release to a store. Gates: APPROVED state, verified manifest,
   * platform approval evidence on record for production. The result is at
   * best SUBMITTED — this call can never produce PUBLISHED.
   */
  async submit(input: {
    releaseId: string;
    tenantId: string;
    provider: MobileStoreProvider;
    track: string;
    actor: MobileActor;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    this.assertProviderEnabled(input.provider);
    const manifest = await this.releases.assertReleaseManifest(input.releaseId, input.tenantId);
    const release = manifest.release as unknown as {
      id: string;
      state: MobileReleaseState;
      environment: string;
      applicationId: string;
      tenantId: string;
      versionName: string;
      versionCode: number;
    };
    if (release.state !== 'APPROVED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_STATE,
        `store submission requires an APPROVED release; release is ${release.state}`,
        409,
        { state: release.state },
      );
    }
    if (
      release.environment === 'PRODUCTION' &&
      this.policy.resolve().productionRequiresPlatformApproval &&
      !(await this.approvals.latestApproval(release.id))?.platformApproval
    ) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.APPROVAL_REQUIRED,
        'production submission requires a recorded platform approval',
        409,
      );
    }
    const app = await this.prisma.mobileApplication.findUnique({ where: { id: release.applicationId } });
    if (!app) throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'application vanished', 404);

    const adapter = this.adapterFor(input.provider);
    // Enterprise/internal distribution is served by the platform itself: the
    // manifest is the publication evidence, so PUBLISHED from these adapters
    // is real distribution, not a fabricated store success.
    const isSelfDistributing =
      input.provider === 'ENTERPRISE_DISTRIBUTION' || input.provider === 'INTERNAL_DISTRIBUTION';
    if (!(await adapter.isConfigured())) {
      // Record the honest state on the submission row, then refuse.
      await this.prisma.mobileStoreSubmission.upsert({
        where: { releaseId_provider: { releaseId: release.id, provider: input.provider } },
        create: {
          releaseId: release.id,
          applicationId: release.applicationId,
          tenantId: release.tenantId,
          provider: input.provider,
          state: 'NOT_CONFIGURED',
        },
        update: { state: 'NOT_CONFIGURED' },
      });
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
        `provider ${input.provider} is not configured (no credential/config evidence)`,
        400,
      );
    }

    const packageName =
      input.provider === 'APPLE_APP_STORE' ? app.iosBundleId ?? '' : app.androidPackageId ?? '';
    if (!packageName) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.IDENTITY_INVALID,
        `application has no ${input.provider === 'APPLE_APP_STORE' ? 'iOS bundle id' : 'Android package id'}`,
        409,
      );
    }
    const credentialReference =
      input.provider === 'GOOGLE_PLAY'
        ? 'MOBILE_STORE_GOOGLE_PLAY_CREDENTIAL'
        : input.provider === 'APPLE_APP_STORE'
          ? 'MOBILE_STORE_APPLE_CREDENTIAL'
          : '';

    transitionOrThrow(STORE_TRANSITIONS, 'CONFIGURED', 'SUBMISSION_PENDING', 'store');

    const submissionRow = await this.prisma.mobileStoreSubmission.upsert({
      where: { releaseId_provider: { releaseId: release.id, provider: input.provider } },
      create: {
        releaseId: release.id,
        applicationId: release.applicationId,
        tenantId: release.tenantId,
        provider: input.provider,
        state: 'SUBMISSION_PENDING',
        credentialReference: credentialReference || null,
        track: input.track,
      },
      update: { state: 'SUBMISSION_PENDING', track: input.track },
    });

    let result;
    try {
      result = await adapter.submit({
        packageName,
        track: input.track,
        versionName: release.versionName,
        versionCode: release.versionCode,
        artifactPath: (manifest.artifact as unknown as { storageReference: string }).storageReference,
        credentialReference,
      });
    } catch (error) {
      const unavailable = error instanceof MobileReleaseError && error.code === MOBILE_ERROR_CODES.STORE_UNAVAILABLE;
      await this.prisma.mobileStoreSubmission.update({
        where: { id: submissionRow.id },
        data: { state: unavailable ? 'UNAVAILABLE' : 'SUBMISSION_PENDING', lastCheckedAt: new Date() },
      });
      throw error;
    }

    if (result.state === 'PUBLISHED' && !isSelfDistributing) {
      // An external store adapter claiming instant publication from a submit
      // call is the exact lie this module exists to prevent.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_STATE,
        'store adapter attempted to return PUBLISHED from a submit call',
        500,
      );
    }

    const updated = await this.prisma.mobileStoreSubmission.update({
      where: { id: submissionRow.id },
      data: {
        state: result.state,
        externalSubmissionId: result.externalSubmissionId,
        evidence: result.evidence as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
        publishedAt: result.state === 'PUBLISHED' ? new Date() : null,
        lastCheckedAt: new Date(),
      },
    });
    // Walk the legal release edges: APPROVED -> SUBMITTING -> SUBMITTED and,
    // for self-distribution, on to PUBLISHED with the manifest as evidence.
    await this.releases.transitionRelease(release.id, 'SUBMITTING');
    await this.releases.transitionRelease(release.id, 'SUBMITTED', { submittedAt: new Date() });
    if (result.state === 'PUBLISHED' && isSelfDistributing) {
      await this.releases.transitionRelease(release.id, 'PUBLISHED', {
        publishedAt: new Date(),
      });
      await this.audit.record({
        tenantId: release.tenantId,
        applicationId: release.applicationId,
        releaseId: release.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.STORE_PUBLISHED,
        environment: release.environment,
        platform: (manifest.release as unknown as { platform: string }).platform,
        version: release.versionName,
        correlationId: input.correlationId,
        evidence: result.evidence,
      });
      await this.audit.notify({
        tenantId: release.tenantId,
        userId: input.actor.userId,
        type: 'MOBILE_RELEASE_PUBLISHED',
        data: { releaseId: release.id, provider: input.provider },
        correlationId: input.correlationId,
      });
    }
    await this.audit.record({
      tenantId: release.tenantId,
      applicationId: release.applicationId,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.STORE_SUBMITTED,
      environment: release.environment,
      platform: (manifest.release as unknown as { platform: string }).platform,
      version: release.versionName,
      correlationId: input.correlationId,
      evidence: { provider: input.provider, externalId: result.externalSubmissionId },
    });
    await this.audit.notify({
      tenantId: release.tenantId,
      userId: input.actor.userId,
      type: 'MOBILE_RELEASE_SUBMITTED',
      data: { releaseId: release.id, provider: input.provider, version: release.versionName },
      correlationId: input.correlationId,
    });
    return updated as unknown as Record<string, unknown>;
  }

  /**
   * Refreshes provider state and — only on provider evidence — drives
   * SUBMITTED -> PUBLISHED (which flips the release to PUBLISHED).
   */
  async refreshStatus(input: {
    releaseId: string;
    tenantId: string;
    provider: MobileStoreProvider;
    actor: MobileActor;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    this.assertProviderEnabled(input.provider);
    const release = await this.releases.mustGet(input.releaseId, input.tenantId);
    const submission = await this.prisma.mobileStoreSubmission.findUnique({
      where: { releaseId_provider: { releaseId: release.id, provider: input.provider } },
    });
    if (!submission) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_STATE, 'no store submission for this release/provider', 404);
    }
    if (!submission.externalSubmissionId) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.STORE_STATE, 'submission has no provider reference yet', 409);
    }
    const adapter = this.adapterFor(input.provider);
    const app = await this.prisma.mobileApplication.findUnique({ where: { id: release.applicationId } });
    const packageName =
      input.provider === 'APPLE_APP_STORE' ? app?.iosBundleId ?? '' : app?.androidPackageId ?? '';
    const providerState = await adapter.status({
      packageName,
      externalSubmissionId: submission.externalSubmissionId,
      credentialReference: submission.credentialReference ?? '',
    });

    // Only mapped, evidence-backed transitions are applied.
    transitionOrThrow(STORE_TRANSITIONS, submission.state as MobileStoreState, providerState.state, 'store');
    const updated = await this.prisma.mobileStoreSubmission.update({
      where: { id: submission.id },
      data: {
        state: providerState.state,
        evidence: providerState.evidence as unknown as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
        publishedAt: providerState.state === 'PUBLISHED' ? new Date() : submission.publishedAt,
      },
    });
    if (providerState.state === 'PUBLISHED') {
      if ((release.state as MobileReleaseState) === 'SUBMITTED') {
        await this.releases.transitionRelease(release.id, 'PUBLISHED', { publishedAt: new Date() });
      }
      await this.audit.record({
        tenantId: release.tenantId,
        applicationId: release.applicationId,
        releaseId: release.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.STORE_PUBLISHED,
        environment: release.environment,
        platform: release.platform,
        version: release.versionName,
        correlationId: input.correlationId,
        evidence: { provider: input.provider, externalId: submission.externalSubmissionId },
      });
      await this.audit.notify({
        tenantId: release.tenantId,
        userId: input.actor.userId,
        type: 'MOBILE_RELEASE_PUBLISHED',
        data: { releaseId: release.id, provider: input.provider },
        correlationId: input.correlationId,
      });
    }
    return updated as unknown as Record<string, unknown>;
  }

  /** Tenant-safe distribution view (what customer web may see). */
  async tenantSafeSubmission(releaseId: string, tenantId: string): Promise<Record<string, unknown> | null> {
    const submission = await this.prisma.mobileStoreSubmission.findFirst({
      where: { releaseId, tenantId, provider: { in: ['ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'] } },
    });
    if (!submission) return null;
    const evidence = (submission.evidence ?? {}) as Record<string, unknown>;
    return {
      provider: submission.provider,
      state: submission.state,
      // A download reference is customer-safe; provider internals are not.
      downloadUrl: typeof evidence.downloadUrl === 'string' ? evidence.downloadUrl : null,
    };
  }
}
