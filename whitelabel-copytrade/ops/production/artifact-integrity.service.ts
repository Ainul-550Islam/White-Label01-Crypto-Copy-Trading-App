/**
 * Artifact Integrity Service
 * Verifies release artifact checksums/digests/signatures before deployment
 * and rejects artifacts that do not match the approved release manifest.
 */

import * as crypto from 'crypto';
import { ArtifactIntegrityResult, ArtifactIntegrityStatus, ReleaseManifest } from './production.types';

export interface ArtifactToVerify {
  releaseId: string;
  expectedDigest: string;
  actualDigest: string;
  expectedChecksum: string;
  actualChecksum: string;
  signature?: string;
  expectedSignature?: string;
  manifest: ReleaseManifest;
  imageName: string;
  imageDigest: string;
}

export class ArtifactIntegrityService {
  verify(
    artifact: ArtifactToVerify,
    correlationId: string,
  ): ArtifactIntegrityResult {
    const checkedAt = new Date().toISOString();

    if (!artifact.actualDigest) {
      return {
        status: ArtifactIntegrityStatus.NOT_FOUND,
        releaseId: artifact.releaseId,
        expectedDigest: artifact.expectedDigest,
        actualDigest: '',
        expectedSignature: artifact.expectedSignature,
        manifestMatch: false,
        failureReason: 'Actual digest missing, artifact not found',
        checkedAt,
        correlationId,
      };
    }

    if (artifact.expectedDigest !== artifact.actualDigest) {
      return {
        status: ArtifactIntegrityStatus.DIGEST_MISMATCH,
        releaseId: artifact.releaseId,
        expectedDigest: artifact.expectedDigest,
        actualDigest: artifact.actualDigest,
        expectedSignature: artifact.expectedSignature,
        signatureValid: undefined,
        manifestMatch: false,
        failureReason: `Digest mismatch: expected ${this.redactDigest(artifact.expectedDigest)} got ${this.redactDigest(artifact.actualDigest)}`,
        checkedAt,
        correlationId,
      };
    }

    if (artifact.expectedChecksum !== artifact.actualChecksum) {
      return {
        status: ArtifactIntegrityStatus.MANIFEST_MISMATCH,
        releaseId: artifact.releaseId,
        expectedDigest: artifact.expectedDigest,
        actualDigest: artifact.actualDigest,
        expectedSignature: artifact.expectedSignature,
        manifestMatch: false,
        failureReason: 'Checksum mismatch between manifest and artifact',
        checkedAt,
        correlationId,
      };
    }

    if (artifact.manifest.backend.imageDigest !== artifact.imageDigest) {
      return {
        status: ArtifactIntegrityStatus.MANIFEST_MISMATCH,
        releaseId: artifact.releaseId,
        expectedDigest: artifact.expectedDigest,
        actualDigest: artifact.actualDigest,
        expectedSignature: artifact.expectedSignature,
        manifestMatch: false,
        failureReason: `Image digest in manifest ${this.redactDigest(artifact.manifest.backend.imageDigest)} does not match deployed image ${this.redactDigest(artifact.imageDigest)}`,
        checkedAt,
        correlationId,
      };
    }

    if (artifact.expectedSignature) {
      const signatureValid = this.verifySignature(artifact.actualDigest, artifact.signature, artifact.expectedSignature);
      if (!signatureValid) {
        return {
          status: ArtifactIntegrityStatus.SIGNATURE_INVALID,
          releaseId: artifact.releaseId,
          expectedDigest: artifact.expectedDigest,
          actualDigest: artifact.actualDigest,
          expectedSignature: artifact.expectedSignature,
          signatureValid: false,
          manifestMatch: false,
          failureReason: 'Artifact signature invalid',
          checkedAt,
          correlationId,
        };
      }
      return {
        status: ArtifactIntegrityStatus.VERIFIED,
        releaseId: artifact.releaseId,
        expectedDigest: artifact.expectedDigest,
        actualDigest: artifact.actualDigest,
        expectedSignature: artifact.expectedSignature,
        signatureValid: true,
        manifestMatch: true,
        checkedAt,
        correlationId,
      };
    }

    return {
      status: ArtifactIntegrityStatus.VERIFIED,
      releaseId: artifact.releaseId,
      expectedDigest: artifact.expectedDigest,
      actualDigest: artifact.actualDigest,
      expectedSignature: artifact.expectedSignature,
      manifestMatch: true,
      checkedAt,
      correlationId,
    };
  }

  calculateDigest(content: Buffer | string): string {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  calculateImageDigest(imageManifest: string): string {
    return `sha256:${crypto.createHash('sha256').update(imageManifest).digest('hex')}`;
  }

  private verifySignature(digest: string, signature?: string, expectedSignature?: string): boolean {
    if (!signature || !expectedSignature) return false;
    if (signature.length === 0 || expectedSignature.length === 0) return false;
    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);
      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  private redactDigest(digest: string): string {
    if (!digest) return '***MISSING***';
    if (digest.length <= 12) return '***REDACTED***';
    return `${digest.slice(0, 8)}...${digest.slice(-4)}`;
  }

  verifyManifestAssociation(manifest: ReleaseManifest, artifactDigest: string): boolean {
    return manifest.artifacts.artifactChecksum === artifactDigest ||
           manifest.backend.imageDigest === artifactDigest ||
           manifest.artifacts.artifactChecksum === this.calculateDigest(artifactDigest);
  }
}
