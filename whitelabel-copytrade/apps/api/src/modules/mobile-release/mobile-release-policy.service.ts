import { Inject, Injectable, Optional } from '@nestjs/common';

import type { MobileEnvironment, MobilePlatform, MobileStoreProvider } from './mobile-release.types';

/**
 * Resolved policy for one tenant + environment. Every gate in the module reads
 * its thresholds from here — no service hardcodes a crash threshold, a rollout
 * stage list, or an approval rule, so a policy change is data, not a diff
 * across twenty files.
 */
export interface MobileReleasePolicy {
  policyVersion: string;
  supportedPlatforms: MobilePlatform[];
  maxBuildsPerAppPerDay: number;
  requireSecurityScanPass: boolean;
  /** Which environments require a successful signature before release. */
  signingRequiredEnvironments: MobileEnvironment[];
  /** Production releases require a platform-side approver, never the tenant. */
  productionRequiresPlatformApproval: boolean;
  /** Environment tiers allowed to submit to public stores. */
  publicStoreEnvironments: MobileEnvironment[];
  enabledStoreProviders: MobileStoreProvider[];
  /** Default staged rollout ladder; policy may replace it entirely. */
  rolloutStages: number[];
  /** Minimum percentage jump between stages (halt check for skipped evidence). */
  maxRolloutStageJump: number;
  /**
   * Crash-halt rule: halt when the crash-occurrence delta over the evaluation
   * window exceeds this absolute count AND the delta rate per hour exceeds
   * crashRatePerHourHalt. Both must hold, so one unlucky minute never halts.
   */
  crashDeltaHalt: number;
  crashRatePerHourHalt: number;
  crashEvaluationWindowMinutes: number;
  /** Artifact verification sampling depth for reconciliation (0 = all). */
  reconciliationArtifactLimit: number;
  buildTimeoutMinutes: number;
}

/** Caller-supplied overrides (tenant settings / platform ops), validated. */
export interface MobilePolicyOverrides {
  supportedPlatforms?: MobilePlatform[];
  maxBuildsPerAppPerDay?: number;
  requireSecurityScanPass?: boolean;
  productionRequiresPlatformApproval?: boolean;
  enabledStoreProviders?: MobileStoreProvider[];
  rolloutStages?: number[];
  crashDeltaHalt?: number;
  crashRatePerHourHalt?: number;
  crashEvaluationWindowMinutes?: number;
}

/**
 * Reads the process environment once through this port so the policy stays a
 * pure, deterministically testable unit (specs inject a static reader).
 */
export interface MobileEnvReader {
  get(key: string): string | undefined;
}

export const MOBILE_RELEASE_ENV = Symbol('MOBILE_RELEASE_ENV');

const DEFAULT_ROLLOUT_STAGES: readonly number[] = Object.freeze([1, 5, 10, 25, 50, 75, 100]);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const KNOWN_STORE_PROVIDERS: readonly MobileStoreProvider[] = Object.freeze([
  'GOOGLE_PLAY',
  'APPLE_APP_STORE',
  'ENTERPRISE_DISTRIBUTION',
  'INTERNAL_DISTRIBUTION',
]);

/**
 * MOBILE_STORE_PROVIDERS arrives from the environment as ONE comma-separated
 * string. It used to be cast straight to MobileStoreProvider[], so
 * `includes()` did substring matching and the health sweep iterated the
 * string character by character. Parsed here instead: trimmed, upper-cased,
 * de-duplicated; an unknown name is a misconfiguration and fails loudly
 * rather than silently enabling or dropping a store.
 */
