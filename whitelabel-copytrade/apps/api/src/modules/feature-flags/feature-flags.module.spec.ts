// # Confirms feature flag service and enforcement guard are registered and the service is globally exported.
import { MODULE_METADATA } from '@nestjs/common/constants';
import { FeatureFlagsModule } from './feature-flags.module';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

describe('FeatureFlagsModule', () => {
  it('exports the flag resolver and provides its guard', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      FeatureFlagsModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, FeatureFlagsModule) as unknown[];
    expect(providers).toContain(FeatureFlagGuard);
    expect(exports).toContain(FeatureFlagsService);
  });
});
