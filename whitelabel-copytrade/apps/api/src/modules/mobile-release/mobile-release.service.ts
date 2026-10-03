import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileSecurityScanService } from './mobile-security-scan.service';
import {
  AUDIT_ACTIONS,
  idempotencyKey,
  MobileActor,
  MobileEnvironment,
  MobilePlatform,
  MobileReleaseError,
  MobileReleaseState,
  MOBILE_ERROR_CODES,
  RELEASE_TRANSITIONS,
  transitionOrThrow,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';

export interface CreateReleaseInput {
  applicationId: string;
  tenantId: string;
  artifactId: string;
  releaseNotes?: string | null;
  actor: MobileActor;
  correlationId: string;
}

/**
 * The release state machine.
 *
 * A release links EXACTLY one verified artifact per platform+environment:
 * artifactId is unique, and creation refuses anything that has not passed the
 * verification and (policy-required) scan gates. Version identity is unique
 * per app+platform+environment for every non-rejected release — a published
 * version cannot be silently replaced. SUBMITTED != PUBLISHED and
 * PUBLISHED != ROLLED_OUT are structural: the transitions exist only from the
 * mapped predecessor states and only the store/rollout services drive them.
 */
@Injectable()
export class MobileReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly scans: MobileSecurityScanService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  async mustGet(releaseId: string, tenantId: string | null) {
    const release =
      tenantId === null
        ? await this.prisma.mobileRelease.findUnique({ where: { id: releaseId } })
        : await this.prisma.mobileRelease.findFirst({ where: { id: releaseId, tenantId } });
    if (!release) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.RELEASE_NOT_FOUND,
        'release not found',
        404,
        { releaseId },
      );
    }
    return release;
  }

  /**
   * Creates a DRAFT release from a VERIFIED artifact. Idempotent by
   * (application, platform, environment, version, code): the same identity
   * replays the same release instead of minting a duplicate.
   */
  async createRelease(input: CreateReleaseInput): Promise<{ release: Record<string, unknown>; replayed: boolean }> {
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.APP_NOT_FOUND,
        'mobile application not found for this tenant',
        404,
      );
    }
    const artifact = await this.prisma.mobileArtifact.findFirst({
      where: { id: input.artifactId, tenantId: input.tenantId, applicationId: app.id },
    });
    if (!artifact) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        'artifact does not belong to this application/tenant',
        404,
      );
    }
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } });
    if (!build || build.state !== 'VERIFIED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.RELEASE_NOT_VERIFIED,
        `release requires a VERIFIED artifact; build state is ${build?.state ?? 'MISSING'}`,
        409,
        { buildState: build?.state ?? null },
      );
    }
    if (build.state === 'VERIFIED' && !build.finishedAt) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.RELEASE_NOT_VERIFIED,
        'verified build has no completion evidence',
        409,
      );
    }

    // Security gate (policy may make this fatal).
    await this.scans.assertScanGate(artifact.id);

    // Signing gate for environments that require it.
    if (this.policy.resolve().signingRequiredEnvironments.includes(artifact.environment as MobileEnvironment)) {
      if (artifact.signingState !== 'SIGNED' || !artifact.signatureVerified) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SIGNING_REQUIRED,
          'policy requires a verified signature before release',
          409,
          { signingState: artifact.signingState },
        );
      }
    }

    // Version uniqueness: any prior non-rejected release with the same
    // version identity for this app+platform+environment blocks creation.
    const versionClash = await this.prisma.mobileRelease.findFirst({
      where: {
        applicationId: app.id,
        platform: artifact.platform,
        environment: artifact.environment,
        versionName: artifact.versionName,
        versionCode: artifact.versionCode,
        state: { not: 'REJECTED' },
      },
    });
    if (versionClash) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.VERSION_CONFLICT,
        `version ${artifact.versionName}(${artifact.versionCode}) already exists as release ${versionClash.id} in state ${versionClash.state}`,
        409,
        { releaseId: versionClash.id },
      );
    }

    const key = idempotencyKey(
      'release',
      app.id,
      artifact.platform,
      artifact.environment,
      artifact.versionName,
      artifact.versionCode,
    );
    const existing = await this.prisma.mobileRelease.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: key } });
    if (existing) return { release: existing as unknown as Record<string, unknown>, replayed: true };

    const release = await this.prisma.mobileRelease.create({
      data: {
        applicationId: app.id,
        tenantId: input.tenantId,
        artifactId: artifact.id,
        platform: artifact.platform,
        environment: artifact.environment,
        versionName: artifact.versionName,
        versionCode: artifact.versionCode,
        iosBuildNumber: artifact.iosBuildNumber,
        releaseNotes: input.releaseNotes ?? null,
        state: 'DRAFT',
        idempotencyKey: key,
        createdById: input.actor.userId,
      },
    });
    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: app.id,
      artifactId: artifact.id,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.RELEASE_CREATED,
      environment: release.environment,
      platform: release.platform,
      version: release.versionName,
      commitSha: artifact.commitSha,
      artifactSha256: artifact.sha256,
      correlationId: input.correlationId,
      evidence: { artifactId: artifact.id },
    });
    return { release: release as unknown as Record<string, unknown>, replayed: false };
  }

  /** Internal state move used by approval/store/rollout/rollback services. */
  /** Tenant-scoped, read-only release listing (platform-safe projection). */
  async listForTenant(
    tenantId: string,
    q: { applicationId?: string; platform?: string; environment?: string; state?: string; page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const where: Record<string, unknown> = { tenantId };
    if (q.applicationId) where.applicationId = q.applicationId;
    if (q.platform) where.platform = q.platform;
    if (q.environment) where.environment = q.environment;
    if (q.state) where.state = q.state;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mobileRelease.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.mobileRelease.count({ where }),
    ]);
    return { items: items as unknown as Array<Record<string, unknown>>, total };
  }

  async transitionRelease(
    releaseId: string,
    to: MobileReleaseState,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const release = await this.prisma.mobileRelease.findUnique({ where: { id: releaseId } });
    if (!release) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.RELEASE_NOT_FOUND, 'release vanished', 404);
    }
    transitionOrThrow(RELEASE_TRANSITIONS, release.state as MobileReleaseState, to, 'release');
    const data: Record<string, unknown> = { state: to, ...extra };
    return (await this.prisma.mobileRelease.update({
      where: { id: releaseId },
      data,
    })) as unknown as Record<string, unknown>;
  }

  /** Release manifest validity: everything the downstream gates rely on. */
  async assertReleaseManifest(releaseId: string, tenantId: string | null): Promise<{
    release: Record<string, unknown>;
    artifact: Record<string, unknown>;
    build: Record<string, unknown>;
  }> {
    const release = await this.mustGet(releaseId, tenantId);
    const artifact = await this.prisma.mobileArtifact.findUnique({ where: { id: release.artifactId } });
    if (!artifact) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND,
        'release references a missing artifact',
        409,
      );
    }
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } });
    if (!build || build.state !== 'VERIFIED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.RELEASE_NOT_VERIFIED,
        'release artifact is not in a VERIFIED build state',
        409,
      );
    }
    if (release.versionName !== artifact.versionName || release.versionCode !== artifact.versionCode) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ARTIFACT_MISMATCH,
        'release/artifact version identity mismatch',
        409,
      );
    }
    return {
      release: release as unknown as Record<string, unknown>,
      artifact: artifact as unknown as Record<string, unknown>,
      build: build as unknown as Record<string, unknown>,
    };
  }

  /** Platform identity summary used by the tenant-safe status surface. */
  platformOf(release: { platform: string; environment: string }): {
    platform: MobilePlatform;
    environment: MobileEnvironment;
  } {
    return {
      platform: release.platform as MobilePlatform,
      environment: release.environment as MobileEnvironment,
    };
  }
}
