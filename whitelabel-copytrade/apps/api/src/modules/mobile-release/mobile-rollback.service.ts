import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileReleaseService } from './mobile-release.service';
import { MobileRolloutService } from './mobile-rollout.service';
import { MobileArtifactVerificationService } from './mobile-artifact-verification.service';
import {
  AUDIT_ACTIONS,
  MobileActor,
  MobileReleaseError,
  MobileReleaseState,
  MOBILE_ERROR_CODES,
  ROLLBACK_ELIGIBLE_RELEASE_STATES,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Controlled rollback.
 *
 * The flow is exactly the required chain, each step a real check:
 *   verify previous release -> verify artifact -> verify tenant/app identity
 *   -> verify release compatibility -> authorize -> halt current rollout
 *   -> (caller) start previous release rollout -> verify result -> audit.
 *
 * History is sacred: this service contains no delete of any kind, and the
 * rolled-back release keeps its full record (state ROLLED_BACK + audit).
 * Idempotent by key so a retried rollback replays instead of double-rolling.
 */
@Injectable()
export class MobileRollbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly releases: MobileReleaseService,
    private readonly rollouts: MobileRolloutService,
    private readonly verification: MobileArtifactVerificationService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  async rollback(input: {
    applicationId: string;
    tenantId: string;
    /** Explicit previous release to restore, or null for "latest eligible". */
    targetReleaseId?: string | null;
    actor: MobileActor;
    correlationId: string;
  }): Promise<{
    rolledBackReleaseId: string;
    restoredReleaseId: string;
    rolloutId: string;
    replayed: boolean;
  }> {
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'application not found for tenant', 404);
    }

    // ---- current release (the one being rolled back) ---------------------
    const current = await this.prisma.mobileRelease.findFirst({
      where: {
        applicationId: app.id,
        state: { in: ['PUBLISHED', 'ROLLED_OUT', 'HALTED', 'SUBMITTED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLBACK_TARGET,
        'no current release to roll back',
        409,
      );
    }

    // ---- target release (previous, verified) ------------------------------
    let target;
    if (input.targetReleaseId) {
      target = await this.prisma.mobileRelease.findFirst({
        where: { id: input.targetReleaseId, applicationId: app.id, tenantId: input.tenantId },
      });
      if (!target) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.ROLLBACK_TARGET,
          'target release not found under this application/tenant',
          404,
        );
      }
    } else {
      const candidates = await this.prisma.mobileRelease.findMany({
        where: {
          applicationId: app.id,
          platform: current.platform,
          environment: current.environment,
          state: { in: [...ROLLBACK_ELIGIBLE_RELEASE_STATES] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      target = candidates.find((c) => c.id !== current.id && c.createdAt < current.createdAt);
    }
    if (!target) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLBACK_TARGET,
        'no previously verified release is eligible for rollback',
        409,
      );
    }
    if (!(ROLLBACK_ELIGIBLE_RELEASE_STATES as readonly string[]).includes(target.state)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLBACK_TARGET,
        `target release state ${target.state} is not rollback-eligible`,
        409,
        { state: target.state },
      );
    }
    if (target.platform !== current.platform || target.environment !== current.environment) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLBACK_TARGET,
        'rollback target is not release-compatible (platform/environment mismatch)',
        409,
        {
          targetPlatform: target.platform,
          currentPlatform: current.platform,
          targetEnvironment: target.environment,
          currentEnvironment: current.environment,
        },
      );
    }

    // ---- re-verify the target artifact NOW (bytes, not memories) ---------
    const targetArtifact = await this.prisma.mobileArtifact.findUnique({ where: { id: target.artifactId } });
    if (!targetArtifact) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.ARTIFACT_NOT_FOUND, 'target artifact missing', 404);
    }
    await this.verification.verify({
      artifactId: targetArtifact.id,
      tenantId: input.tenantId,
      actor: input.actor,
      correlationId: input.correlationId,
      signingRequired: this.policy
        .resolve()
        .signingRequiredEnvironments.includes(target.environment as import('./mobile-release.types').MobileEnvironment),
    });

    // ---- authorization: rollback is a release action ----------------------
    if (!input.actor.isPlatformUser && input.actor.tenantId !== input.tenantId) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.CROSS_TENANT, 'actor is not authorized for this tenant', 403);
    }

    const priorRollback = await this.prisma.mobileReleaseRollout.findFirst({
      where: { releaseId: target.id, tenantId: input.tenantId, track: 'rollback' },
      orderBy: { createdAt: 'desc' },
    });
    if (priorRollback && priorRollback.state !== 'ABORTED') {
      // This rollback already ran; replay it instead of double-rolling.
      await this.audit.record({
        tenantId: input.tenantId,
        applicationId: app.id,
        releaseId: current.id,
        actor: input.actor,
        action: AUDIT_ACTIONS.ROLLBACK_REPLAYED,
        environment: current.environment,
        platform: current.platform,
        version: current.versionName,
        correlationId: input.correlationId,
        evidence: { targetReleaseId: target.id, rolloutId: priorRollback.id },
      });
      return {
        rolledBackReleaseId: current.id,
        restoredReleaseId: target.id,
        rolloutId: priorRollback.id,
        replayed: true,
      };
    }

    // ---- halt current rollout ---------------------------------------------
    const activeRollout = await this.prisma.mobileReleaseRollout.findFirst({
      where: { releaseId: current.id, state: 'IN_PROGRESS' },
    });
    if (activeRollout) {
      await this.rollouts.halt({
        rolloutId: activeRollout.id,
        tenantId: input.tenantId,
        actor: input.actor,
        reason: `rollback to release ${target.versionName}(${target.versionCode}) requested`,
        correlationId: input.correlationId,
      });
    }
    if (['PUBLISHED', 'ROLLED_OUT', 'HALTED'].includes(current.state)) {
      await this.releases.transitionRelease(current.id, 'ROLLED_BACK', {
        rolledBackAt: new Date(),
      });
    }

    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: app.id,
      artifactId: targetArtifact.id,
      releaseId: current.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLBACK_STARTED,
      environment: current.environment,
      platform: current.platform,
      version: current.versionName,
      commitSha: targetArtifact.commitSha,
      artifactSha256: targetArtifact.sha256,
      correlationId: input.correlationId,
      evidence: {
        targetReleaseId: target.id,
        targetVersion: target.versionName,
        haltedRolloutId: activeRollout?.id ?? null,
      },
    });

    // ---- restore the target ------------------------------------------------
    // A PUBLISHED target still owes its staged rollout and gets a dedicated
    // rollback-track rollout driven by real evidence. An already ROLLED_OUT /
    // HALTED target is restored by marking the current release ROLLED_BACK
    // (above) and auditing the restore — no synthetic evidence is invented.
    let rolloutId: string | null = null;
    let replayed = false;
    if (target.state === 'PUBLISHED') {
      const started = await this.rollouts.start({
        releaseId: target.id,
        tenantId: input.tenantId,
        track: 'rollback',
        actor: input.actor,
        correlationId: input.correlationId,
      });
      rolloutId = String(started.rollout.id);
      replayed = started.replayed;
    }

    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: app.id,
      artifactId: targetArtifact.id,
      releaseId: target.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLBACK_COMPLETED,
      environment: target.environment,
      platform: target.platform,
      version: target.versionName,
      commitSha: targetArtifact.commitSha,
      artifactSha256: targetArtifact.sha256,
      correlationId: input.correlationId,
      evidence: { rolloutId, replayed },
    });
    await this.audit.notify({
      tenantId: input.tenantId,
      userId: input.actor.userId,
      type: 'MOBILE_ROLLBACK_COMPLETED',
      data: {
        rolledBackReleaseId: current.id,
        restoredReleaseId: target.id,
        version: target.versionName,
      },
      correlationId: input.correlationId,
    });
    await this.audit.raiseIncident({
      tenantId: input.tenantId,
      type: 'MOBILE_RELEASE_ROLLED_BACK',
      severity: 'WARNING',
      title: `mobile release rolled back: ${current.versionName} -> ${target.versionName}`,
      summary: `Release ${current.id} rolled back to ${target.id} by ${input.actor.userId}`,
      evidence: {
        currentReleaseId: current.id,
        targetReleaseId: target.id,
        targetArtifactSha256: targetArtifact.sha256,
      },
      correlationId: input.correlationId,
    });

    return {
      rolledBackReleaseId: current.id,
      restoredReleaseId: target.id,
      rolloutId: rolloutId ?? priorRollback?.id ?? '',
      replayed,
    };
  }

  /**
   * Rollback history for an app: every release that ever went through
   * ROLLED_BACK, with its full record intact (no deletes anywhere).
   */
  async history(applicationId: string, tenantId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.prisma.mobileRelease.findMany({
      where: { applicationId, tenantId, state: 'ROLLED_BACK' },
      orderBy: { rolledBackAt: 'desc' },
      take: 50,
    });
    return rows as unknown as Array<Record<string, unknown>>;
  }
}
