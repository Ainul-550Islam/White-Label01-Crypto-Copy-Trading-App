import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileReleaseService } from './mobile-release.service';
import {
  AUDIT_ACTIONS,
  idempotencyKey,
  MobileActor,
  MobileReleaseError,
  MobileReleaseState,
  MOBILE_ERROR_CODES,
  ROLLOUT_TRANSITIONS,
  transitionOrThrow,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Distribution evidence carried with every rollout stage. The rollout state
 * never advances on intention: each stage must attach WHO observed WHAT from
 * WHICH source. Percentages without a provenance source are refused — that is
 * the exact shape "fabricated rollout completion" takes.
 */
export interface RolloutEvidence {
  source: 'STORE_PROVIDER' | 'ENTERPRISE_MDM' | 'INTERNAL_DISTRIBUTION' | 'CRASH_TELEMETRY';
  /** Store/MDM object this evidence came from (submission id, audit ref...). */
  sourceReference: string;
  observedPercentage: number;
  observedAt?: string | null;
  note?: string | null;
}

export interface HaltDecision {
  halt: boolean;
  reason: string | null;
}

/**
 * Staged rollout control.
 *
 * Stages come from policy (not a hardcoded ladder). Advancing validates the
 * percentage against the ladder and the jump cap, requires evidence, and
 * appends an immutable stage entry. Completion requires observed == 100 with
 * evidence from a distribution source. Halting requires a deterministic
 * reason supplied by the monitor (crash threshold / store rejection / artifact
 * mismatch) — this service never invents health opinions of its own.
 */
@Injectable()
export class MobileRolloutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly releases: MobileReleaseService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  private static validateEvidence(evidence: RolloutEvidence): void {
    if (!evidence || !evidence.source || !evidence.sourceReference) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        'rollout evidence requires a source and a source reference',
        400,
      );
    }
    if (
      !Number.isFinite(evidence.observedPercentage) ||
      evidence.observedPercentage < 0 ||
      evidence.observedPercentage > 100
    ) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        'rollout evidence percentage must be within [0, 100]',
        400,
      );
    }
    if (evidence.source === 'STORE_PROVIDER' && evidence.sourceReference.length < 4) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        'store-provider evidence requires a real submission/status reference',
        400,
      );
    }
  }

  /** Starts the first stage of a rollout for a PUBLISHED release. */
  async start(input: {
    releaseId: string;
    tenantId: string;
    track?: string;
    actor: MobileActor;
    correlationId: string;
  }): Promise<{ rollout: Record<string, unknown>; replayed: boolean }> {
    const release = await this.releases.mustGet(input.releaseId, input.tenantId);
    if ((release.state as MobileReleaseState) !== 'PUBLISHED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_CONFLICT,
        `rollout requires a PUBLISHED release; release is ${release.state}`,
        409,
        { state: release.state },
      );
    }
    const policy = this.policy.resolve();
    const firstStage = policy.rolloutStages[0];
    const key = idempotencyKey('rollout', release.id, release.updatedAt instanceof Date ? String(release.updatedAt.getTime()) : String(release.updatedAt));
    const existing = await this.prisma.mobileReleaseRollout.findFirst({
      where: { releaseId: release.id, state: { in: ['NOT_STARTED', 'IN_PROGRESS', 'HALTED'] } },
    });
    if (existing) {
      return { rollout: existing as unknown as Record<string, unknown>, replayed: true };
    }

    const rollout = await this.prisma.mobileReleaseRollout.create({
      data: {
        releaseId: release.id,
        applicationId: release.applicationId,
        tenantId: input.tenantId,
        track: input.track ?? 'production',
        state: 'NOT_STARTED',
        stagePercentage: firstStage,
        idempotencyKey: key,
        evidence: [],
      },
    });
    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: release.applicationId,
      releaseId: release.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLOUT_STARTED,
      environment: release.environment,
      platform: release.platform,
      version: release.versionName,
      correlationId: input.correlationId,
      evidence: { rolloutId: rollout.id, firstStage },
    });
    await this.audit.notify({
      tenantId: input.tenantId,
      userId: input.actor.userId,
      type: 'MOBILE_ROLLOUT_STARTED',
      data: { releaseId: release.id, stage: firstStage },
      correlationId: input.correlationId,
    });
    return { rollout: rollout as unknown as Record<string, unknown>, replayed: false };
  }

  /** Marks the rollout IN_PROGRESS once the first evidence arrives. */
  async begin(rolloutId: string, tenantId: string, evidence: RolloutEvidence): Promise<Record<string, unknown>> {
    MobileRolloutService.validateEvidence(evidence);
    const rollout = await this.mustGet(rolloutId, tenantId);
    transitionOrThrow(ROLLOUT_TRANSITIONS, rollout.state as import('./mobile-release.types').MobileRolloutState, 'IN_PROGRESS', 'rollout');
    const updated = await this.prisma.mobileReleaseRollout.update({
      where: { id: rollout.id },
      data: {
        state: 'IN_PROGRESS',
        observedPercentage: evidence.observedPercentage,
        startedAt: rollout.startedAt ?? new Date(),
        evidence: [
          ...((rollout.evidence as unknown[]) ?? []),
          { stage: rollout.stagePercentage, targetPercentage: rollout.stagePercentage, startAt: new Date().toISOString(), observedState: 'IN_PROGRESS', evidence },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return updated as unknown as Record<string, unknown>;
  }

  /**
   * Advances to the next policy stage. Requires distribution evidence for the
   * CURRENT stage first; the release must still be PUBLISHED (a halted or
   * rolled-back release cannot advance).
   */
  async advance(input: {
    rolloutId: string;
    tenantId: string;
    actor: MobileActor;
    evidence: RolloutEvidence;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    MobileRolloutService.validateEvidence(input.evidence);
    const rollout = await this.mustGet(input.rolloutId, input.tenantId);
    const release = await this.releases.mustGet(rollout.releaseId, input.tenantId);
    if ((release.state as MobileReleaseState) !== 'PUBLISHED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_CONFLICT,
        `cannot advance a rollout whose release is ${release.state}`,
        409,
        { state: release.state },
      );
    }
    const policy = this.policy.resolve();

    // Evidence must cover the CURRENT stage before moving past it.
    if (input.evidence.observedPercentage < rollout.stagePercentage) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        `observed ${input.evidence.observedPercentage}% does not cover current stage ${rollout.stagePercentage}%`,
        409,
      );
    }

    if (rollout.state === 'NOT_STARTED') {
      return this.begin(rollout.id, input.tenantId, input.evidence);
    }

    const next = policy.rolloutStages.find((s) => s > rollout.stagePercentage);
    if (next === undefined) {
      // Already at the top of the ladder: completion is the monitor's call.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_CONFLICT,
        'no further stage on the policy ladder; use complete() with 100% evidence',
        409,
      );
    }
    if (!this.policy.isLegalNextStage(policy, rollout.stagePercentage, next)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_CONFLICT,
        `stage jump ${rollout.stagePercentage} -> ${next} exceeds policy cap`,
        409,
      );
    }

    const updated = await this.prisma.mobileReleaseRollout.update({
      where: { id: rollout.id },
      data: {
        state: 'IN_PROGRESS',
        stagePercentage: next,
        observedPercentage: input.evidence.observedPercentage,
        evidence: [
          ...((rollout.evidence as unknown[]) ?? []),
          { stage: next, targetPercentage: next, startAt: new Date().toISOString(), observedState: 'IN_PROGRESS', evidence: input.evidence },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: rollout.applicationId,
      releaseId: rollout.releaseId,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLOUT_ADVANCED,
      correlationId: input.correlationId,
      evidence: { stage: next, observed: input.evidence.observedPercentage, source: input.evidence.source },
    });
    return updated as unknown as Record<string, unknown>;
  }

  /**
   * Completion requires observed 100% with real evidence. This is the only
   * door to ROLLED_OUT, and the release transition enforces PUBLISHED first.
   */
  async complete(input: {
    rolloutId: string;
    tenantId: string;
    actor: MobileActor;
    evidence: RolloutEvidence;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    MobileRolloutService.validateEvidence(input.evidence);
    const rollout = await this.mustGet(input.rolloutId, input.tenantId);
    if (input.evidence.observedPercentage !== 100) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        `completion requires observed 100%, got ${input.evidence.observedPercentage}%`,
        409,
      );
    }
    transitionOrThrow(ROLLOUT_TRANSITIONS, rollout.state as import('./mobile-release.types').MobileRolloutState, 'COMPLETED', 'rollout');
    const updated = await this.prisma.mobileReleaseRollout.update({
      where: { id: rollout.id },
      data: {
        state: 'COMPLETED',
        observedPercentage: 100,
        completedAt: new Date(),
        evidence: [
          ...((rollout.evidence as unknown[]) ?? []),
          { stage: 100, targetPercentage: 100, startAt: new Date().toISOString(), observedState: 'COMPLETED', evidence: input.evidence },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    await this.releases.transitionRelease(rollout.releaseId, 'ROLLED_OUT', {
      rolledOutAt: new Date(),
    });
    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: rollout.applicationId,
      releaseId: rollout.releaseId,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLOUT_COMPLETED,
      correlationId: input.correlationId,
      evidence: { source: input.evidence.source, reference: input.evidence.sourceReference },
    });
    return updated as unknown as Record<string, unknown>;
  }

  /** Halts with an explicit, caller-supplied deterministic reason. */
  async halt(input: {
    rolloutId: string;
    tenantId: string;
    actor: MobileActor;
    reason: string;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    if (!input.reason || input.reason.trim().length < 4) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.ROLLOUT_EVIDENCE,
        'halt requires an explicit reason (policy/evidence-derived)',
        400,
      );
    }
    const rollout = await this.mustGet(input.rolloutId, input.tenantId);
    transitionOrThrow(ROLLOUT_TRANSITIONS, rollout.state as import('./mobile-release.types').MobileRolloutState, 'HALTED', 'rollout');
    const updated = await this.prisma.mobileReleaseRollout.update({
      where: { id: rollout.id },
      data: {
        state: 'HALTED',
        haltReason: input.reason.slice(0, 255),
        haltedAt: new Date(),
      },
    });
    await this.releases.transitionRelease(rollout.releaseId, 'HALTED', {
      haltedAt: new Date(),
      haltReason: input.reason.slice(0, 255),
    });
    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: rollout.applicationId,
      releaseId: rollout.releaseId,
      actor: input.actor,
      action: AUDIT_ACTIONS.ROLLOUT_HALTED,
      correlationId: input.correlationId,
      evidence: { reason: input.reason.slice(0, 255) },
    });
    await this.audit.notify({
      tenantId: input.tenantId,
      userId: input.actor.userId,
      type: 'MOBILE_ROLLOUT_HALTED',
      data: { releaseId: rollout.releaseId, reason: input.reason.slice(0, 255) },
      correlationId: input.correlationId,
    });
    await this.audit.raiseIncident({
      tenantId: input.tenantId,
      type: 'MOBILE_ROLLOUT_HALTED',
      severity: 'CRITICAL',
      title: `mobile rollout halted: ${input.reason.slice(0, 80)}`,
      summary: `Rollout ${rollout.id} for release ${rollout.releaseId} halted: ${input.reason}`,
      evidence: { rolloutId: rollout.id, releaseId: rollout.releaseId, reason: input.reason },
      correlationId: input.correlationId,
    });
    return updated as unknown as Record<string, unknown>;
  }

  async mustGet(rolloutId: string, tenantId: string) {
    const rollout = await this.prisma.mobileReleaseRollout.findFirst({
      where: { id: rolloutId, tenantId },
    });
    if (!rollout) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.ROLLOUT_CONFLICT, 'rollout not found', 404, {
        rolloutId,
      });
    }
    return rollout;
  }
}
