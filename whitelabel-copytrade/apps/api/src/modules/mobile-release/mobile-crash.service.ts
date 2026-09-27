import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  MobileActor,
  MobileReleaseError,
  MobilePlatform,
  MOBILE_ERROR_CODES,
  redactSecrets,
} from './mobile-release.types';
import { MobileReleaseAuditService } from './mobile-release-audit.service';

/**
 * Telemetry-source shape for a crash batch. Every field here must come from
 * the configured telemetry source (Sentry/Crashlytics export, or the app's
 * own crash reporter via the internal ingest endpoint). A payload without a
 * source reference is treated as fabricated and rejected — this module never
 * mints crash rows from imagination.
 */
export interface CrashReportInput {
  applicationId: string;
  platform: MobilePlatform;
  versionName: string;
  buildNumber: number;
  exceptionType?: string | null;
  signal?: string | null;
  /** Top frames, most-derived first, used for the fingerprint. */
  frames?: string[];
  /** Identifiers the telemetry provider actually supplies (never invented). */
  installationRef?: string | null;
  occurrenceCount?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  /** Provenance: 'app-reporter' | 'sentry-sync' | 'crashlytics-sync' | ... */
  source: string;
  /** Shared-secret evidence of the source (checked by the controller guard). */
  sourceReference?: string | null;
  /** Installation counts are stored ONLY when the provider supplies them. */
  affectedInstallations?: number | null;
  /** Server-resolved tenant scope; crash evidence never crosses tenants. */
  tenantId: string;
  actor?: MobileActor;
  correlationId?: string;
}

export interface CrashSummaryRow {
  fingerprint: string;
  exceptionType: string | null;
  versionName: string;
  buildNumber: number;
  occurrenceCount: number;
  affectedInstallations: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/**
 * Crash evidence normalization + release-health correlation.
 *
 * Fingerprints are deterministic (sha256 over platform|exception|signal|top
 * frames), so the same crash groups across reports and releases. Occurrence
 * counts come from the source; installation counts are stored ONLY when the
 * provider supplies them (`affectedInstallations` stays null otherwise) — the
 * monitor surfaces that distinction instead of inventing an install base.
 */
@Injectable()
export class MobileCrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  /** Deterministic crash fingerprint (stable across identical crashes). */
  fingerprint(input: Pick<CrashReportInput, 'platform' | 'exceptionType' | 'signal' | 'frames'>): string {
    return createHash('sha256')
      .update(
        [
          input.platform,
          (input.exceptionType ?? 'unknown').trim(),
          (input.signal ?? '').trim(),
          (input.frames ?? []).slice(0, 5).map((f) => f.trim()).join('||'),
        ].join('|'),
      )
      .digest('hex');
  }

