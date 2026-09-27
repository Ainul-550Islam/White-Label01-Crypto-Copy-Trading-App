/**
 * SBOM Service
 * Generates or validates Software Bill of Materials metadata for release artifacts
 * and preserves exact artifact/release association.
 */

import * as crypto from 'crypto';
import { SbomResult, SbomStatus } from './production.types';

export interface SbomInput {
  releaseId: string;
  artifactDigest: string;
  packages: Array<{ name: string; version: string; type: string; license?: string }>;
  correlationId: string;
}

export class SbomService {
  generate(input: SbomInput): SbomResult {
    const sbomContent = JSON.stringify({
      releaseId: input.releaseId,
      artifactDigest: input.artifactDigest,
      packages: [...input.packages].sort((a, b) => a.name.localeCompare(b.name)),
      generatedAt: new Date().toISOString(),
      correlationId: input.correlationId,
    });

    const sbomDigest = crypto.createHash('sha256').update(sbomContent).digest('hex');

    return {
      status: SbomStatus.GENERATED,
      releaseId: input.releaseId,
      artifactDigest: input.artifactDigest,
      sbomDigest,
      packageCount: input.packages.length,
      artifactAssociated: true,
      generatedAt: new Date().toISOString(),
      correlationId: input.correlationId,
    };
  }

  validate(
    sbomResult: SbomResult,
    expectedArtifactDigest: string,
    correlationId: string,
  ): { valid: boolean; status: SbomStatus; reason?: string } {
    if (!sbomResult) {
      return { valid: false, status: SbomStatus.MISSING, reason: 'SBOM missing' };
    }

    if (sbomResult.artifactDigest !== expectedArtifactDigest) {
      return {
        valid: false,
        status: SbomStatus.MISMATCH,
        reason: `SBOM artifact association mismatch: SBOM for ${this.redactDigest(sbomResult.artifactDigest)} but expected ${this.redactDigest(expectedArtifactDigest)}`,
      };
    }

    if (!sbomResult.sbomDigest) {
      return { valid: false, status: SbomStatus.MISSING, reason: 'SBOM digest missing' };
    }

    if (!sbomResult.artifactAssociated) {
      return { valid: false, status: SbomStatus.MISMATCH, reason: 'SBOM not associated with artifact' };
    }

    return { valid: true, status: SbomStatus.VERIFIED };
  }

  verifyAssociation(sbom: SbomResult, releaseId: string, artifactDigest: string): boolean {
    return sbom.releaseId === releaseId && sbom.artifactDigest === artifactDigest && sbom.artifactAssociated;
  }

  private redactDigest(digest: string): string {
    if (!digest) return '***MISSING***';
    if (digest.length <= 12) return '***REDACTED***';
    return `${digest.slice(0, 8)}...${digest.slice(-4)}`;
  }
}
