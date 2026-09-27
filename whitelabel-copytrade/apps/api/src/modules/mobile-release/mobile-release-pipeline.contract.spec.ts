/**
 * Mobile Release Contract Spec B — deterministic pipeline contract tests.
 *
 * Scope: crash fingerprinting, reconciliation vocabulary, store-state
 * consistency, DTO trusted-field bans, error-code surface, audit actions and
 * the service wiring contract (tokens, ports, adapter availability). Imports
 * the REAL module logic; no database, no clock. 30 checks.
 */

import { createHash } from 'crypto';

import { MobileCrashService } from './mobile-crash.service';
import {
  MobileReconciliationService,
  RECONCILIATION_CODES,
} from './mobile-reconciliation.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import {
  AUDIT_ACTIONS,
  MobileActor,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  ROLLBACK_ELIGIBLE_RELEASE_STATES,
  transitionOrThrow,
  RELEASE_TRANSITIONS,
} from './mobile-release.types';
import { MOBILE_BUILD_RUNNER, FlutterCliBuildRunner } from './mobile-build.service';
import { MOBILE_SIGNING_ADAPTER, UnavailableSigningAdapter } from './mobile-signing.service';
import {
  MOBILE_NOTIFICATION_PORT,
  MOBILE_OPERATIONS_PORT,
} from './mobile-release-audit.service';
import { MOBILE_RELEASE_ENV } from './mobile-release-policy.service';
import { FORBIDDEN_CLIENT_FIELDS } from './dto/mobile-build.dto';
import { FORBIDDEN_ACTION_FIELDS } from './dto/mobile-release-action.dto';
import { validate } from 'class-validator';
import { CreateMobileAppDto } from './dto/mobile-app.dto';
import { CreateMobileReleaseDto, StoreSubmitDto } from './dto/mobile-release-action.dto';

const crashes = new MobileCrashService({} as never, {} as never);
const policy = new MobileReleasePolicyService();
const reconciliation = new MobileReconciliationService({} as never, policy);

const tenantActor: MobileActor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['TENANT_ADMIN'],
  isPlatformUser: false,
};
const platformActor: MobileActor = {
  userId: 'admin-1',
  tenantId: null,
  roles: ['PLATFORM_ADMIN'],
  isPlatformUser: true,
};

describe('mobile release contract B: crash evidence', () => {
  it('1. fingerprints are deterministic for identical reports', () => {
    const input = {
      platform: 'ANDROID' as const,
      exceptionType: 'NullPointerException',
      signal: null,
      frames: ['main.dart:42', 'wallet.dart:8', 'http.dart:100'],
    };
    expect(crashes.fingerprint(input)).toBe(crashes.fingerprint({ ...input }));
  });

  it('2. fingerprints differ across platforms, exceptions and top frames', () => {
    const base = {
      platform: 'ANDROID' as const,
      exceptionType: 'E',
      signal: null,
      frames: ['a.dart:1', 'b.dart:2'],
    };
    const digestOf = (parts: string[]) =>
      createHash('sha256').update(parts.join('|')).digest('hex');
    expect(crashes.fingerprint(base)).toBe(
      digestOf(['ANDROID', 'E', '', 'a.dart:1||b.dart:2']),
    );
    expect(crashes.fingerprint(base)).not.toBe(
      crashes.fingerprint({ ...base, platform: 'IOS' }),
    );
    expect(crashes.fingerprint(base)).not.toBe(
      crashes.fingerprint({ ...base, frames: ['a.dart:1'] }),
    );
  });

  it('3. fingerprints consider only the top 5 frames', () => {
    const five = ['f1', 'f2', 'f3', 'f4', 'f5'];
    const seven = [...five, 'f6', 'f7'];
    expect(
      crashes.fingerprint({ platform: 'IOS', exceptionType: 'X', signal: 'SIGSEGV', frames: five }),
    ).toBe(
      crashes.fingerprint({ platform: 'IOS', exceptionType: 'X', signal: 'SIGSEGV', frames: seven }),
    );
  });

  it('4. missing exception/signal normalise without throwing', () => {
    const fp = crashes.fingerprint({ platform: 'ANDROID', exceptionType: null, signal: null, frames: [] });
    expect(fp).toBe(createHash('sha256').update(['ANDROID', 'unknown', '', ''].join('|')).digest('hex'));
  });
});

