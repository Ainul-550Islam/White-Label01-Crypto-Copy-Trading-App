// # Registers authentication, sessions, SSO and step-up: the single module that owns the whole identity surface.
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';

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
import { AccountRecoveryService } from './account-recovery.service';
import { AccountRecoveryController } from './account-recovery.controller';
import {
  PrismaAccountLookup,
  PrismaAccountRecoveryRepository,
  RedisSessionRevocationAdapter,
} from './account-recovery.adapters';
import { PrismaLoginAnomalyRepository } from './login-anomaly.repository';
import { AuditService } from '../audit/audit.service';
import { AuditActorType, AuditOutcome } from '@wlct/shared-types';
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
 * the module graph - decides what is sensitive.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
    UsersModule,
    TenantsModule,
    ObservabilityModule,
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
    { provide: APP_GUARD, useExisting: StepUpGuard },
    // Ports first, then the services that are built from them. The recovery
    // service takes its store, account lookup, session revocation and audit trail
    // as constructor PORTS, so its single-use and enumeration rules are testable
    // without a database and the production wiring lives in one place - here.
    PrismaAccountRecoveryRepository,
    PrismaAccountLookup,
    RedisSessionRevocationAdapter,
    PrismaLoginAnomalyRepository,
    {
      provide: AccountRecoveryService,
      useFactory: (
        repository: PrismaAccountRecoveryRepository,
        accounts: PrismaAccountLookup,
        sessions: RedisSessionRevocationAdapter,
        audit: AuditService,
        crypto: CryptoService,
      ) =>
        new AccountRecoveryService(
          repository,
          accounts,
          sessions,
          {
            record: async (entry) => {
              await audit.recordImmediate({
                tenantId: entry.tenantId,
                actorType: entry.userId ? AuditActorType.USER : AuditActorType.SYSTEM,
                actorId: entry.userId,
                action: entry.event,
                outcome: entry.result === 'SUCCESS' ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                resourceType: 'AccountRecovery',
                description: `Account recovery step ${entry.event.toLowerCase().replace(/_/g, ' ')} (${entry.reasonCode}).`,
                ipHash: entry.ipHash,
                requestId: entry.requestId,
              });
            },
          },
          {
            // Derived from the deployment's blind-index key rather than a new
            // environment variable: the token HMAC only needs to be secret and
            // stable per deployment, and a missing new env var would otherwise be
            // a startup failure on every existing install.
            keyProvider: () => crypto.blindIndex('account-recovery-token-hmac'),
          },
        ),
      inject: [
        PrismaAccountRecoveryRepository,
        PrismaAccountLookup,
        RedisSessionRevocationAdapter,
        AuditService,
        CryptoService,
      ],
    },
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
    AccountRecoveryService,
    LoginAnomalyService,
  ],
})
export class AuthModule {}
