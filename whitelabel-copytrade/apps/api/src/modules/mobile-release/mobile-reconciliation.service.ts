import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { sha256File } from './mobile-artifact.service';
import { MobileReleaseError, MOBILE_ERROR_CODES } from './mobile-release.types';

/**
 * Reconciliation codes. Declared here (types file is module-internal to the
 * 30-file budget) as the canonical vocabulary the checks emit.
 */
export const RECONCILIATION_CODES = {
  APP_WITHOUT_TENANT: 'APP_WITHOUT_TENANT',
  DUPLICATE_PACKAGE_ID: 'DUPLICATE_PACKAGE_ID',
  DUPLICATE_BUNDLE_ID: 'DUPLICATE_BUNDLE_ID',
  BUILD_WITHOUT_ARTIFACT: 'BUILD_WITHOUT_ARTIFACT',
  ARTIFACT_HASH_MISMATCH: 'ARTIFACT_HASH_MISMATCH',
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  RELEASE_WITHOUT_VERIFIED_ARTIFACT: 'RELEASE_WITHOUT_VERIFIED_ARTIFACT',
  RELEASE_WITHOUT_APPROVAL: 'RELEASE_WITHOUT_APPROVAL',
  STORE_STATE_MISMATCH: 'STORE_STATE_MISMATCH',
  ROLLOUT_STATE_MISMATCH: 'ROLLOUT_STATE_MISMATCH',
  CRASH_RELEASE_MISMATCH: 'CRASH_RELEASE_MISMATCH',
  ORPHAN_ROLLOUT: 'ORPHAN_ROLLOUT',
  TENANT_SCOPE_MISMATCH: 'TENANT_SCOPE_MISMATCH',
} as const;

export type ReconciliationCode = (typeof RECONCILIATION_CODES)[keyof typeof RECONCILIATION_CODES];

export interface ReconciliationFinding {
  code: ReconciliationCode;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  subjectType: string;
  subjectId: string;
  detail: Record<string, unknown>;
}

export interface ReconciliationRunResult {
  runId: string;
  startedAt: string;
  findings: ReconciliationFinding[];
  persisted: number;
  idempotentReplay: boolean;
}

/**
 * Mobile control-plane reconciliation.
 *
 * Detects the structural lies between app configuration, builds, artifacts,
 * signatures, releases, store state, rollout state and crash evidence. Rules:
 *  - it READS external store state only through configured adapters and only
 *    for cross-checking — it NEVER writes to a store;
 *  - findings are persisted once per (runId, code, subjectId) so re-running
 *    the same runId replays identically (idempotent);
 *  - artifact hash verification re-reads real bytes (sampled by policy limit).
 */
