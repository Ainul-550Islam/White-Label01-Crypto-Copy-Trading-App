import { Inject, Injectable, Optional } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileEnvReader, MOBILE_RELEASE_ENV, MobileReleasePolicyService } from './mobile-release-policy.service';
import { sha256File } from './mobile-artifact.service';
import {
  AUDIT_ACTIONS,
  looksLikeSecret,
  MobileActor,
  MobileEnvironment,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  MobileSigningState,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Signing adapter port. Implementations talk to REAL signing infrastructure
 * (a CI signing host, a KMS-backed keystore service, fastlane match, ...).
 * The adapter receives secret REFERENCES resolved out-of-band; the platform
 * database never sees key material and neither does this service.
 */
export interface SigningResult {
  /** Path to the signed artifact (may equal the input for in-place signers). */
  signedArtifactPath: string;
  /** Opaque reference recorded for evidence (key name, cert serial, host id). */
  signingReference: string;
  /** The adapter's own verification of the new signature. */
  signatureVerified: boolean;
  /** Recomputed digest of the signed artifact. */
  signedSha256: string;
}

/** DI token for the signing adapter; absent -> UnavailableSigningAdapter. */
export const MOBILE_SIGNING_ADAPTER = Symbol('MOBILE_SIGNING_ADAPTER');

export interface MobileSigningAdapter {
  readonly name: string;
  isAvailable(input: { platform: string; environment: MobileEnvironment }): boolean;
  sign(input: {
    artifactPath: string;
    platform: string;
    environment: MobileEnvironment;
    buildMode: string;
    credentialReference: string;
  }): Promise<SigningResult>;
}

/**
 * The default adapter: this platform ships with NO signing host. It reports
 * availability honestly and refuses — SIGNING_UNAVAILABLE — anything else.
 */
@Injectable()
export class UnavailableSigningAdapter implements MobileSigningAdapter {
  readonly name = 'unavailable';

  isAvailable(): boolean {
    return false;
  }

  async sign(): Promise<SigningResult> {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE,
      'no signing infrastructure configured; configure MOBILE_SIGNING_ADAPTER and its credential reference',
      503,
    );
  }
}

export interface SignArtifactOutcome {
  signingState: MobileSigningState;
  signingReference: string | null;
  signatureVerified: boolean;
  signedSha256: string | null;
  failureCode: string | null;
}