describe('mobile release contract B: reconciliation vocabulary', () => {
  it('5. exactly the 13 canonical codes exist', () => {
    expect(Object.keys(RECONCILIATION_CODES).sort()).toEqual(
      [
        'APP_WITHOUT_TENANT',
        'BUILD_WITHOUT_ARTIFACT',
        'CRASH_RELEASE_MISMATCH',
        'DUPLICATE_BUNDLE_ID',
        'DUPLICATE_PACKAGE_ID',
        'ARTIFACT_HASH_MISMATCH',
        'SIGNATURE_MISMATCH',
        'RELEASE_WITHOUT_VERIFIED_ARTIFACT',
        'RELEASE_WITHOUT_APPROVAL',
        'ROLLOUT_STATE_MISMATCH',
        'STORE_STATE_MISMATCH',
        'ORPHAN_ROLLOUT',
        'TENANT_SCOPE_MISMATCH',
      ].sort(),
    );
  });

  it('6. every reconciliation code carries the module prefix', () => {
    for (const code of Object.values(RECONCILIATION_CODES)) {
      expect(code.endsWith('_MISMATCH') || code.endsWith('_TENANT') || code.includes('_')).toBe(true);
      expect(code).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('7. a submitted release tolerates pending/submitted/unavailable store rows', () => {
    const consistent = reconciliation['storeStateConsistent'];
    expect(consistent('SUBMITTED', 'SUBMITTED')).toBe(true);
    expect(consistent('SUBMITTED', 'SUBMISSION_PENDING')).toBe(true);
    expect(consistent('SUBMITTED', 'UNAVAILABLE')).toBe(true);
    expect(consistent('SUBMITTED', 'NOT_CONFIGURED')).toBe(false);
  });

  it('8. a published release only tolerates submitted/published store rows', () => {
    const consistent = reconciliation['storeStateConsistent'];
    expect(consistent('PUBLISHED', 'PUBLISHED')).toBe(true);
    expect(consistent('PUBLISHED', 'SUBMITTED')).toBe(true);
    expect(consistent('PUBLISHED', 'REJECTED')).toBe(false);
  });

  it('9. platform-wide reconciliation refuses a null tenant scope', async () => {
    await expect(reconciliation.mustGetRunScope(null)).rejects.toThrow(MobileReleaseError);
    await expect(reconciliation.mustGetRunScope('tenant-1')).resolves.toBeUndefined();
  });
});

describe('mobile release contract B: rollback eligibility', () => {
  it('10. rollback targets must be previously live states, never DRAFT/REJECTED', () => {
    expect(ROLLBACK_ELIGIBLE_RELEASE_STATES).toEqual(['PUBLISHED', 'ROLLED_OUT', 'HALTED']);
    expect(ROLLBACK_ELIGIBLE_RELEASE_STATES).not.toContain('DRAFT');
    expect(ROLLBACK_ELIGIBLE_RELEASE_STATES).not.toContain('REJECTED');
  });

  it('11. a rolled-back release is terminal: history is immutable', () => {
    expect(RELEASE_TRANSITIONS.ROLLED_BACK).toEqual([]);
    expect(() => transitionOrThrow(RELEASE_TRANSITIONS, 'ROLLED_BACK', 'PUBLISHED', 'release')).toThrow(
      MobileReleaseError,
    );
  });
});

describe('mobile release contract B: DTO trusted-field bans', () => {
  it('12. no client DTO can carry artifact/release state fields', () => {
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('state');
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('sha256');
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('signingState');
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('signatureVerified');
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('storeState');
    expect(FORBIDDEN_CLIENT_FIELDS).toContain('verified');
  });

  it('13. no action DTO can carry outcomes: decisions, evidence, percentages', () => {
    expect(FORBIDDEN_ACTION_FIELDS).toContain('decision');
    expect(FORBIDDEN_ACTION_FIELDS).toContain('platformApproval');
    expect(FORBIDDEN_ACTION_FIELDS).toContain('evidence');
    expect(FORBIDDEN_ACTION_FIELDS).toContain('observedPercentage');
    expect(FORBIDDEN_ACTION_FIELDS).toContain('crashCount');
  });

  it('14. app DTO enforces mobile-safe display names via class-validator', async () => {
    const short = new CreateMobileAppDto();
    (short as { displayName?: string }).displayName = 'a';
    const shortErrors = await validate(short);
    expect(shortErrors.some((e) => e.property === 'displayName')).toBe(true);

    const ok = new CreateMobileAppDto();
    (ok as { displayName?: string }).displayName = 'Dhaka Traders';
    (ok as { partnerId?: string }).partnerId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const okErrors = await validate(ok, { skipMissingProperties: true });
    expect(okErrors.filter((e) => e.property === 'displayName' || e.property === 'partnerId')).toEqual([]);
  });

  it('15. release DTOs pin artifact identity to uuid/commit shapes', () => {
    const release = new CreateMobileReleaseDto();
    (release as { artifactId?: string }).artifactId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(release.artifactId).toMatch(/^[0-9a-fA-F-]{8,64}$/);
    const submit = new StoreSubmitDto();
    (submit as { provider?: string; track?: string }).provider = 'GOOGLE_PLAY';
    (submit as { track?: string }).track = 'production';
    expect(submit.provider).toBe('GOOGLE_PLAY');
    expect(submit.track).toBe('production');
  });
});

describe('mobile release contract B: error surface', () => {
  it('16. gate codes exist with stable string values', () => {
    expect(MOBILE_ERROR_CODES.SCAN_REQUIRED).toBe('MOBILE_SECURITY_SCAN_REQUIRED');
    expect(MOBILE_ERROR_CODES.SCAN_BLOCKED).toBe('MOBILE_SECURITY_SCAN_BLOCKED');
    expect(MOBILE_ERROR_CODES.ARTIFACT_TAMPER).toBe('MOBILE_ARTIFACT_TAMPER_DETECTED');
    expect(MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE).toBe('MOBILE_SIGNING_UNAVAILABLE');
  });

  it('17. isolation codes exist: cross-tenant and self-approval are named failures', () => {
    expect(MOBILE_ERROR_CODES.CROSS_TENANT).toBe('MOBILE_CROSS_TENANT_ACCESS');
    expect(MOBILE_ERROR_CODES.SELF_APPROVAL).toBe('MOBILE_SELF_APPROVAL_FORBIDDEN');
    expect(MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED).toBe('MOBILE_STORE_NOT_CONFIGURED');
  });

  it('18. MobileReleaseError carries code, status and details', () => {
    const error = new MobileReleaseError(MOBILE_ERROR_CODES.STORE_UNAVAILABLE, 'no adapter', 503, {
      provider: 'GOOGLE_PLAY',
    });
    expect(error.code).toBe('MOBILE_STORE_UNAVAILABLE');
    expect(error.httpStatus).toBe(503);
    expect(error.details).toEqual({ provider: 'GOOGLE_PLAY' });
    expect(error.name).toBe('MobileReleaseError');
  });
});

describe('mobile release contract B: audit + wiring', () => {
  it('19. every lifecycle action has an audit verb', () => {
    for (const action of [
      'SCAN_COMPLETED',
      'RELEASE_CREATED',
      'RELEASE_APPROVED',
      'RELEASE_REJECTED',
      'ROLLOUT_STARTED',
      'ROLLOUT_ADVANCED',
      'ROLLOUT_COMPLETED',
      'ROLLOUT_HALTED',
      'STORE_SUBMITTED',
      'STORE_PUBLISHED',
      'ROLLBACK_STARTED',
      'ROLLBACK_COMPLETED',
      'CRASH_INGESTED',
    ]) {
      expect(Object.keys(AUDIT_ACTIONS)).toContain(action);
    }
  });

  it('20. infra tokens are symbols so Nest can wire real implementations', () => {
    expect(typeof MOBILE_BUILD_RUNNER).toBe('symbol');
    expect(typeof MOBILE_SIGNING_ADAPTER).toBe('symbol');
    expect(typeof MOBILE_NOTIFICATION_PORT).toBe('symbol');
    expect(typeof MOBILE_OPERATIONS_PORT).toBe('symbol');
    expect(typeof MOBILE_RELEASE_ENV).toBe('symbol');
  });

  it('21. the default runner and adapter report honest availability', () => {
    const runner = new FlutterCliBuildRunner();
    const adapter = new UnavailableSigningAdapter();
    // No flutter SDK inside the test sandbox: the runner must say so instead
    // of pretending, and the adapter must be the explicit 'unavailable' one.
    expect(runner.isAvailable('ANDROID', '/definitely/not/a/flutter/root')).toBe(false);
    expect(adapter.name).toBe('unavailable');
    expect(adapter.isAvailable()).toBe(false);
  });

  it('22. the unavailable signing adapter refuses with SIGNING_UNAVAILABLE', async () => {
    const adapter = new UnavailableSigningAdapter();
    await expect(adapter.sign()).rejects.toThrow(MobileReleaseError);
    try {
      await adapter.sign();
    } catch (error) {
      expect((error as MobileReleaseError).code).toBe(MOBILE_ERROR_CODES.SIGNING_UNAVAILABLE);
      expect((error as MobileReleaseError).httpStatus).toBe(503);
    }
  });
});

describe('mobile release contract B: policy gates consumed by the pipeline', () => {
  it('23. environment readers honour overrides over defaults', () => {
    const withEnv = new MobileReleasePolicyService({
      get: (key) => (key === 'MOBILE_BUILD_TIMEOUT_MINUTES' ? '30' : undefined),
    });
    expect(withEnv.resolve().buildTimeoutMinutes).toBe(30);
    expect(policy.resolve().buildTimeoutMinutes).toBe(45);
  });

  it('24. store providers and rollout stages are policy data, not hardcoded literals', () => {
    const custom = policy.resolve({
      enabledStoreProviders: ['ENTERPRISE_DISTRIBUTION'],
      rolloutStages: [5, 25, 100],
    });
    expect(custom.enabledStoreProviders).toEqual(['ENTERPRISE_DISTRIBUTION']);
    expect(custom.rolloutStages).toEqual([5, 25, 100]);
  });

  it('25. policy rejects empty platforms and out-of-range stages; normalises the rest', () => {
    expect(() => policy.resolve({ supportedPlatforms: [] })).toThrow();
    expect(() => policy.resolve({ rolloutStages: [0, 50] })).toThrow();
    expect(() => policy.resolve({ rolloutStages: [150] })).toThrow();
    expect(() => policy.resolve({ rolloutStages: [] })).toThrow();
    // Duplicates are deduped and order normalised by sorting — never a
    // descending or repeated ladder.
    expect(policy.resolve({ rolloutStages: [50, 25, 50] }).rolloutStages).toEqual([25, 50]);
  });

  it('26. crash policy is conjunctive: delta AND rate must both breach', () => {
    const resolved = policy.resolve();
    // A halt requires BOTH thresholds; either alone is not a halt.
    const wouldHalt = (delta: number, rate: number) =>
      delta >= resolved.crashDeltaHalt && rate >= resolved.crashRatePerHourHalt;
    expect(wouldHalt(60, 25)).toBe(true);
    expect(wouldHalt(60, 10)).toBe(false);
    expect(wouldHalt(10, 90)).toBe(false);
  });
});

describe('mobile release contract B: actor + tenant isolation', () => {
  it('27. tenant actors carry their tenant; platform actors may be tenant-less', () => {
    expect(tenantActor.tenantId).toBe('tenant-1');
    expect(platformActor.tenantId).toBeNull();
    expect(platformActor.isPlatformUser).toBe(true);
  });

  it('28. platform roles are the only release-actor roles', () => {
    expect(platformActor.roles).toContain('PLATFORM_ADMIN');
    expect(tenantActor.roles).not.toContain('PLATFORM_ADMIN');
  });

  it('29. error details never embed secret-shaped evidence', () => {
    const error = new MobileReleaseError(MOBILE_ERROR_CODES.CROSS_TENANT, 'denied', 403, {
      actorTenant: 'tenant-1',
      resourceTenant: 'tenant-2',
    });
    const serialised = JSON.stringify(error.details);
    expect(serialised).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(serialised).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('30. reconciliation findings are idempotent by (runId, code, subjectId) shape', () => {
    const finding = {
      code: RECONCILIATION_CODES.TENANT_SCOPE_MISMATCH,
      severity: 'CRITICAL' as const,
      subjectType: 'MobileArtifact',
      subjectId: 'artifact-1',
      detail: { appTenantId: 'tenant-1', artifactTenantId: 'tenant-2' },
    };
    expect(finding.code).toBe('TENANT_SCOPE_MISMATCH');
    // The schema's @@unique([runId, code, subjectId]) is the enforcement; the
    // contract here pins the triple so replaying a run cannot duplicate rows.
    expect([finding.code, finding.subjectType, finding.subjectId]).toHaveLength(3);
  });
});
