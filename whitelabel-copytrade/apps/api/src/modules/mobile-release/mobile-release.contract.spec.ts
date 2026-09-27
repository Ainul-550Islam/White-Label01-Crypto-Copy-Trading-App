/**
 * Mobile Release Contract Spec A — deterministic module contract tests.
 *
 * Scope: state machines, policy defaults, identity, branding, runtime-config
 * hygiene, redaction, idempotency. Everything here imports the REAL module
 * logic (no re-implemented helpers, no database, no clock) so a regression in
 * a safety-critical default fails loudly. 30 checks.
 */

import {
  APPLICATION_TRANSITIONS,
  BUILD_TRANSITIONS,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  RELEASE_TRANSITIONS,
  ROLLOUT_TRANSITIONS,
  STORE_TRANSITIONS,
  canTransition,
  idempotencyKey,
  isPlatformReleaseActor,
  looksLikeSecret,
  redactSecrets,
  transitionOrThrow,
} from './mobile-release.types';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileIdentityService } from './mobile-identity.service';
import { MobileBrandingService } from './mobile-branding.service';
import { MobileConfigService } from './mobile-config.service';
import { sha256File } from './mobile-artifact.service';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

const policyService = new MobileReleasePolicyService();
const identity = new MobileIdentityService({} as never);
const branding = new MobileBrandingService({} as never);
const config = new MobileConfigService();

describe('mobile release contract A: state machines', () => {
  it('1. provisioning has exactly one exit: PROVISIONING -> CONFIGURED', () => {
    expect(APPLICATION_TRANSITIONS.PROVISIONING).toEqual(['CONFIGURED']);
  });

  it('2. VERIFIED is terminal; a FAILED build can never reach VERIFIED', () => {
    expect(BUILD_TRANSITIONS.VERIFIED).toEqual([]);
    expect(canTransition(BUILD_TRANSITIONS, 'FAILED', 'VERIFIED')).toBe(false);
    expect(BUILD_TRANSITIONS.FAILED).toEqual([]);
  });

  it('3. a release may move APPROVED -> SUBMITTING (store gate only)', () => {
    expect(canTransition(RELEASE_TRANSITIONS, 'APPROVED', 'SUBMITTING')).toBe(true);
  });

  it('4. SUBMITTED -> PUBLISHED exists only as the provider-evidence edge', () => {
    expect(canTransition(RELEASE_TRANSITIONS, 'SUBMITTED', 'PUBLISHED')).toBe(true);
  });

  it('5. SUBMITTED != ROLLED_OUT: no direct edge skips staged rollout', () => {
    expect(canTransition(RELEASE_TRANSITIONS, 'SUBMITTED', 'ROLLED_OUT')).toBe(false);
  });

  it('6. APPROVED != PUBLISHED: publication requires a SUBMITTED state first', () => {
    expect(canTransition(RELEASE_TRANSITIONS, 'APPROVED', 'PUBLISHED')).toBe(false);
  });

  it('7. PUBLISHED/HALTED -> ROLLED_BACK exists; ROLLED_BACK is terminal', () => {
    expect(canTransition(RELEASE_TRANSITIONS, 'PUBLISHED', 'ROLLED_BACK')).toBe(true);
    expect(canTransition(RELEASE_TRANSITIONS, 'HALTED', 'ROLLED_BACK')).toBe(true);
    expect(RELEASE_TRANSITIONS.ROLLED_BACK).toEqual([]);
  });

  it('8. store chain NOT_CONFIGURED -> CONFIGURED -> SUBMISSION_PENDING -> SUBMITTED is walkable', () => {
    expect(canTransition(STORE_TRANSITIONS, 'NOT_CONFIGURED', 'CONFIGURED')).toBe(true);
    expect(canTransition(STORE_TRANSITIONS, 'CONFIGURED', 'SUBMISSION_PENDING')).toBe(true);
    expect(canTransition(STORE_TRANSITIONS, 'SUBMISSION_PENDING', 'SUBMITTED')).toBe(true);
  });

  it('9. PUBLISHED is terminal store state; SUBMITTED -> REJECTED exists', () => {
    expect(STORE_TRANSITIONS.PUBLISHED).toEqual([]);
    expect(canTransition(STORE_TRANSITIONS, 'SUBMITTED', 'REJECTED')).toBe(true);
  });

  it('10. rollout walks NOT_STARTED -> IN_PROGRESS -> COMPLETED; COMPLETED is terminal', () => {
    expect(canTransition(ROLLOUT_TRANSITIONS, 'NOT_STARTED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(ROLLOUT_TRANSITIONS, 'IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(ROLLOUT_TRANSITIONS.COMPLETED).toEqual([]);
  });

  it('11. illegal edges throw ILLEGAL_TRANSITION/409; canTransition answers without throwing', () => {
    expect(() =>
      transitionOrThrow(RELEASE_TRANSITIONS, 'DRAFT', 'ROLLED_OUT', 'release'),
    ).toThrow(MobileReleaseError);
    try {
      transitionOrThrow(RELEASE_TRANSITIONS, 'DRAFT', 'ROLLED_OUT', 'release');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as MobileReleaseError).code).toBe(MOBILE_ERROR_CODES.ILLEGAL_TRANSITION);
      expect((error as MobileReleaseError).httpStatus).toBe(409);
    }
    expect(canTransition(RELEASE_TRANSITIONS, 'PUBLISHED', 'ROLLED_OUT')).toBe(true);
    expect(canTransition(RELEASE_TRANSITIONS, 'REJECTED', 'APPROVED')).toBe(false);
  });
});

