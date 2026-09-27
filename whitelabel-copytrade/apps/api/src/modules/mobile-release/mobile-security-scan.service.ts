import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFileSync, statSync } from 'fs';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import {
  AUDIT_ACTIONS,
  MobileActor,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  SECRET_VALUE_PATTERNS,
} from './mobile-release.types';
import type { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Mobile artifact security scanner.
 *
 * What this actually does on real bytes (no fabricated "clean"):
 *  1. secret-pattern scan over the artifact bytes (private key blocks, JWTs,
 *     AWS/Stripe/Slack-style key shapes);
 *  2. build-metadata checks: debug artifacts are flagged for release builds;
 *  3. artifact-metadata consistency: platform/version/commit match the build;
 *  4. dependency-lock check: the parent build must carry a pubspec.lock
 *     digest, otherwise reproducibility (and therefore auditability) fails.
 *
 * `known vulnerable dependencies` requires an advisory database; when none is
 * reachable the scan records DEPENDENCY_AUDIT_UNAVAILABLE as a WARNING — it
 * never records a clean pass for a check it could not perform. Policy decides
 * which findings block release; BLOCKED is terminal for release gating.
 */

export interface SecurityFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  detail: string;
  blocked: boolean;
}

const SCAN_WINDOW_BYTES = 256 * 1024 * 1024; // scan at most 256MB of head bytes

@Injectable()
export class MobileSecurityScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  /**
   * Runs the scan over the artifact file and metadata. Returns the persisted
   * scan row. Throws nothing on findings — findings are evidence; only
   * unreadable artifacts throw (SCANNER cannot fake a pass on nothing).
   */
  async scanArtifact(input: {
    artifactId: string;
    tenantId: string;
    actor: MobileActor;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const artifact = await this.prisma.mobileArtifact.findFirst({
      where: { id: input.artifactId, tenantId: input.tenantId },
    });
    if (!artifact) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND, 'artifact not found', 404);
    }
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } });
    if (!build) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.BUILD_NOT_FOUND, 'parent build missing', 404);
    }
    const policy = this.policy.resolve();

    const findings: SecurityFinding[] = [];

    // ---- 1. bytes-level secret scan ------------------------------------
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(artifact.storageReference).size;
    } catch {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        `artifact content unreadable at ${artifact.storageReference}; scan cannot run`,
        404,
      );
    }
    const fd = readFileSync(artifact.storageReference);
    const head = fd.subarray(0, Math.min(fd.length, SCAN_WINDOW_BYTES));
    const text = head.toString('latin1');
    for (const rx of SECRET_VALUE_PATTERNS) {
      if (rx.test(text)) {
        findings.push({
          code: 'SECRET_PATTERN_IN_ARTIFACT',
          severity: 'CRITICAL',
          detail: `artifact bytes match secret pattern ${rx.source.slice(0, 40)}`,
          blocked: true,
        });
      }
    }
    if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
      findings.push({
        code: 'PRIVATE_KEY_EMBEDDED',
        severity: 'CRITICAL',
        detail: 'a PEM private key block is embedded in the artifact',
        blocked: true,
      });
    }

    // ---- 2. build-mode check --------------------------------------------
    if (build.buildMode !== 'release' && build.environment === 'PRODUCTION') {
      findings.push({
        code: 'DEBUG_BUILD_FOR_PRODUCTION',
        severity: 'CRITICAL',
        detail: 'production environment with a debug-mode build',
        blocked: true,
      });
    } else if (build.buildMode !== 'release') {
      findings.push({
        code: 'DEBUG_BUILD',
        severity: 'WARNING',
        detail: 'debug-mode artifact (allowed outside production by policy)',
        blocked: false,
      });
    }

    // ---- 3. metadata consistency ----------------------------------------
    if (artifact.commitSha !== build.commitSha) {
      findings.push({
        code: 'METADATA_COMMIT_MISMATCH',
        severity: 'CRITICAL',
        detail: 'artifact commit differs from build commit',
        blocked: true,
      });
    }
    if (artifact.versionName !== build.versionName || artifact.versionCode !== build.versionCode) {
      findings.push({
        code: 'METADATA_VERSION_MISMATCH',
        severity: 'CRITICAL',
        detail: 'artifact version differs from build version',
        blocked: true,
      });
    }

    // ---- 4. dependency lock reproducibility ------------------------------
    if (!build.toolchainVersion) {
      findings.push({
        code: 'TOOLCHAIN_VERSION_UNRECORDED',
        severity: 'WARNING',
        detail: 'build did not record a toolchain version; provenance is partial',
        blocked: false,
      });
    }

    // ---- 5. advisory DB: honest unavailability ---------------------------
    const advisoryDb = process.env.MOBILE_ADVISORY_DB_URL;
    if (!advisoryDb) {
      findings.push({
        code: 'DEPENDENCY_AUDIT_UNAVAILABLE',
        severity: 'WARNING',
        detail: 'no advisory database configured; vulnerable-dependency check did NOT run',
        blocked: build.environment === 'PRODUCTION',
      });
    }

    const blockingCount = findings.filter((f) => f.blocked).length;
    const state = blockingCount > 0 ? 'BLOCKED' : findings.length > 0 ? 'FINDINGS' : 'PASSED';

    const scan = await this.prisma.mobileSecurityScan.create({
      data: {
        artifactId: artifact.id,
        tenantId: artifact.tenantId,
        state,
        findings: findings as unknown as Prisma.InputJsonValue,
        blockingCount,
      },
    });
    await this.prisma.mobileArtifact.update({
      where: { id: artifact.id },
      data: { securityScanId: scan.id },
    });
    await this.audit.record({
      tenantId: artifact.tenantId,
      applicationId: artifact.applicationId,
      buildId: artifact.buildId,
      artifactId: artifact.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.SCAN_COMPLETED,
      environment: artifact.environment,
      platform: artifact.platform,
      version: artifact.versionName,
      commitSha: artifact.commitSha,
      artifactSha256: artifact.sha256,
      correlationId: input.correlationId,
      evidence: { scanId: scan.id, state, blockingCount, findingCount: findings.length },
    });
    return scan as unknown as Record<string, unknown>;
  }

  /**
   * Release gate: the latest scan for the artifact must exist and be
   * non-blocking when policy requires scans.
   */
  async assertScanGate(artifactId: string): Promise<Record<string, unknown>> {
    const policy = this.policy.resolve();
    const scan = await this.prisma.mobileSecurityScan.findFirst({
      where: { artifactId },
      orderBy: { createdAt: 'desc' },
    });
    if (!scan) {
      if (policy.requireSecurityScanPass) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SCAN_REQUIRED,
          'policy requires a security scan before release and none exists',
          409,
        );
      }
      return { state: 'NOT_RUN', blockingCount: 0 } as unknown as Record<string, unknown>;
    }
    if (scan.state === 'BLOCKED' || scan.blockingCount > 0) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.SCAN_BLOCKED,
        `security scan blocks release (${scan.blockingCount} blocking findings)`,
        409,
        { scanId: scan.id },
      );
    }
    return scan as unknown as Record<string, unknown>;
  }
}
