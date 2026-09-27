import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ErrorCode, type AuthenticatedActor } from '@wlct/shared-types';

import { IS_PUBLIC_KEY } from '../../../common/constants/metadata.constants';
import { AppException } from '../../../common/errors/app.exception';
import { TokenService } from '../services/token.service';
import type { AppRequest } from '../../../common/types/request.types';

/**
 * Deny-by-default authentication guard.
 *
 * Registered globally: a controller is protected unless it is explicitly marked
 * `@Public()`. It also checks the access-token blacklist, which the Passport
 * strategy cannot do on its own, and stores the actor on the request for the
 * downstream tenancy and permission guards.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AppRequest>();
    const hasAuthHeader = Boolean(request.headers.authorization);

    if (isPublic && !hasAuthHeader) {
      return true;
    }

    if (isPublic && hasAuthHeader) {
      // Optional authentication: attach the actor when the token is valid, but
      // never fail an otherwise public route because of a stale token.
      try {
        await super.canActivate(context);
      } catch {
        return true;
      }
      return true;
    }

    const activated = (await super.canActivate(context)) as boolean;
    if (!activated) {
      return false;
    }

    const actor = request.user as AuthenticatedActor | undefined;
    if (!actor) {
      throw new AppException({ code: ErrorCode.UNAUTHORIZED });
    }

    // Reject tokens that were explicitly blacklisted on logout.
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
      await this.tokenService.verifyAccessToken(token);
    }

    request.actor = actor;
    return true;
  }

  override handleRequest<TUser = AuthenticatedActor>(
    err: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    if (err) {
      throw err;
    }

    if (!user) {
      const infoName = (info as Error | undefined)?.name;
      throw new AppException({
        code: infoName === 'TokenExpiredError' ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHORIZED,
        message:
          infoName === 'TokenExpiredError'
            ? 'Your session has expired. Please sign in again.'
            : 'Authentication is required to access this resource.',
      });
    }

    return user;
  }
}
