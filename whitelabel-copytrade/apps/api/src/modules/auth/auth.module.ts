import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { TwoFactorController } from './two-factor.controller';
import { SessionsController } from './sessions.controller';
import { AuthService } from './auth.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { TwoFactorService } from './services/two-factor.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SsoAuthController } from './sso/sso-auth.controller';
import { SsoLoginService } from './sso/sso-login.service';
import { SsoTransactionService } from './sso/sso-transaction.service';
import { SsoIdentityService } from './sso/sso-identity.service';
import { SsoAuditService } from './sso/sso-audit.service';

/**
 * Authentication and session management.
 *
 * JwtModule is registered without global secrets: TokenService signs access and
 * refresh tokens with *different* keys, so a leaked access-token secret cannot
 * be used to mint refresh tokens.
 *
 * Single sign-on (modules/auth/sso) lives here rather than in the security
 * module because it must finish by issuing a session through AuthService;
 * the security module's providers only verify IdP responses.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
    UsersModule,
    TenantsModule,
    ObservabilityModule,
  ],
  controllers: [AuthController, TwoFactorController, SessionsController, SsoAuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    TwoFactorService,
    AccountLockoutService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    SsoLoginService,
    SsoTransactionService,
    SsoIdentityService,
    SsoAuditService,
  ],
  exports: [AuthService, TokenService, SessionService, TwoFactorService],
})
export class AuthModule {}