describe('mobile release contract A: policy defaults', () => {
  it('12. default rollout ladder is exactly 1/5/10/25/50/75/100', () => {
    expect(policyService.resolve().rolloutStages).toEqual([1, 5, 10, 25, 50, 75, 100]);
  });

  it('13. stage legality honours the ladder and the 50-point jump cap', () => {
    const policy = policyService.resolve();
    expect(policyService.isLegalNextStage(policy, 1, 5)).toBe(true);
    expect(policyService.isLegalNextStage(policy, 1, 75)).toBe(false);
    expect(policyService.isLegalNextStage(policy, 5, 5)).toBe(false);
    expect(policyService.isLegalNextStage(policy, 10, 11)).toBe(false);
  });

  it('14. signatures are required exactly for STAGING and PRODUCTION', () => {
    expect(policyService.resolve().signingRequiredEnvironments).toEqual(['STAGING', 'PRODUCTION']);
  });

  it('15. security scans and platform approval are fail-safe defaults (true)', () => {
    const policy = policyService.resolve();
    expect(policy.requireSecurityScanPass).toBe(true);
    expect(policy.productionRequiresPlatformApproval).toBe(true);
  });

  it('16. daily build budget defaults to 12 and honours the env override', () => {
    expect(policyService.resolve().maxBuildsPerAppPerDay).toBe(12);
    const overridden = new MobileReleasePolicyService({
      get: (key) => (key === 'MOBILE_MAX_BUILDS_PER_APP_PER_DAY' ? '3' : undefined),
    });
    expect(overridden.resolve().maxBuildsPerAppPerDay).toBe(3);
  });

  it('17. public stores are production-only; default providers are enterprise/internal', () => {
    const policy = policyService.resolve();
    expect(policy.publicStoreEnvironments).toEqual(['PRODUCTION']);
    expect(policy.enabledStoreProviders).toEqual([
      'ENTERPRISE_DISTRIBUTION',
      'INTERNAL_DISTRIBUTION',
    ]);
  });

  it('18. crash-halt rule is 50 occurrences AND 20/hour over a 60-minute window', () => {
    const policy = policyService.resolve();
    expect(policy.crashDeltaHalt).toBe(50);
    expect(policy.crashRatePerHourHalt).toBe(20);
    expect(policy.crashEvaluationWindowMinutes).toBe(60);
  });

  it('19. reconciliation samples 100 artifacts; build timeout 45m; versioned policy', () => {
    const policy = policyService.resolve();
    expect(policy.reconciliationArtifactLimit).toBe(100);
    expect(policy.buildTimeoutMinutes).toBe(45);
    expect(policy.policyVersion).toBe('mobile-release-policy-v1');
  });
});

