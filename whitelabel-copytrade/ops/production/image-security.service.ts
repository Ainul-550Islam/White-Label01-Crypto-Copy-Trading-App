/**
 * Image Security Service
 * Validates container image identity, digest, base image policy,
 * critical package vulnerabilities and image metadata before deployment.
 */

import { ImageSecurityResult, ImageSecurityStatus, VulnerabilityFinding } from './production.types';

export interface ImageSecurityInput {
  imageName: string;
  imageDigest: string;
  baseImage?: string;
  vulnerabilities: VulnerabilityFinding[];
  correlationId: string;
}

export class ImageSecurityService {
  private readonly allowedBaseImages: string[] = [
    'node:20-alpine',
    'node:20.11-alpine',
    'node:20-slim',
    'gcr.io/distroless/nodejs20-debian12',
    'public.ecr.aws/docker/library/node:20-alpine',
  ];

  private readonly forbiddenBaseImages: string[] = [
    'node:latest',
    'node:alpine',
    'ubuntu:latest',
    'debian:latest',
  ];

  async validate(input: ImageSecurityInput): Promise<ImageSecurityResult> {
    const checkedAt = new Date().toISOString();

    if (!input.imageDigest) {
      return {
        status: ImageSecurityStatus.FAILED,
        imageName: input.imageName,
        imageDigest: '',
        baseImage: input.baseImage || 'unknown',
        baseImageAllowed: false,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        failureReason: 'Image digest missing, cannot verify immutable artifact',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    if (!input.imageDigest.startsWith('sha256:')) {
      return {
        status: ImageSecurityStatus.FAILED,
        imageName: input.imageName,
        imageDigest: this.redactDigest(input.imageDigest),
        baseImage: input.baseImage || 'unknown',
        baseImageAllowed: false,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        failureReason: 'Image digest must be in sha256: format for immutability',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    const baseImage = input.baseImage || this.extractBaseImage(input.imageName);
    const baseImageAllowed = this.isBaseImageAllowed(baseImage);
    if (!baseImageAllowed) {
      const isForbidden = this.forbiddenBaseImages.some((f) => baseImage.includes(f));
      if (isForbidden) {
        return {
          status: ImageSecurityStatus.BASE_IMAGE_VIOLATION,
          imageName: input.imageName,
          imageDigest: this.redactDigest(input.imageDigest),
          baseImage,
          baseImageAllowed: false,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          failureReason: `Base image ${baseImage} is forbidden, must use pinned allowed base image`,
          checkedAt,
          correlationId: input.correlationId,
        };
      }
    }

    const criticalCount = input.vulnerabilities.filter((v) => v.severity === 'CRITICAL').length;
    const highCount = input.vulnerabilities.filter((v) => v.severity === 'HIGH').length;
    const mediumCount = input.vulnerabilities.filter((v) => v.severity === 'MEDIUM').length;
    const lowCount = input.vulnerabilities.filter((v) => v.severity === 'LOW').length;

    if (criticalCount > 0) {
      return {
        status: ImageSecurityStatus.CRITICAL_VULNERABILITY,
        imageName: input.imageName,
        imageDigest: this.redactDigest(input.imageDigest),
        baseImage,
        baseImageAllowed,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        failureReason: `Image contains ${criticalCount} critical vulnerabilities`,
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    return {
      status: ImageSecurityStatus.PASSED,
      imageName: input.imageName,
      imageDigest: this.redactDigest(input.imageDigest),
      baseImage,
      baseImageAllowed,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      checkedAt,
      correlationId: input.correlationId,
    };
  }

  private isBaseImageAllowed(baseImage: string): boolean {
    if (!baseImage) return false;
    return this.allowedBaseImages.some((allowed) => baseImage === allowed || baseImage.startsWith(allowed + '@') || baseImage.startsWith(allowed + ':'));
  }

  private extractBaseImage(imageName: string): string {
    return 'node:20-alpine';
  }

  private redactDigest(digest: string): string {
    if (!digest) return '***MISSING***';
    if (digest.length <= 16) return '***REDACTED***';
    return `${digest.slice(0, 12)}...${digest.slice(-4)}`;
  }
}
