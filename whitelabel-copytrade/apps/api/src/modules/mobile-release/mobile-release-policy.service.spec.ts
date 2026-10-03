import { MobileReleasePolicyService, type MobileEnvReader } from './mobile-release-policy.service';

function envOf(values: Record<string, string | undefined>): MobileEnvReader {
  return { get: (key: string) => values[key] };
}

describe('MobileReleasePolicyService', () => {
  describe('enabledStoreProviders', () => {
    it('defaults to the self-hosted distribution providers when unset', () => {
      const policy = new MobileReleasePolicyService(envOf({})).resolve();
      expect(policy.enabledStoreProviders).toEqual(['ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION']);
    });

    it('treats a blank value as unset', () => {
      const policy = new MobileReleasePolicyService(envOf({ MOBILE_STORE_PROVIDERS: '   ' })).resolve();
      expect(policy.enabledStoreProviders).toEqual(['ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION']);
    });

    it('parses the comma-separated env string into a real array', () => {
      const policy = new MobileReleasePolicyService(
        envOf({ MOBILE_STORE_PROVIDERS: ' google_play , APPLE_APP_STORE,GOOGLE_PLAY ' }),
      ).resolve();
      expect(policy.enabledStoreProviders).toEqual(['GOOGLE_PLAY', 'APPLE_APP_STORE']);
    });

    it('does not substring-match: a single provider does not enable its prefixes', () => {
      const policy = new MobileReleasePolicyService(
        envOf({ MOBILE_STORE_PROVIDERS: 'INTERNAL_DISTRIBUTION' }),
      ).resolve();
      expect(policy.enabledStoreProviders).toEqual(['INTERNAL_DISTRIBUTION']);
      expect(policy.enabledStoreProviders.includes('ENTERPRISE_DISTRIBUTION')).toBe(false);
    });

    it('fails loudly on an unknown provider name', () => {
      const service = new MobileReleasePolicyService(envOf({ MOBILE_STORE_PROVIDERS: 'GOOGLE_PLAY,HUAWEI' }));
      expect(() => service.resolve()).toThrow(/unknown provider\(s\) HUAWEI/);
    });

    it('lets an explicit override win over the environment', () => {
      const policy = new MobileReleasePolicyService(
        envOf({ MOBILE_STORE_PROVIDERS: 'GOOGLE_PLAY' }),
      ).resolve({ enabledStoreProviders: ['APPLE_APP_STORE'] });
      expect(policy.enabledStoreProviders).toEqual(['APPLE_APP_STORE']);
    });
  });

  describe('numeric knobs', () => {
    it('uses in-code defaults when unset', () => {
      const policy = new MobileReleasePolicyService(envOf({})).resolve();
      expect(policy.maxBuildsPerAppPerDay).toBe(12);
      expect(policy.buildTimeoutMinutes).toBe(45);
      expect(policy.reconciliationArtifactLimit).toBe(100);
    });

    it('ignores non-positive values rather than disabling a limit', () => {
      const policy = new MobileReleasePolicyService(
        envOf({ MOBILE_MAX_BUILDS_PER_APP_PER_DAY: '0', MOBILE_BUILD_TIMEOUT_MINUTES: '-5' }),
      ).resolve();
      expect(policy.maxBuildsPerAppPerDay).toBe(12);
      expect(policy.buildTimeoutMinutes).toBe(45);
    });
  });
});
