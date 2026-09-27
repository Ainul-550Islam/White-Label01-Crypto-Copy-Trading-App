import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileSecurityScanService } from './mobile-security-scan.service';
import { MobileReleaseService } from './mobile-release.service';
import {
  AUDIT_ACTIONS,
  isPlatformReleaseActor,
  MobileActor,
  MobileReleaseError,
  MobileReleaseState,
  MOBILE_ERROR_CODES,
  redactSecrets,
} from './mobile-release.types';
import type { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Production release approval workflow.
 *
 * The gate is a checklist re-verified AT APPROVAL TIME (not trusted from
 * creation time): verified artifact, passing scan, valid manifest, unique
 * version, tenant authorization — and, when policy requires it (the
 * default), an approver OUTSIDE the owning tenant: a tenant admin can never
 * self-approve a platform-level production release. All three decisions
 * (APPROVED / REJECTED / REWORK) are recorded as immutable approval rows.
 */
@Injectable()
export class MobileReleaseApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly releases: MobileReleaseService,
    private readonly scans: MobileSecurityScanService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  private async preconditions(releaseId: string, tenantId: string | null) {
    const manifest = await this.releases.assertReleaseManifest(releaseId, tenantId);
    const release = manifest.release as unknown as {
      id: string;
      tenantId: string;
      environment: string;
      state: MobileReleaseState;
      applicationId: string;
      versionName: string;
    };
    const scan = await this.scans.assertScanGate((manifest.artifact as unknown as { id: string }).id);
    return { manifest, release, scan };
  }

  private assertActorCanDecide(
    release: { tenantId: string; environment: string },
    actor: MobileActor,
  ): { platformApproval: boolean } {
    const policy = this.policy.resolve();
    const production = release.environment === 'PRODUCTION';
    const platformApproval = production && policy.productionRequiresPlatformApproval;

    if (platformApproval) {
      if (!isPlatformReleaseActor(actor)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SELF_APPROVAL,
          'production releases require a platform release approver',
          403,
          { environment: release.environment },
        );
      }
      // A platform actor that is ALSO a member of the owning tenant is still
      // a self-approval for this purpose.
      if (actor.tenantId === release.tenantId) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.SELF_APPROVAL,
          'the approving actor belongs to the owning tenant; production approval must be independent',
          403,
        );
      }
      return { platformApproval: true };
    }

    // Non-production (or policy-relaxed) approvals: tenant-side is fine, but
    // the actor must at least belong to the owning tenant or the platform.
    if (!actor.isPlatformUser && actor.tenantId !== release.tenantId) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CROSS_TENANT,
        'actor does not belong to the owning tenant',
        403,
      );
    }
    return { platformApproval: false };
  }

  async approve(input: {
    releaseId: string;
    actor: MobileActor;
    reason?: string | null;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const { release } = await this.preconditions(input.releaseId, null);
    const { platformApproval } = this.assertActorCanDecide(release, input.actor);

    const releaseRow = await this.releases.transitionRelease(
      release.id,
      'APPROVED',
    );

    const approval = await this.prisma.mobileReleaseApproval.create({
      data: {
        releaseId: release.id,
        tenantId: release.tenantId,
        decision: 'APPROVED',
        approverId: input.actor.userId,
        approverRole: input.actor.roles[0] ?? 'UNKNOWN',
        platformApproval,
        reason: input.reason ?? null,
        policyVersion: this.policy.resolve().policyVersion,
      },
    });

    await this.audit.record({
      tenantId: release.tenantId,
      applicationId: release.applicationId,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.RELEASE_APPROVED,
      environment: release.environment,
      platform: (releaseRow as unknown as { platform: string }).platform,
      version: release.versionName,
      correlationId: input.correlationId,
      evidence: redactSecrets({
        approvalId: approval.id,
        platformApproval,
        reason: input.reason ?? null,
      }) as Record<string, unknown>,
    });
    await this.audit.notify({
      tenantId: release.tenantId,
      userId: input.actor.userId,
      type: 'MOBILE_RELEASE_APPROVED',
      data: { releaseId: release.id, version: release.versionName, environment: release.environment },
      correlationId: input.correlationId,
    });
    return releaseRow;
  }

  async reject(input: {
    releaseId: string;
    actor: MobileActor;
    reason: string;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const { release } = await this.preconditions(input.releaseId, null);
    this.assertActorCanDecide(release, input.actor);

    const releaseRow = await this.releases.transitionRelease(release.id, 'REJECTED', {
      rejectedAt: new Date(),
      rejectReason: input.reason.slice(0, 500),
    });
    await this.prisma.mobileReleaseApproval.create({
      data: {
        releaseId: release.id,
        tenantId: release.tenantId,
        decision: 'REJECTED',
        approverId: input.actor.userId,
        approverRole: input.actor.roles[0] ?? 'UNKNOWN',
        platformApproval: release.environment === 'PRODUCTION',
        reason: input.reason.slice(0, 500),
        policyVersion: this.policy.resolve().policyVersion,
      },
    });
    await this.audit.record({
      tenantId: release.tenantId,
      applicationId: release.applicationId,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.RELEASE_REJECTED,
      environment: release.environment,
      platform: (releaseRow as unknown as { platform: string }).platform,
      version: release.versionName,
      correlationId: input.correlationId,
      evidence: { reason: input.reason.slice(0, 500) },
    });
    return releaseRow;
  }

  async requestRework(input: {
    releaseId: string;
    actor: MobileActor;
    reason: string;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const { release } = await this.preconditions(input.releaseId, null);
    this.assertActorCanDecide(release, input.actor);
    // REWORK sends the release back to DRAFT for another pass; the approval
    // row records the decision trail.
    const releaseRow = await this.releases.transitionRelease(release.id, 'DRAFT');
    await this.prisma.mobileReleaseApproval.create({
      data: {
        releaseId: release.id,
        tenantId: release.tenantId,
        decision: 'REWORK',
        approverId: input.actor.userId,
        approverRole: input.actor.roles[0] ?? 'UNKNOWN',
        platformApproval: release.environment === 'PRODUCTION',
        reason: input.reason.slice(0, 500),
        policyVersion: this.policy.resolve().policyVersion,
      },
    });
    await this.audit.record({
      tenantId: release.tenantId,
      applicationId: release.applicationId,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.RELEASE_REJECTED,
      environment: release.environment,
      platform: (releaseRow as unknown as { platform: string }).platform,
      version: release.versionName,
      correlationId: input.correlationId,
      evidence: { rework: true, reason: input.reason.slice(0, 500) },
    });
    return releaseRow;
  }

  /** Approval evidence for the gating services (store submit, publish). */
  async latestApproval(releaseId: string) {
    return this.prisma.mobileReleaseApproval.findFirst({
      where: { releaseId, decision: 'APPROVED' },
      orderBy: { decidedAt: 'desc' },
    });
  }
}
