// # Attaches the exact sensitive operation that a fresh step-up proof must authorize.
import { SetMetadata } from '@nestjs/common';
import type { StepUpAction } from '@wlct/shared-types';

export const REQUIRE_STEP_UP_KEY = 'security:require-step-up';

export function RequireStepUp(action: StepUpAction): MethodDecorator {
  return SetMetadata(REQUIRE_STEP_UP_KEY, action);
}