  private assertPayload(input: CrashReportInput): void {
    if (!input.applicationId || !input.platform || !input.versionName) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CRASH_PAYLOAD,
        'crash report requires applicationId, platform and versionName',
        400,
      );
    }
    if (!Number.isInteger(input.buildNumber) || input.buildNumber <= 0) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CRASH_PAYLOAD,
        'crash report requires a positive buildNumber',
        400,
      );
    }
    if (!input.source) {
      // A crash with no provenance is fabricated data, and fabricated data is
      // exactly what release-health decisions must never consume.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CRASH_PAYLOAD,
        'crash report requires a telemetry source',
        400,
      );
    }
    if (input.occurrenceCount !== undefined && (!Number.isInteger(input.occurrenceCount) || input.occurrenceCount < 1)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CRASH_PAYLOAD,
        'occurrenceCount must be a positive integer when supplied',
        400,
      );
    }
  }

  /**
   * Ingests one normalized crash report. Correlates to the release/artifact by
   * (applicationId, platform, versionName, buildNumber); a report for a
   * version the platform never built is rejected as CRASH_RELEASE_MISMATCH —
   * telemetry for someone else's binary is noise at best, injection at worst.
   */
  async ingest(input: CrashReportInput): Promise<Record<string, unknown>> {
    this.assertPayload(input);
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'unknown application', 404);
    }

    const release = await this.prisma.mobileRelease.findFirst({
      where: {
        applicationId: input.applicationId,
        platform: input.platform,
        versionName: input.versionName,
        versionCode: input.buildNumber,
      },
    });
    if (!release) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.CRASH_MISMATCH,
        `no known release ${input.versionName}(${input.buildNumber}) for this application/platform; crash evidence refused`,
        404,
        { versionName: input.versionName, buildNumber: input.buildNumber },
      );
    }
    const artifact = await this.prisma.mobileArtifact.findUnique({ where: { id: release.artifactId } });

    const fp = this.fingerprint(input);
    const occurrenceDelta = input.occurrenceCount ?? 1;
    const key = createHash('sha256')
      .update([input.applicationId, input.platform, fp, input.versionName, input.buildNumber].join('|'))
      .digest('hex');

    const existing = await this.prisma.mobileCrashEvent.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      const updated = await this.prisma.mobileCrashEvent.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: existing.occurrenceCount + occurrenceDelta,
          affectedInstallations:
            input.affectedInstallations === undefined || input.installationRef === undefined
              ? input.affectedInstallations ?? existing.affectedInstallations
              : (input.affectedInstallations ?? existing.affectedInstallations),
          lastSeenAt: input.lastSeenAt ? new Date(input.lastSeenAt) : new Date(),
        },
      });
      return updated as unknown as Record<string, unknown>;
    }

    const row = await this.prisma.mobileCrashEvent.create({
      data: {
        applicationId: input.applicationId,
        tenantId: app.tenantId,
        platform: input.platform,
        releaseId: release.id,
        artifactId: artifact?.id ?? null,
        versionName: input.versionName,
        buildNumber: input.buildNumber,
        fingerprint: fp,
        exceptionType: input.exceptionType ?? null,
        signal: input.signal ?? null,
        source: input.source.slice(0, 64),
        occurrenceCount: occurrenceDelta,
        affectedInstallations: input.affectedInstallations ?? null,
        idempotencyKey: key,
        firstSeenAt: input.firstSeenAt ? new Date(input.firstSeenAt) : new Date(),
        lastSeenAt: input.lastSeenAt ? new Date(input.lastSeenAt) : new Date(),
      },
    });
    await this.audit.record({
      tenantId: app.tenantId,
      applicationId: app.id,
      releaseId: release.id,
      artifactId: artifact?.id ?? null,
      actor: input.actor ?? null,
      action: 'CRASH_INGESTED',
      platform: input.platform,
      version: input.versionName,
      correlationId: input.correlationId ?? undefined,
      evidence: redactSecrets({
        fingerprint: fp,
        source: input.source,
        occurrenceDelta,
      }) as Record<string, unknown>,
    });
    return row as unknown as Record<string, unknown>;
  }

  /**
   * Aggregated crash evidence for one release over a window. Returns counts
   * and (only when providers supplied them) installation coverage. The
   * `installCountsAvailable` flag is part of the evidence contract: a monitor
   * reading this cannot mistake "unknown" for "zero".
   */
  async releaseCrashEvidence(input: {
    releaseId: string;
    tenantId: string;
    windowMinutes?: number;
  }): Promise<{
    rows: CrashSummaryRow[];
    totalOccurrences: number;
    installCountsAvailable: boolean;
    windowMinutes: number;
  }> {
    const release = await this.prisma.mobileRelease.findFirst({
      where: { id: input.releaseId, tenantId: input.tenantId },
    });
    if (!release) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.RELEASE_NOT_FOUND, 'release not found', 404);
    }
    const windowMinutes = input.windowMinutes ?? 60;
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const events = await this.prisma.mobileCrashEvent.findMany({
      where: { releaseId: release.id, lastSeenAt: { gte: since } },
      orderBy: { occurrenceCount: 'desc' },
      take: 100,
    });
    const rows: CrashSummaryRow[] = events.map((e) => ({
      fingerprint: e.fingerprint,
      exceptionType: e.exceptionType,
      versionName: e.versionName,
      buildNumber: e.buildNumber,
      occurrenceCount: e.occurrenceCount,
      affectedInstallations: e.affectedInstallations,
      firstSeenAt: e.firstSeenAt instanceof Date ? e.firstSeenAt.toISOString() : String(e.firstSeenAt),
      lastSeenAt: e.lastSeenAt instanceof Date ? e.lastSeenAt.toISOString() : String(e.lastSeenAt),
    }));
    return {
      rows,
      totalOccurrences: rows.reduce((sum, r) => sum + r.occurrenceCount, 0),
      installCountsAvailable: rows.every((r) => r.affectedInstallations !== null) && rows.length > 0,
      windowMinutes,
    };
  }

  /**
   * Deterministic halt decision against policy thresholds. Both conditions
   * (absolute delta over window AND rate per hour) must hold, so a single
   * burst inside one minute cannot halt a rollout by itself.
   */
  evaluateHalt(input: {
    releaseId: string;
    tenantId: string;
    policy: { crashDeltaHalt: number; crashRatePerHourHalt: number; crashEvaluationWindowMinutes: number };
  }): Promise<HaltDecision> {
    return this.releaseCrashEvidence({
      releaseId: input.releaseId,
      tenantId: input.tenantId,
      windowMinutes: input.policy.crashEvaluationWindowMinutes,
    }).then((evidence) => {
      const delta = evidence.totalOccurrences;
      const ratePerHour = (delta / input.policy.crashEvaluationWindowMinutes) * 60;
      if (delta >= input.policy.crashDeltaHalt && ratePerHour >= input.policy.crashRatePerHourHalt) {
        return {
          halt: true,
          reason: `crash threshold exceeded: ${delta} occurrences in ${input.policy.crashEvaluationWindowMinutes}m (rate ${ratePerHour.toFixed(1)}/h exceeds ${input.policy.crashRatePerHourHalt}/h)`,
        } as HaltDecision;
      }
      return { halt: false, reason: null } as HaltDecision;
    });
  }
}

interface HaltDecision {
  halt: boolean;
  reason: string | null;
}
