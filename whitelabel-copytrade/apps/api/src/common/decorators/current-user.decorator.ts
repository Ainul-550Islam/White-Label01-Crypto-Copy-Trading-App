import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from '@wlct/shared-types';
import type { AppRequest } from '../types/request.types';
import { UnauthorizedException } from '../errors/app.exception';

/**
 * Injects the authenticated actor. Throws instead of returning undefined so a
 * controller can never silently operate without an identity.
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedActor | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor;
    if (!actor) {
      throw new UnauthorizedException();
    }
    return property ? actor[property] : actor;
  },
);
