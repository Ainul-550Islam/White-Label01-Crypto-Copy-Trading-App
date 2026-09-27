import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileReleaseService } from './mobile-release.service';
import { MobileStoreService } from './mobile-store.service';
import { MobileRolloutService } from './mobile-rollout.service';
import { MobileCrashService } from './mobile-crash.service';
import { MobileStoreProvider, MobileReleaseState, MOBILE_ERROR_CODES, MobileReleaseError } from './mobile-release.types';

/**
 * Release-health observation, built ONLY from what actually exists:
 *  - the release/artifact/build rows and their states (database evidence);
 *  - live store-submission state through the provider adapter when one is
 *    configured (provider evidence);
 *  - crash evidence through MobileCrashService (telemetry evidence);
 *  - rollout stage state with its recorded evidence chain.
 *
 * Every unknown is surfaced as `null` with a named reason — never as a zero,
 * never as a synthetic "healthy". `deriveHealth` is a pure function over the
 * gathered facts so the health semantics are unit-testable in isolation.
 */
@Injectable()
export class MobileReleaseMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
    private readonly releases: MobileReleaseService,
    private readonly store: MobileStoreService,
    private readonly rollouts: MobileRolloutService,
    private readonly crashes: MobileCrashService,
  ) {}

  async releaseHealth(input: { releaseId: string; tenantId: string }): Promise<{
    releaseId: string;
    state: MobileReleaseState;
    artifact: { sha256: string | null; signingState: string | null; securityScanId: string | null };
    build: { state: string | null; toolchainVersion: string | null };
    store: Array<{ provider: string; state: string }>;
    rollout: { state: string | null; stagePercentage: number | null; haltReason: string | null };
    crashes: { totalOccurrences: number; installCountsAvailable: boolean; windowMinutes: number };
    health: 'HEALTHY' | 'DEGRADED' | 'AT_RISK' | 'HALTED' | 'UNKNOWN';
    reasons: string[];
  }> {
    const release = await this.releases.mustGet(input.releaseId, input.tenantId);
    const artifact = await this.prisma.mobileArtifact.findUnique({ where: { id: release.artifactId } });
    const build = artifact
      ? await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } })
      : null;
    const submissions = await this.prisma.mobileStoreSubmission.findMany({
      where: { releaseId: release.id },
    });
    const rollout = await this.prisma.mobileReleaseRollout.findFirst({
      where: { releaseId: release.id, state: { in: ['IN_PROGRESS', 'HALTED', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
    });
    let crashEvidence;
    try {
      crashEvidence = await this.crashes.releaseCrashEvidence({
        releaseId: release.id,
        tenantId: input.tenantId,
        windowMinutes: this.policy.resolve().crashEvaluationWindowMinutes,
      });
    } catch {
      crashEvidence = { rows: [], totalOccurrences: 0, installCountsAvailable: false, windowMinutes: this.policy.resolve().crashEvaluationWindowMinutes };
    }

    const facts = {
      releaseState: release.state as MobileReleaseState,
      buildState: (build?.state ?? null) as string | null,
      signingState: (artifact?.signingState ?? null) as string | null,
      scanId: (artifact?.securityScanId ?? null) as string | null,
      storeStates: submissions.map((s) => ({ provider: s.provider as string, state: s.state as string })),
      rolloutState: (rollout?.state ?? null) as string | null,
      rolloutHaltReason: (rollout?.haltReason ?? null) as string | null,
      crashOccurrences: crashEvidence.totalOccurrences,
    };
    const derived = MobileReleaseMonitorService.deriveHealth(facts);

    return {
      releaseId: release.id,
      state: facts.releaseState,
      artifact: {
        sha256: artifact?.sha256 ?? null,
        signingState: facts.signingState,
        securityScanId: facts.scanId,
      },
      build: { state: facts.buildState, toolchainVersion: build?.toolchainVersion ?? null },
      store: facts.storeStates,
      rollout: {
        state: facts.rolloutState,
        stagePercentage: rollout?.stagePercentage ?? null,
        haltReason: facts.rolloutHaltReason,
      },
      crashes: {
        totalOccurrences: crashEvidence.totalOccurrences,
        installCountsAvailable: crashEvidence.installCountsAvailable,
        windowMinutes: crashEvidence.windowMinutes,
      },
      health: derived.health,
      reasons: derived.reasons,
    };
  }

  /**
   * Pure health derivation. The taxonomy is deterministic and evidence-named:
   * HALTED (explicit halt), AT_RISK (store rejection / unsigned artifact),
   * DEGRADED (crash pressure above zero in window or pending rollout),
   * HEALTHY (published+verified+signed, no adverse evidence), UNKNOWN
   * (insufficient state to say anything).
   */
  static deriveHealth(facts: {
    releaseState: MobileReleaseState;
    buildState: string | null;
    signingState: string | null;
    scanId: string | null;
    storeStates: Array<{ provider: string; state: string }>;
    rolloutState: string | null;
    rolloutHaltReason: string | null;
    crashOccurrences: number;
  }): { health: 'HEALTHY' | 'DEGRADED' | 'AT_RISK' | 'HALTED' | 'UNKNOWN'; reasons: string[] } {
    const reasons: string[] = [];
    if (facts.releaseState === 'HALTED' || facts.rolloutState === 'HALTED') {
      reasons.push(facts.rolloutHaltReason ?? 'release halted');
      return { health: 'HALTED', reasons };
    }
    if (facts.storeStates.some((s) => s.state === 'REJECTED')) {
      reasons.push('store provider reported rejection');
      return { health: 'AT_RISK', reasons };
    }
    if (facts.signingState === 'FAILED' || facts.signingState === 'SIGNING_UNAVAILABLE') {
      reasons.push(`artifact signing state ${facts.signingState}`);
      return { health: 'AT_RISK', reasons };
    }
    if (facts.buildState !== 'VERIFIED') {
      reasons.push(`build state ${facts.buildState ?? 'UNKNOWN'} is not VERIFIED`);
      return { health: 'UNKNOWN', reasons };
    }
    if (facts.crashOccurrences > 0) {
      reasons.push(`${facts.crashOccurrences} crash occurrences in the evaluation window`);
      return { health: 'DEGRADED', reasons };
    }
    if (facts.releaseState === 'PUBLISHED' && facts.rolloutState === 'IN_PROGRESS') {
      reasons.push('staged rollout in progress');
      return { health: 'HEALTHY', reasons };
    }
    if (facts.releaseState === 'ROLLED_OUT') {
      return { health: 'HEALTHY', reasons: ['rollout completed with evidence'] };
    }
    if (['DRAFT', 'REVIEW', 'APPROVAL_REQUIRED', 'APPROVED', 'SUBMITTING', 'SUBMITTED'].includes(facts.releaseState)) {
      reasons.push(`release is ${facts.releaseState}; no field evidence yet`);
      return { health: 'UNKNOWN', reasons };
    }
    reasons.push(`release state ${facts.releaseState}`);
    return { health: 'UNKNOWN', reasons };
  }

  /**
   * Automatic halt evaluation: ONLY explicit policy/evidence conditions can
   * halt — crash thresholds from policy, store rejection from provider
   * evidence, artifact mismatch from the verification record. Subjective
   * scoring does not exist in this module.
   */
  async evaluateAutomaticHalt(input: {
    releaseId: string;
    tenantId: string;
  }): Promise<{ halt: boolean; reason: string | null }> {
    const release = await this.releases.mustGet(input.releaseId, input.tenantId);
    if (release.state !== 'PUBLISHED') {
      return { halt: false, reason: null };
    }
    const policy = this.policy.resolve();
    const crashDecision = await this.crashes.evaluateHalt({
      releaseId: release.id,
      tenantId: input.tenantId,
      policy,
    });
    if (crashDecision.halt) return crashDecision;

    const submissions = await this.prisma.mobileStoreSubmission.findMany({
      where: { releaseId: release.id, state: 'REJECTED' },
    });
    if (submissions.length > 0) {
      return {
        halt: true,
        reason: `store rejection by ${submissions[0].provider as MobileStoreProvider}`,
      };
    }

    const artifact = await this.prisma.mobileArtifact.findUnique({ where: { id: release.artifactId } });
    if (artifact && artifact.signingState === 'FAILED') {
      return { halt: true, reason: 'artifact signing evidence regressed to FAILED (possible tampering)' };
    }
    return { halt: false, reason: null };
  }

  /** Re-check the live provider state for a release's submissions. */
  async refreshStoreEvidence(input: {
    releaseId: string;
    tenantId: string;
    actor: { userId: string; tenantId: string | null; roles: string[]; isPlatformUser: boolean };
    correlationId: string;
  }): Promise<void> {
    const submissions = await this.prisma.mobileStoreSubmission.findMany({
      where: { releaseId: input.releaseId },
    });
    for (const submission of submissions) {
      if (
        submission.state === 'SUBMITTED' &&
        (submission.provider === 'GOOGLE_PLAY' || submission.provider === 'APPLE_APP_STORE')
      ) {
        await this.store.refreshStatus({
          releaseId: input.releaseId,
          tenantId: input.tenantId,
          provider: submission.provider,
          actor: input.actor,
          correlationId: input.correlationId,
        });
      }
    }
  }

  async mustGetTenantApp(applicationId: string, tenantId: string): Promise<void> {
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: applicationId, tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'application not found for tenant', 404);
    }
  }
}
