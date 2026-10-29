// # Registers authentication, sessions, SSO and step-up: the single module that owns the whole identity surface.
import { Global, Module } from '@nestjs/common';
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
import { StepUpAuthService } from './step-up-auth.service';
import { StepUpAuthController } from './step-up-auth.controller';
import { StepUpGuard } from './step-up/step-up.guard';
import { LoginAnomalyService } from './login-anomaly.service';
import { AccountRecoveryController } from './account-recovery.controller';
import { AccountRecoveryRuntimeModule } from './account-recovery-runtime.module';
import { PrismaLoginAnomalyRepository } from './login-anomaly.repository';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';

/**
 * Authentication and session management - and, since Batch 03, step-up.
 *
 * JwtModule is registered without global secrets: TokenService signs access and
 * refresh tokens with *different* keys, so a leaked access-token secret cannot
 * be used to mint refresh tokens.
 *
 * Single sign-on (modules/auth/sso) lives here rather than in the security
 * module because it must finish by issuing a session through AuthService;
 * the security module's providers only verify IdP responses.
 *
 * STEP-UP IS NOT A SEPARATE MODULE ANY MORE
 * -----------------------------------------
 * It used to live in `auth/step-up/step-up.module.ts`, which forced a
 * `forwardRef` cycle back into this file purely so the guard could reach the
 * password verifier, the TOTP window and the lockout counters. Those are all
 * AuthModule providers, so the cycle existed to bridge a boundary that had no
 * reason to exist. Merging it here removes the cycle, removes a module whose only
 * content was a re-export, and puts the step-up proof's issuing, consumption and
 * route enforcement in one place where the audit rows are written.
 *
 * The module is `@Global` for the same reason the old one was: a controller in
 * the custody module must be able to write `@RequireStepUp('CUSTODY_SWEEP')`
 * without importing anything from auth. The guard is a no-op on routes that carry
 * no such metadata, and it is registered through APP_GUARD so the decorator - not
 * the module graph - decides what is sensitive. (A2: the global registration
 * itself lives in app.module.ts next to the auth/tenant chain.)
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
    UsersModule,
    TenantsModule,
    ObservabilityModule,
    AccountRecoveryRuntimeModule,
  ],
  controllers: [
    AuthController,
    TwoFactorController,
    SessionsController,
    SsoAuthController,
    StepUpAuthController,
    AccountRecoveryController,
  ],
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
    StepUpAuthService,
    StepUpGuard,
    // Batch 03 A2: StepUpGuard is a GLOBAL guard, registered exactly once -
    // in app.module.ts's APP_GUARD chain, positioned after JwtAuthGuard,
    // TenantGuard and PermissionsGuard. Re-registering it here (previously
    // done through a second APP_GUARD binding) ran every step-up-metadated
    // route through the verifier twice. The module still provides/ exports
    // the class so app.module can bind it via useExisting.
    PrismaLoginAnomalyRepository,
    {
      provide: LoginAnomalyService,
      useFactory: (repository: PrismaLoginAnomalyRepository, crypto: CryptoService) =>
        new LoginAnomalyService(repository, {
          keyProvider: () => crypto.blindIndex('login-anomaly-device-hmac'),
        }),
      inject: [PrismaLoginAnomalyRepository, CryptoService],
    },
  ],
  exports: [
    AuthService,
    TokenService,
    SessionService,
    TwoFactorService,
    AccountLockoutService,
    StepUpAuthService,
    StepUpGuard,
    LoginAnomalyService,
  ],
})
export class AuthModule {}