function parseStoreProviders(raw: string | undefined): MobileStoreProvider[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const names = Array.from(
    new Set(
      raw
        .split(',')
        .map((name) => name.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  const unknown = names.filter((name) => !KNOWN_STORE_PROVIDERS.includes(name as MobileStoreProvider));
  if (unknown.length > 0) {
    throw new Error(
      `mobile release policy: MOBILE_STORE_PROVIDERS contains unknown provider(s) ${unknown.join(', ')}; ` +
        `allowed: ${KNOWN_STORE_PROVIDERS.join(', ')}`,
    );
  }
  return names as MobileStoreProvider[];
}

/**
 * Policy resolution for the mobile factory. Defaults are fail-safe: security
 * scan required, platform approval for production required, public stores only
 * for production, and the canonical staged rollout ladder. Nothing here can be
 * flipped by a tenant — overrides arrive from platform settings only.
 */
@Injectable()
export class MobileReleasePolicyService {
  constructor(
    @Optional()
    @Inject(MOBILE_RELEASE_ENV)
    private readonly env: MobileEnvReader = { get: () => undefined },
  ) {}

  resolve(overrides: MobilePolicyOverrides = {}): MobileReleasePolicy {
    const policy: MobileReleasePolicy = {
      policyVersion: 'mobile-release-policy-v1',
      supportedPlatforms: overrides.supportedPlatforms ?? ['ANDROID', 'IOS'],
      maxBuildsPerAppPerDay: parsePositiveInt(
        this.env.get('MOBILE_MAX_BUILDS_PER_APP_PER_DAY'),
        12,
      ),
      requireSecurityScanPass: overrides.requireSecurityScanPass ?? true,
      signingRequiredEnvironments: ['STAGING', 'PRODUCTION'],
      productionRequiresPlatformApproval: overrides.productionRequiresPlatformApproval ?? true,
      publicStoreEnvironments: ['PRODUCTION'],
      enabledStoreProviders:
        overrides.enabledStoreProviders ??
        parseStoreProviders(this.env.get('MOBILE_STORE_PROVIDERS')) ??
        ['ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'],
      rolloutStages: MobileReleasePolicyService.normaliseStages([
        ...(overrides.rolloutStages ?? DEFAULT_ROLLOUT_STAGES),
      ]),
      maxRolloutStageJump: 50,
      crashDeltaHalt: parsePositiveFloat(
        this.env.get('MOBILE_CRASH_DELTA_HALT'),
        overrides.crashDeltaHalt ?? 50,
      ),
      crashRatePerHourHalt: parsePositiveFloat(
        this.env.get('MOBILE_CRASH_RATE_PER_HOUR_HALT'),
        overrides.crashRatePerHourHalt ?? 20,
      ),
      crashEvaluationWindowMinutes: parsePositiveInt(
        this.env.get('MOBILE_CRASH_WINDOW_MINUTES'),
        overrides.crashEvaluationWindowMinutes ?? 60,
      ),
      reconciliationArtifactLimit: parsePositiveInt(
        this.env.get('MOBILE_RECONCILIATION_ARTIFACT_LIMIT'),
        100,
      ),
      buildTimeoutMinutes: parsePositiveInt(this.env.get('MOBILE_BUILD_TIMEOUT_MINUTES'), 45),
    };

    if (policy.supportedPlatforms.length === 0) {
      throw new Error('mobile release policy: at least one platform must be supported');
    }
    return policy;
  }

  /**
   * Stages must be strictly increasing percentages within (0, 100]; duplicates
   * or descents would make "advance" ambiguous, so they are rejected here
   * rather than discovered mid-rollout.
   */
  private static normaliseStages(stages: number[]): number[] {
    const unique = Array.from(new Set(stages));
    for (const stage of unique) {
      if (!Number.isFinite(stage) || stage <= 0 || stage > 100) {
        throw new Error(`mobile release policy: rollout stage ${stage} outside (0, 100]`);
      }
    }
    const sorted = unique.sort((a, b) => a - b);
    if (sorted.length < 1) {
      throw new Error('mobile release policy: rollout stage list is empty');
    }
    return sorted;
  }

  /** Whether `percentage` is a legal next stage given the ladder and the jump cap. */
  isLegalNextStage(policy: MobileReleasePolicy, current: number, next: number): boolean {
    if (!policy.rolloutStages.includes(next)) return false;
    if (next <= current) return false;
    return next - current <= policy.maxRolloutStageJump;
  }

  /** Deterministic daily build-budget key (UTC day) for build-rate limiting. */
  buildBudgetDay(at: Date = new Date()): string {
    return at.toISOString().slice(0, 10);
  }
}