@Injectable()
export class MobileReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MobileReleasePolicyService,
  ) {}

  async run(input: { runId?: string; tenantId?: string | null }): Promise<ReconciliationRunResult> {
    const runId = input.runId || `recon-${randomUUID()}`;
    const tenantId = input.tenantId ?? null;
    const findings: ReconciliationFinding[] = [];

    const apps = await this.prisma.mobileApplication.findMany({
      ...(tenantId ? { where: { tenantId } } : {}),
    });

    // ---- APP_WITHOUT_TENANT ------------------------------------------------
    for (const app of apps) {
      if (!app.tenantId) {
        findings.push({
          code: RECONCILIATION_CODES.APP_WITHOUT_TENANT,
          severity: 'CRITICAL',
          subjectType: 'MobileApplication',
          subjectId: app.id,
          detail: { displayName: app.displayName },
        });
      }
    }

    // ---- DUPLICATE_PACKAGE_ID / DUPLICATE_BUNDLE_ID ------------------------
    const byPackage = new Map<string, string[]>();
    const byBundle = new Map<string, string[]>();
    for (const app of apps) {
      if (app.androidPackageId) {
        byPackage.set(app.androidPackageId, [...(byPackage.get(app.androidPackageId) ?? []), app.id]);
      }
      if (app.iosBundleId) {
        byBundle.set(app.iosBundleId, [...(byBundle.get(app.iosBundleId) ?? []), app.id]);
      }
    }
    for (const [packageId, appIds] of byPackage) {
      if (appIds.length > 1) {
        findings.push({
          code: RECONCILIATION_CODES.DUPLICATE_PACKAGE_ID,
          severity: 'CRITICAL',
          subjectType: 'MobileApplication',
          subjectId: packageId,
          detail: { appIds },
        });
      }
    }
    for (const [bundleId, appIds] of byBundle) {
      if (appIds.length > 1) {
        findings.push({
          code: RECONCILIATION_CODES.DUPLICATE_BUNDLE_ID,
          severity: 'CRITICAL',
          subjectType: 'MobileApplication',
          subjectId: bundleId,
          detail: { appIds },
        });
      }
    }

    for (const app of apps) {
      // ---- BUILD_WITHOUT_ARTIFACT ----------------------------------------
      const builds = await this.prisma.mobileBuild.findMany({ where: { applicationId: app.id } });
      for (const build of builds) {
        if (['BUILT', 'VERIFYING', 'VERIFIED'].includes(build.state)) {
          const artifact = await this.prisma.mobileArtifact.findUnique({ where: { buildId: build.id } });
          if (!artifact) {
            findings.push({
              code: RECONCILIATION_CODES.BUILD_WITHOUT_ARTIFACT,
              severity: 'CRITICAL',
              subjectType: 'MobileBuild',
              subjectId: build.id,
              detail: { state: build.state },
            });
          }
        }
      }

      // ---- artifact hash verification (sampled) ---------------------------
      const artifacts = await this.prisma.mobileArtifact.findMany({
        where: { applicationId: app.id },
        take: this.policy.resolve().reconciliationArtifactLimit,
      });
      for (const artifact of artifacts) {
        try {
          const identity = await sha256File(artifact.storageReference);
          if (identity.sha256 !== artifact.sha256) {
            findings.push({
              code: RECONCILIATION_CODES.ARTIFACT_HASH_MISMATCH,
              severity: 'CRITICAL',
              subjectType: 'MobileArtifact',
              subjectId: artifact.id,
              detail: { recorded: artifact.sha256, recomputed: identity.sha256 },
            });
          }
        } catch {
          findings.push({
            code: RECONCILIATION_CODES.ARTIFACT_HASH_MISMATCH,
            severity: 'WARNING',
            subjectType: 'MobileArtifact',
            subjectId: artifact.id,
            detail: { reason: 'content unreadable at storage reference' },
          });
        }
        if (artifact.signingState === 'SIGNED' && !artifact.signatureVerified) {
          findings.push({
            code: RECONCILIATION_CODES.SIGNATURE_MISMATCH,
            severity: 'CRITICAL',
            subjectType: 'MobileArtifact',
            subjectId: artifact.id,
            detail: { signingState: artifact.signingState, signatureVerified: artifact.signatureVerified },
          });
        }
      }

      // ---- release checks --------------------------------------------------
      const releases = await this.prisma.mobileRelease.findMany({ where: { applicationId: app.id } });
      for (const release of releases) {
        const artifact = await this.prisma.mobileArtifact.findUnique({ where: { id: release.artifactId } });
        const build = artifact
          ? await this.prisma.mobileBuild.findUnique({ where: { id: artifact.buildId } })
          : null;
        if (!artifact || !build || build.state !== 'VERIFIED') {
          findings.push({
            code: RECONCILIATION_CODES.RELEASE_WITHOUT_VERIFIED_ARTIFACT,
            severity: 'CRITICAL',
            subjectType: 'MobileRelease',
            subjectId: release.id,
            detail: { buildState: build?.state ?? null, hasArtifact: Boolean(artifact) },
          });
        }
        if (
          (release.environment === 'PRODUCTION' &&
            ['APPROVED', 'SUBMITTING', 'SUBMITTED', 'PUBLISHED', 'ROLLED_OUT'].includes(release.state))
        ) {
          const approval = await this.prisma.mobileReleaseApproval.findFirst({
            where: { releaseId: release.id, decision: 'APPROVED' },
          });
          if (!approval) {
            findings.push({
              code: RECONCILIATION_CODES.RELEASE_WITHOUT_APPROVAL,
              severity: 'CRITICAL',
              subjectType: 'MobileRelease',
              subjectId: release.id,
              detail: { state: release.state },
            });
          }
        }

        // ---- STORE_STATE_MISMATCH (read-only cross-check) ----------------
        const submissions = await this.prisma.mobileStoreSubmission.findMany({
          where: { releaseId: release.id },
        });
        for (const submission of submissions) {
          const consistent = this.storeStateConsistent(release.state, submission.state);
          if (!consistent) {
            findings.push({
              code: RECONCILIATION_CODES.STORE_STATE_MISMATCH,
              severity: 'WARNING',
              subjectType: 'MobileStoreSubmission',
              subjectId: submission.id,
              detail: { releaseState: release.state, storeState: submission.state },
            });
          }
        }

        // ---- rollout checks ----------------------------------------------
        const rollouts = await this.prisma.mobileReleaseRollout.findMany({
          where: { releaseId: release.id },
        });
        for (const rollout of rollouts) {
          if (!['PUBLISHED', 'ROLLED_OUT', 'HALTED', 'ROLLED_BACK'].includes(release.state)) {
            findings.push({
              code: RECONCILIATION_CODES.ROLLOUT_STATE_MISMATCH,
              severity: 'WARNING',
              subjectType: 'MobileReleaseRollout',
              subjectId: rollout.id,
              detail: { releaseState: release.state, rolloutState: rollout.state },
            });
          }
          void rollout;
        }
      }

      // ---- CRASH_RELEASE_MISMATCH ------------------------------------------
      const crashEvents = await this.prisma.mobileCrashEvent.findMany({
        where: { applicationId: app.id },
        take: 200,
      });
      for (const crash of crashEvents) {
        if (crash.releaseId) {
          const release = await this.prisma.mobileRelease.findUnique({ where: { id: crash.releaseId } });
          if (!release || release.applicationId !== crash.applicationId) {
            findings.push({
              code: RECONCILIATION_CODES.CRASH_RELEASE_MISMATCH,
              severity: 'WARNING',
              subjectType: 'MobileCrashEvent',
              subjectId: crash.id,
              detail: { releaseId: crash.releaseId },
            });
          }
        }
      }

      // ---- TENANT_SCOPE_MISMATCH -------------------------------------------
      const foreignArtifact = await this.prisma.mobileArtifact.findFirst({
        where: { applicationId: app.id, tenantId: { not: app.tenantId } },
      });
      if (foreignArtifact) {
        findings.push({
          code: RECONCILIATION_CODES.TENANT_SCOPE_MISMATCH,
          severity: 'CRITICAL',
          subjectType: 'MobileArtifact',
          subjectId: foreignArtifact.id,
          detail: { appTenantId: app.tenantId, artifactTenantId: foreignArtifact.tenantId },
        });
      }
    }

    // ---- ORPHAN_ROLLOUT: rollouts whose app is not in the scanned scope ----
    const appIds = new Set(apps.map((a) => a.id));
    const allRollouts = await this.prisma.mobileReleaseRollout.findMany({
      ...(tenantId ? { where: { tenantId } } : {}),
    });
    for (const rollout of allRollouts) {
      if (!appIds.has(rollout.applicationId)) {
        findings.push({
          code: RECONCILIATION_CODES.ORPHAN_ROLLOUT,
          severity: 'CRITICAL',
          subjectType: 'MobileReleaseRollout',
          subjectId: rollout.id,
          detail: { applicationId: rollout.applicationId },
        });
      }
    }

    // ---- persist idempotently ---------------------------------------------
    let persisted = 0;
    for (const finding of findings) {
      const existing = await this.prisma.mobileReconciliationFinding.findUnique({
        where: {
          runId_code_subjectId: {
            runId,
            code: finding.code,
            subjectId: finding.subjectId,
          },
        },
      });
      if (existing) continue;
      await this.prisma.mobileReconciliationFinding.create({
        data: {
          runId,
          tenantId,
          code: finding.code,
          severity: finding.severity,
          subjectType: finding.subjectType,
          subjectId: finding.subjectId,
          detail: finding.detail as unknown as Prisma.InputJsonValue,
        },
      });
      persisted += 1;
    }

    return {
      runId,
      startedAt: new Date().toISOString(),
      findings,
      persisted,
      idempotentReplay: findings.length > 0 && persisted === 0,
    };
  }

  /**
   * Consistency between a release's state and its recorded store state. The
   * external store is never written — a mismatch is REPORTED for an operator
   * to resolve against provider truth.
   */
  private storeStateConsistent(releaseState: string, storeState: string): boolean {
    const pairs: Record<string, string[]> = {
      APPROVED: ['NOT_CONFIGURED', 'CONFIGURED'],
      SUBMITTING: ['CONFIGURED', 'SUBMISSION_PENDING'],
      SUBMITTED: ['SUBMISSION_PENDING', 'SUBMITTED', 'UNAVAILABLE'],
      PUBLISHED: ['SUBMITTED', 'PUBLISHED'],
      ROLLED_OUT: ['SUBMITTED', 'PUBLISHED'],
      HALTED: ['SUBMITTED', 'PUBLISHED', 'REJECTED', 'UNAVAILABLE'],
      ROLLED_BACK: ['SUBMITTED', 'PUBLISHED', 'REJECTED'],
      REJECTED: ['REJECTED', 'SUBMITTED'],
      DRAFT: ['NOT_CONFIGURED', 'CONFIGURED'],
      REVIEW: ['NOT_CONFIGURED', 'CONFIGURED'],
      APPROVAL_REQUIRED: ['NOT_CONFIGURED', 'CONFIGURED'],
    };
    return (pairs[releaseState] ?? []).includes(storeState);
  }

  /** Findings of one run, newest first. */
  async findingsOfRun(runId: string): Promise<Array<Record<string, unknown>>> {
    return (await this.prisma.mobileReconciliationFinding.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    })) as unknown as Array<Record<string, unknown>>;
  }

  async mustGetRunScope(tenantId: string | null): Promise<void> {
    if (!tenantId) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.FORBIDDEN,
        'platform-wide reconciliation requires platform scope',
        403,
      );
    }
  }
}
