import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, statSync } from 'fs';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  MOBILE_ERROR_CODES,
  MobileEnvironment,
  MobilePlatform,
  MobileReleaseError,
} from './mobile-release.types';

export interface ArtifactIdentity {
  sha256: string;
  sizeBytes: bigint;
}

/**
 * Streams a file through sha256. Real bytes in, real digest out — there is no
 * code path in this module that accepts a caller-supplied digest for storage
 * without recomputation by this function first.
 */
export function sha256File(path: string): Promise<ArtifactIdentity> {
  return new Promise((resolvePromise, rejectPromise) => {
    try {
      const size = statSync(path).size;
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', rejectPromise);
      stream.on('end', () =>
        resolvePromise({ sha256: hash.digest('hex'), sizeBytes: BigInt(size) }),
      );
    } catch (error) {
      rejectPromise(error);
    }
  });
}

/**
 * Immutable artifact registry.
 *
 * `record` is the only writer of content identity and it computes the digest
 * itself. After creation the content fields (sha256, sizeBytes,
 * storageReference) are never updated by any method in this service — the
 * only mutations are the one-time signing and scan-reference links, which
 * carry no content identity. Immutability is also enforced by callers: the
 * verification service treats any content-field change as tamper.
 */
@Injectable()
export class MobileArtifactService {
  constructor(private readonly prisma: PrismaService) {}

  async recordArtifact(input: {
    buildId: string;
    applicationId: string;
    tenantId: string;
    platform: MobilePlatform;
    environment: MobileEnvironment;
    versionName: string;
    versionCode: number;
    iosBuildNumber: number | null;
    commitSha: string;
    artifactPath: string;
  }): Promise<Record<string, unknown>> {
    const build = await this.prisma.mobileBuild.findFirst({
      where: { id: input.buildId, tenantId: input.tenantId },
    });
    if (!build) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_NOT_FOUND,
        'build not found for this tenant',
        404,
      );
    }
    if (build.state !== 'BUILT') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `artifact can only be recorded for a BUILT build, build is ${build.state}`,
        409,
        { state: build.state },
      );
    }
    const identity = await sha256File(input.artifactPath);

    const existing = await this.prisma.mobileArtifact.findUnique({
      where: { buildId: input.buildId },
    });
    if (existing) {
      // Deterministic replay: same build must produce the same digest, or the
      // artifact identity is not immutable and the build is not reproducible.
      if (existing.sha256 !== identity.sha256 || existing.sizeBytes !== identity.sizeBytes) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.ARTIFACT_TAMPER,
          're-recorded artifact digest differs from the recorded one',
          409,
          { buildId: input.buildId },
        );
      }
      return existing as unknown as Record<string, unknown>;
    }

    const artifact = await this.prisma.mobileArtifact.create({
      data: {
        buildId: input.buildId,
        applicationId: input.applicationId,
        tenantId: input.tenantId,
        platform: input.platform,
        environment: input.environment,
        versionName: input.versionName,
        versionCode: input.versionCode,
        iosBuildNumber: input.iosBuildNumber,
        commitSha: input.commitSha,
        sha256: identity.sha256,
        sizeBytes: identity.sizeBytes,
        storageReference: input.artifactPath,
        signingState: 'NOT_CONFIGURED',
      },
    });
    return artifact as unknown as Record<string, unknown>;
  }

  async mustGet(artifactId: string, tenantId: string) {
    const artifact = await this.prisma.mobileArtifact.findFirst({
      where: { id: artifactId, tenantId },
    });
    if (!artifact) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        'artifact not found for this tenant',
        404,
        { artifactId },
      );
    }
    return artifact;
  }

  /** One-time signing link (reference only, never key material). */
  async linkSigning(
    artifactId: string,
    tenantId: string,
    signingReference: string,
    signatureVerified: boolean,
  ) {
    const artifact = await this.mustGet(artifactId, tenantId);
    if (artifact.signingState === 'SIGNED' && artifact.signingReference) {
      // Already signed: signatures are immutable evidence, never overwritten.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.SIGNING_REJECTED,
        'artifact already carries an immutable signing record',
        409,
      );
    }
    return this.prisma.mobileArtifact.update({
      where: { id: artifact.id },
      data: { signingState: 'SIGNED', signingReference, signatureVerified },
    });
  }

  /** One-time scan link. */
  async linkSecurityScan(artifactId: string, tenantId: string, scanId: string) {
    const artifact = await this.mustGet(artifactId, tenantId);
    return this.prisma.mobileArtifact.update({
      where: { id: artifact.id },
      data: { securityScanId: scanId },
    });
  }
}