@Injectable()
export class MobileSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly audit: MobileReleaseAuditService,
    @Optional()
    @Inject(MOBILE_SIGNING_ADAPTER)
    private readonly adapter: MobileSigningAdapter = new UnavailableSigningAdapter(),
    @Inject(MOBILE_RELEASE_ENV) private readonly env: MobileEnvReader = { get: () => undefined },
  ) {}

  private credentialReference(tenantId: string, platform: string, environment: MobileEnvironment): string | null {
    // Only a REFERENCE is read from configuration; the material itself is
    // resolved by the signing host from the secret system.
    const suffix = `${platform}_${environment}`.toUpperCase();
    const explicit = this.env.get(`MOBILE_SIGNING_CREDENTIAL_REF_${suffix}`);
    if (explicit) return explicit;
    return `mobile-signing/${tenantId}/${platform.toLowerCase()}/${environment.toLowerCase()}`;
  }

  /**
   * Attempts signing for one artifact. Every terminal state is honest:
   *  - SIGNING_UNAVAILABLE when the adapter/credential is not usable;
   *  - FAILED when signing ran but its own verification did not pass;
   *  - SIGNED only when the adapter returns signatureVerified=true and a
   *    recomputed digest of the signed artifact matches what it reported.
   */
  async signArtifact(input: {
    artifactId: string;
    tenantId: string;
    actor: MobileActor;
    correlationId: string;
  }): Promise<SignArtifactOutcome> {
    const artifact = await this.prisma.mobileArtifact.findFirst({
      where: { id: input.artifactId, tenantId: input.tenantId },
    });
    if (!artifact) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND, 'artifact not found', 404);
    }
    const reference = this.credentialReference(input.tenantId, artifact.platform, artifact.environment as MobileEnvironment);

    await this.audit.record({
      tenantId: artifact.tenantId,
      applicationId: artifact.applicationId,
      buildId: artifact.buildId,
      artifactId: artifact.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.SIGNING_ATTEMPTED,
      environment: artifact.environment,
      platform: artifact.platform,
      version: artifact.versionName,
      commitSha: artifact.commitSha,
      artifactSha256: artifact.sha256,
      correlationId: input.correlationId,
      evidence: { adapter: this.adapter.name, credentialReferencePresent: Boolean(reference) },
    });

    const usable =
      this.adapter.isAvailable({
        platform: artifact.platform,
        environment: artifact.environment as MobileEnvironment,
      }) && Boolean(reference);

    if (!usable) {
      await this.prisma.mobileArtifact.update({
        where: { id: artifact.id },
        data: { signingState: 'SIGNING_UNAVAILABLE' },
      });
      await this.audit.record({
        tenantId: artifact.tenantId,
        applicationId: artifact.applicationId,
        buildId: artifact.buildId,
        artifactId: artifact.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.SIGNING_FAILED,
        environment: artifact.environment,
        platform: artifact.platform,
        version: artifact.versionName,
        commitSha: artifact.commitSha,
        artifactSha256: artifact.sha256,
        correlationId: input.correlationId,
        evidence: { failureCode: MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE },
      });
      return {
        signingState: 'SIGNING_UNAVAILABLE',
        signingReference: null,
        signatureVerified: false,
        signedSha256: null,
        failureCode: MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE,
      };
    }

    try {
      const result = await this.adapter.sign({
        artifactPath: artifact.storageReference,
        platform: artifact.platform,
        environment: artifact.environment as MobileEnvironment,
        buildMode: 'release',
        credentialReference: reference!,
      });

      // Never persist or log key material: the reference must be an opaque,
      // non-secret-shaped locator.
      if (looksLikeSecret('signingReference', result.signingReference)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SIGNING_REJECTED,
          'adapter returned secret-shaped signing reference; refusing to persist it',
          400,
        );
      }

      const digest = await sha256File(result.signedArtifactPath);
      const verified = result.signatureVerified && digest.sha256 === result.signedSha256;

      if (!verified) {
        await this.prisma.mobileArtifact.update({
          where: { id: artifact.id },
          data: { signingState: 'FAILED' },
        });
        await this.audit.record({
          tenantId: artifact.tenantId,
          applicationId: artifact.applicationId,
          buildId: artifact.buildId,
          artifactId: artifact.id,
          actor: input.actor,
          action: AUDIT_ACTIONS.SIGNING_FAILED,
          environment: artifact.environment,
          platform: artifact.platform,
          version: artifact.versionName,
          commitSha: artifact.commitSha,
          artifactSha256: digest.sha256,
          correlationId: input.correlationId,
          evidence: { failureCode: MOBILE_ERROR_CODES.SIGNATURE_MISMATCH },
        });
        return {
          signingState: 'FAILED',
          signingReference: null,
          signatureVerified: false,
          signedSha256: digest.sha256,
          failureCode: MOBILE_ERROR_CODES.SIGNATURE_MISMATCH,
        };
      }

      await this.prisma.mobileArtifact.update({
        where: { id: artifact.id },
        data: {
          signingState: 'SIGNED',
          signingReference: result.signingReference,
          signatureVerified: true,
        },
      });
      await this.audit.record({
        tenantId: artifact.tenantId,
        applicationId: artifact.applicationId,
        buildId: artifact.buildId,
        artifactId: artifact.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.SIGNING_COMPLETED,
        environment: artifact.environment,
        platform: artifact.platform,
        version: artifact.versionName,
        commitSha: artifact.commitSha,
        artifactSha256: digest.sha256,
        correlationId: input.correlationId,
        evidence: { adapter: this.adapter.name, signatureVerified: true },
      });
      return {
        signingState: 'SIGNED',
        signingReference: result.signingReference,
        signatureVerified: true,
        signedSha256: digest.sha256,
        failureCode: null,
      };
    } catch (error) {
      const failure =
        error instanceof MobileReleaseError && error.code === MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE
          ? 'SIGNING_UNAVAILABLE'
          : 'SIGNING_FAILED';
      await this.prisma.mobileArtifact.update({
        where: { id: artifact.id },
        data: { signingState: failure === 'SIGNING_UNAVAILABLE' ? 'SIGNING_UNAVAILABLE' : 'FAILED' },
      });
      await this.audit.record({
        tenantId: artifact.tenantId,
        applicationId: artifact.applicationId,
        buildId: artifact.buildId,
        artifactId: artifact.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.SIGNING_FAILED,
        environment: artifact.environment,
        platform: artifact.platform,
        version: artifact.versionName,
        commitSha: artifact.commitSha,
        artifactSha256: artifact.sha256,
        correlationId: input.correlationId,
        evidence: { failureCode: failure },
      });
      return {
        signingState: failure === 'SIGNING_UNAVAILABLE' ? 'SIGNING_UNAVAILABLE' : 'FAILED',
        signingReference: null,
        signatureVerified: false,
        signedSha256: null,
        failureCode: failure,
      };
    }
  }

  /** Whether the policy demands a verified signature for this environment. */
  signingRequiredFor(environment: MobileEnvironment): boolean {
    return this.policy.resolve().signingRequiredEnvironments.includes(environment);
  }
}
