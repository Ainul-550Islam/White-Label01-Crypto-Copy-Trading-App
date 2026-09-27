import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileBuildService } from './mobile-build.service';
import { sha256File } from './mobile-artifact.service';
import {
  AUDIT_ACTIONS,
  MOBILE_ERROR_CODES,
  MobileReleaseError,
  MobileSigningState,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';
import type { MobileActor } from './mobile-release.types';

/**
 * Re-derives artifact truth from bytes.
 *
 * The release gate trusts NOTHING recorded about an artifact until this
 * service has: re-read the file, recomputed the sha256 (constant-time
 * compare), re-checked size, and confirmed every identity field matches the
 * build that produced it. Any disagreement is tamper, reported and audited as
 * tamper — an altered artifact can never enter the release state machine.
 */
@Injectable()
export class MobileArtifactVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builds: MobileBuildService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  private sameDigest(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Full verification pass. Returns the verified artifact row (state already
   * moved to VERIFIED on the build). Throws ARTIFACT_TAMPER on any digest or
   * size mismatch, ARTIFACT_MISMATCH on identity-field disagreement, and
   * ARTIFACT_NOT_FOUND when the storage reference no longer resolves.
   */
  async verify(input: {
    artifactId: string;
    tenantId: string;
    actor: MobileActor;
    correlationId: string;
    /** Signing policy: environments where an unverified signature is fatal. */
    signingRequired: boolean;
  }): Promise<Record<string, unknown>> {
    const artifact = await this.prisma.mobileArtifact.findFirst({
      where: { id: input.artifactId, tenantId: input.tenantId },
    });
    if (!artifact) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        'artifact not found for this tenant',
        404,
      );
    }
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } });
    if (!build) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.BUILD_NOT_FOUND, 'parent build vanished', 404);
    }

    let identity;
    try {
      identity = await sha256File(artifact.storageReference);
    } catch {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `artifact content unavailable at ${artifact.storageReference}`,
        404,
      );
    }

    if (!this.sameDigest(identity.sha256, artifact.sha256) || identity.sizeBytes !== artifact.sizeBytes) {
      await this.audit.record({
        tenantId: artifact.tenantId,
        applicationId: artifact.applicationId,
        buildId: build.id,
        artifactId: artifact.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.ARTIFACT_TAMPER,
        environment: artifact.environment,
        platform: artifact.platform,
        version: artifact.versionName,
        commitSha: artifact.commitSha,
        artifactSha256: identity.sha256,
        correlationId: input.correlationId,
        evidence: {
          recordedSha256: artifact.sha256,
          recomputedSha256: identity.sha256,
          recordedSize: artifact.sizeBytes.toString(),
          recomputedSize: identity.sizeBytes.toString(),
        },
      });
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_TAMPER,
        'artifact bytes do not match the recorded immutable identity',
        409,
        { artifactId: artifact.id },
      );
    }

    // Identity consistency between artifact and its build.
    const mismatches: string[] = [];
    if (artifact.commitSha !== build.commitSha) mismatches.push('commitSha');
    if (artifact.versionName !== build.versionName) mismatches.push('versionName');
    if (artifact.versionCode !== build.versionCode) mismatches.push('versionCode');
    if (artifact.platform !== build.platform) mismatches.push('platform');
    if (artifact.environment !== build.environment) mismatches.push('environment');
    if (mismatches.length > 0) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_MISMATCH,
        `artifact/build metadata mismatch on: ${mismatches.join(', ')}`,
        409,
        { mismatches },
      );
    }

    // Signing gate.
    if (input.signingRequired) {
      if (artifact.signingState !== 'SIGNED' || !artifact.signatureVerified) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SIGNING_REQUIRED,
          'policy requires a verified signature before release',
          409,
          { signingState: artifact.signingState },
        );
      }
    } else if (artifact.signingState === 'FAILED' || artifact.signingState === 'SIGNING_UNAVAILABLE') {
      // Even where signing is optional, a FAILED signing attempt is evidence
      // of an unsafe artifact, not a neutral state.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.SIGNATURE_MISMATCH,
        `artifact carries a failed signing state: ${artifact.signingState}`,
        409,
      );
    }

    await this.builds.markVerified(build.id);
    await this.audit.record({
      tenantId: artifact.tenantId,
      applicationId: artifact.applicationId,
      buildId: build.id,
      artifactId: artifact.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.ARTIFACT_VERIFIED,
      environment: artifact.environment,
      platform: artifact.platform,
      version: artifact.versionName,
      commitSha: artifact.commitSha,
      artifactSha256: artifact.sha256,
      correlationId: input.correlationId,
      evidence: { signingState: artifact.signingState as MobileSigningState },
    });
    return artifact as unknown as Record<string, unknown>;
  }
}