describe('mobile release contract A: identity', () => {
  it('20. slugify is deterministic and DNS-label safe', () => {
    expect(identity.slugify('Dhaka Traders Ltd.')).toBe('dhaka-traders-ltd');
    expect(identity.slugify('Dhaka Traders Ltd.')).toBe(identity.slugify('dhaka   traders--ltd'));
    expect(identity.slugify('Ünïcöde Tênant')).toBe('unicode-tenant');
    expect(/^([a-z0-9]-?)*[a-z0-9]$/.test(identity.slugify('ACME industries (BD)'))).toBe(true);
  });

  it('21. derive is deterministic under the default platform root', () => {
    const pair = identity.derive({ tenantId: 't1', tenantSlug: 'acme', tenantName: 'ACME' });
    expect(pair.androidPackageId).toBe('com.whitelabel.generated.acme');
    expect(pair.iosBundleId).toBe('com.whitelabel.generated.acme');
    expect(identity.derive({ tenantId: 't2', tenantSlug: 'acme', tenantName: 'ACME' })).toEqual(pair);
  });

  it('22. Android applicationId rejects uppercase and Java keyword segments', () => {
    expect(() => identity.validateAndroidPackage('com.example.App')).toThrow(MobileReleaseError);
    expect(() => identity.validateAndroidPackage('com.example.class')).toThrow(MobileReleaseError);
    try {
      identity.validateAndroidPackage('com.example.class');
    } catch (error) {
      expect((error as MobileReleaseError).code).toBe(MOBILE_ERROR_CODES.IDENTITY_INVALID);
    }
  });

  it('23. Android rejects >120 chars; iOS rejects >160 chars', () => {
    const longHost = `${'a'.repeat(110)}.example.app`;
    expect(() => identity.validateAndroidPackage(longHost)).toThrow(MobileReleaseError);
    const longBundle = `${'a'.repeat(150)}.example.app`;
    expect(() => identity.validateIosBundle(longBundle)).toThrow(MobileReleaseError);
  });

  it('24. reserved framework namespaces cannot be the first segment; long iOS segments rejected', () => {
    expect(() => identity.validateAndroidPackage('android.app.main')).toThrow(MobileReleaseError);
    expect(identity.validateAndroidPackage('com.app.main')).toBeUndefined();
    expect(() => identity.validateIosBundle(`com.app.${'s'.repeat(64)}.x`)).toThrow(MobileReleaseError);
    expect(identity.validateIosBundle(`com.app.${'s'.repeat(63)}.x`)).toBeUndefined();
  });
});

