import { Global, Module } from '@nestjs/common';

import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

/**
 * Feature flags gate optional platform capabilities per tenant. Global so the
 * FeatureFlagGuard and any module can ask `isEnabled()` without wiring imports.
 */
@Global()
@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagGuard],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
