import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';

/**
 * Gates a route behind a tenant feature flag. The FeatureFlagGuard resolves the
 * flag for the request's tenant and returns FEATURE_DISABLED when it is off.
 */
export const RequireFeature = (flagKey: string): CustomDecorator<string> =>
  SetMetadata(FEATURE_FLAG_KEY, flagKey);