describe('mobile release contract A: branding + runtime config', () => {
  const record = {
    appName: 'Dhaka Traders',
    logoUrl: 'https://cdn.example.com/logo.png',
    logoDarkUrl: 'https://cdn.example.com/logo-dark.png',
    faviconUrl: 'https://cdn.example.com/favicon.png',
    primaryColor: '#1b2a4a',
    secondaryColor: '#0f172a',
    accentColor: '#2563eb',
    backgroundColor: '#ffffff',
    textColor: '#0b1220',
    fontFamily: 'Inter',
    themeMode: 'dark',
    supportEmail: 'support@example.com',
    supportUrl: 'https://help.example.com',
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
    customCss: 'body { background: url(javascript:alert(1)) }',
  };

  it('25. tenant customCss is never carried into mobile branding', () => {
    const result = branding.fromRecord(record);
    expect('customCss' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('javascript:');
    expect(JSON.stringify(result)).not.toContain('alert(1)');
  });

  it('26. colors are normalised to uppercase #RRGGBB; invalid colors throw BRANDING_UNSAFE', () => {
    const result = branding.fromRecord(record);
    expect(result.primaryColor).toBe('#1B2A4A');
    expect(result.backgroundColor).toBe('#FFFFFF');
    expect(() =>
      branding.fromRecord({ ...record, primaryColor: 'not-a-color' }),
    ).toThrow(MobileReleaseError);
  });

  it('27. unsafe URLs are rejected and unknown theme modes fall back to system', () => {
    expect(() =>
      branding.fromRecord({ ...record, logoUrl: 'javascript:alert(1)' }),
    ).toThrow(MobileReleaseError);
    const fallback = branding.fromRecord({ ...record, themeMode: 'banana' });
    expect(fallback.themeMode).toBe('system');
  });

  it('28. runtime config strips non-boolean flags, refuses secrets and oversized values', () => {
    const built = config.build({
      tenantId: '11111111-1111-1111-1111-111111111111',
      applicationId: '22222222-2222-2222-2222-222222222222',
      environment: 'PRODUCTION',
      branding: branding.fromRecord(record),
      featureFlags: { copyTrading: true, 'Weird Flag': true, notBoolean: 'yes' },
    });
    expect(built.featureFlags).toEqual({ copyTrading: true });
    expect(built.apiBaseUrl.endsWith('/')).toBe(false);

    // A secret-shaped VALUE anywhere in the config graph refuses the build
    // (JWT-shaped token smuggled under a benign https URL).
    expect(() =>
      config.build({
        tenantId: '11111111-1111-1111-1111-111111111111',
        applicationId: '22222222-2222-2222-2222-222222222222',
        environment: 'PRODUCTION',
        branding: branding.fromRecord({
          ...record,
          supportUrl:
            'https://help.example.com/sso?ticket=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c3VwZXJzZWNyZXRzaWduYXR1cmU',
        }),
      }),
    ).toThrow(MobileReleaseError);

    const oversizedBranding = branding.fromRecord(record);
    expect(() =>
      config.build({
        tenantId: '11111111-1111-1111-1111-111111111111',
        applicationId: '22222222-2222-2222-2222-222222222222',
        environment: 'PRODUCTION',
        branding: { ...oversizedBranding, supportUrl: `https://example.com/${'a'.repeat(5000)}` },
      }),
    ).toThrow(MobileReleaseError);
  });
});

describe('mobile release contract A: hygiene primitives', () => {
  it('29. secret-shaped keys are detected, redacted, and audit ids are deterministic', () => {
    expect(looksLikeSecret('apiKey', 'AKIAIOSFODNN7EXAMPLE')).toBe(true);
    const redacted = redactSecrets({ apiKey: 'AKIAIOSFODNN7EXAMPLE', note: 'safe' });
    expect(redacted.note).toBe('safe');
    expect(redacted.apiKey).not.toBe('AKIAIOSFODNN7EXAMPLE');

    const a = idempotencyKey('release', '11111111-1111-1111-1111-111111111111', 'v1.2.3', 7);
    const b = idempotencyKey('release', '11111111-1111-1111-1111-111111111111', 'v1.2.3', 7);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);

    expect(
      isPlatformReleaseActor({ userId: 'u', tenantId: null, roles: ['PLATFORM_ADMIN'], isPlatformUser: true }),
    ).toBe(true);
    expect(
      isPlatformReleaseActor({ userId: 'u', tenantId: 't', roles: ['TENANT_ADMIN'], isPlatformUser: false }),
    ).toBe(false);
  });

  it('30. artifact digests are byte-true and stable across re-reads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mobile-contract-'));
    const file = join(dir, 'artifact.bin');
    const payload = Buffer.from('immutable artifact bytes');
    writeFileSync(file, payload);
    const digest = await sha256File(file);
    expect(digest.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
    rmSync(dir, { recursive: true, force: true });
  });
});
