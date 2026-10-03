import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  SystemRole,
  TwoFactorMethod,
  type AuthenticatedSessionDto,
  type LoginResultDto,
  type TwoFactorChallengeDto,
  type UserDto,
} from '@wlct/shared-types';
import { normaliseEmail } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { TokenService } from './services/token.service';
import { SessionService, type SessionAuthMethod, type SessionSamlLogout } from './services/session.service';
import { TwoFactorService } from './services/two-factor.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../rbac/permissions.service';
import { RolesService } from '../rbac/roles.service';
import { AuditService } from '../audit/audit.service';
import { SecurityThreatDetectionService as SuspiciousLoginDetector } from '../security/security-threat-detection.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppException } from '../../common/errors/app.exception';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { TenantContext } from '../../common/types/request.types';

/** How an SSO-issued session is labelled: method, issuing configuration, SAML logout data. */
interface SsoSessionOrigin {
  authMethod: SessionAuthMethod;
  ssoConfigurationId: string;
  samlLogout: SessionSamlLogout | null;
}

export interface AuthRequestContext {
  ipHash: string;
  userAgent: string | null;
  requestId: string;
  locale: string;
}

/**
 * Authentication orchestration.
 *
 * The service composes narrow collaborators (tokens, sessions, lockout, 2FA,
 * risk detection) rather than implementing them, which keeps each security
 * control independently testable and replaceable.
 *
 * User enumeration is treated as a real threat throughout: unknown accounts,
 * wrong passwords and disabled accounts all produce the same INVALID_CREDENTIALS
 * response after the same amount of hashing work.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly lockout: AccountLockoutService,
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly riskDetector: SuspiciousLoginDetector,
    private readonly notifications: NotificationsService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(
    tenant: TenantContext,
    dto: RegisterDto,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionDto> {
    const email = normaliseEmail(dto.email);
    const emailIndex = this.crypto.blindIndex(email);

    this.passwords.assertPolicy(dto.password, {
      email,
      name: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || undefined,
    });

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: tenant.tenantId, emailIndex },
      select: { id: true },
    });

    if (existing) {
      // Registration is public, so this response is unavoidable; it is rate
      // limited aggressively and audited.
      throw new AppException({
        code: ErrorCode.EMAIL_ALREADY_REGISTERED,
        message: 'An account with this email address already exists.',
      });
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const followerRoles = await this.roles.findByKeys(tenant.tenantId, [SystemRole.FOLLOWER]);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: tenant.tenantId,
          email,
          emailIndex,
          passwordHash,
          status: 'PENDING_VERIFICATION',
          referralCode: this.generateReferralCode(),
          referredByCode: dto.referralCode ?? null,
          profile: {
            create: {
              firstName: dto.firstName ?? null,
              lastName: dto.lastName ?? null,
              locale: dto.locale ?? tenant.defaultLocale,
              preferredCurrency: tenant.defaultCurrency,
            },
          },
        },
        select: { id: true },
      });

      if (followerRoles.length > 0) {
        await tx.userRole.createMany({
          data: followerRoles.map((role) => ({
            userId: created.id,
            roleId: role.id,
            tenantId: tenant.tenantId,
          })),
        });
      }

      return created;
    });

    await this.audit.record({
      tenantId: tenant.tenantId,
      actorType: AuditActorType.USER,
      actorId: user.id,
      actorEmail: email,
      action: AuditAction.USER_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: user.id,
      description: 'New account registered.',
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    await this.notifications.enqueueTransactional({
      tenantId: tenant.tenantId,
      userId: user.id,
      type: 'account.welcome',
      locale: dto.locale ?? tenant.defaultLocale,
      data: { email },
    });

    return this.establishSession(user.id, tenant, {
      deviceId: dto.deviceId,
      deviceName: dto.deviceName ?? null,
      platform: dto.platform ?? null,
      appVersion: dto.appVersion ?? null,
      context,
    });
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    tenant: TenantContext,
    dto: LoginDto,
    context: AuthRequestContext,
  ): Promise<LoginResultDto> {
    const email = normaliseEmail(dto.email);
    const emailIndex = this.crypto.blindIndex(email);

    await this.lockout.assertNotLocked(tenant.tenantId, email);

    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.tenantId, emailIndex, deletedAt: null },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        twoFactorEnabled: true,
        isPlatformUser: true,
        sessionVersion: true,
      },
    });

    if (!user) {
      // Equalise timing with the "user exists" branch.
      await this.passwords.verifyDummy();
      await this.recordFailedAttempt(tenant.tenantId, emailIndex, null, dto, context, 'unknown_user');
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'The email address or password is incorrect.',
      });
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, dto.password);

    if (!passwordValid) {
      await this.recordFailedAttempt(
        tenant.tenantId,
        emailIndex,
        user.id,
        dto,
        context,
        'invalid_password',
      );
      await this.lockout.registerFailure(tenant.tenantId, email, user.id, context);
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'The email address or password is incorrect.',
      });
    }

    this.assertAccountUsable(user.status);

    // Round 7: an ENFORCED SSO policy closes the password door. Checked only
    // after the password was verified, so the answer cannot be used to probe
    // which accounts exist (wrong passwords still get INVALID_CREDENTIALS and
    // count towards lockout).
    await this.assertPasswordLoginAllowed(tenant.tenantId, email, emailIndex, user, dto, context);

    // Opportunistic upgrade when argon2 parameters have been hardened.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const rehashed = await this.passwords.hash(dto.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: rehashed },
      });
    }

    await this.lockout.clear(tenant.tenantId, email, user.id);

    if (user.twoFactorEnabled) {
      const challenge = await this.tokens.issueTwoFactorChallenge(
        user.id,
        tenant.tenantId,
        dto.deviceId,
      );

      await this.recordLoginAttempt({
        tenantId: tenant.tenantId,
        userId: user.id,
        emailIndex,
        successful: false,
        reason: 'two_factor_required',
        deviceId: dto.deviceId,
        context,
      });

      const result: TwoFactorChallengeDto = {
        twoFactorRequired: true,
        challengeToken: challenge.token,
        expiresIn: challenge.expiresIn,
        methods: [TwoFactorMethod.TOTP, TwoFactorMethod.RECOVERY_CODE],
      };
      return result;
    }

    return this.completeLogin(user.id, tenant, dto, context, emailIndex);
  }

  /**
   * Refuses password login when the tenant ENFORCES single sign-on for this
   * account.
   *
   * A configuration enforces when it is active, `enforced` and in state
   * ENFORCED (the same triple the security console writes). Its
   * `allowedDomains`, when set, limit enforcement to accounts whose email is in
   * one of those domains, so a tenant can enforce SSO for its staff domain while
   * retail followers keep password login. An empty list enforces for every
   * account of the tenant.
   *
   * Platform staff (`isPlatformUser`) are exempt: they are the break-glass path
   * when a tenant's IdP is down or misconfigured, and they never authenticate
   * through a tenant IdP. There is no other bypass and no fallback - if the
   * lookup itself fails the login fails (the error propagates as a server
   * error), rather than silently allowing a password the policy forbids.
   */
  private async assertPasswordLoginAllowed(
    tenantId: string,
    email: string,
    emailIndex: string,
    user: { id: string; isPlatformUser: boolean },
    dto: LoginDto,
    context: AuthRequestContext,
  ): Promise<void> {
    if (user.isPlatformUser) return;

    const enforcing = await this.prisma.ssoConfiguration.findMany({
      where: { tenantId, isActive: true, enforced: true, state: 'ENFORCED' },
      select: { providerType: true, allowedDomains: true },
    });
    if (enforcing.length === 0) return;

    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    const applicable = enforcing.filter(
      (config) =>
        config.allowedDomains.length === 0 ||
        config.allowedDomains.some((allowed) => allowed.toLowerCase() === domain),
    );
    if (applicable.length === 0) return;

    await this.recordLoginAttempt({
      tenantId,
      userId: user.id,
      emailIndex,
      successful: false,
      reason: 'sso_required',
      deviceId: dto.deviceId,
      context,
    });
    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AuditAction.USER_LOGIN_FAILED,
      outcome: AuditOutcome.DENIED,
      resourceType: 'User',
      resourceId: user.id,
      description: 'Password login refused: the tenant enforces single sign-on for this account.',
      metadata: { reason: 'sso_required', providers: applicable.map((config) => config.providerType) },
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    throw new AppException({
      code: ErrorCode.SSO_REQUIRED,
      message: 'Your organisation requires single sign-on. Sign in with your identity provider.',
    });
  }

  /** Second leg of a 2FA login. */
  async verifyTwoFactor(
    tenant: TenantContext,
    dto: VerifyTwoFactorDto,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionDto> {
    const payload = await this.tokens.verifyTwoFactorChallenge(dto.challengeToken);

    if (payload.tid !== tenant.tenantId) {
      throw new AppException({
        code: ErrorCode.TENANT_MISMATCH,
        message: 'This verification request belongs to another organisation.',
      });
    }

    if (payload.did !== dto.deviceId) {
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'This verification request was issued for a different device.',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, tenantId: tenant.tenantId, deletedAt: null },
      select: { id: true, email: true, status: true },
    });

    if (!user) {
      throw new AppException({ code: ErrorCode.INVALID_CREDENTIALS });
    }

    this.assertAccountUsable(user.status);

    // A challenge that followed an SSO login carries that login's transaction:
    // the session is labelled exactly as it would have been without 2FA
    // (method, configuration, SAML logout context), so logout still reaches
    // the IdP. An unresolvable reference refuses the session - checked before
    // the second factor, so the challenge is not spent on a login that
    // cannot complete.
    const origin = payload.sso ? await this.ssoSessionOrigin(tenant.tenantId, payload.sso) : null;

    try {
      const result = await this.twoFactor.verify(user.id, {
        code: dto.code,
        recoveryCode: dto.recoveryCode,
      });

      // The second factor was accepted, so the challenge is spent: burning it
      // here (rather than on first sight) keeps it single-use for issuing a
      // session while still tolerating a few mistyped codes beforehand.
      await this.tokens.consumeTwoFactorChallenge(payload.jti);

      await this.audit.record({
        tenantId: tenant.tenantId,
        actorType: AuditActorType.USER,
        actorId: user.id,
        actorEmail: user.email,
        action: AuditAction.TWO_FACTOR_VERIFIED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'User',
        resourceId: user.id,
        description: result.usedRecoveryCode
          ? 'Signed in using a recovery code.'
          : 'Signed in using an authenticator code.',
        metadata: { remainingRecoveryCodes: result.remainingRecoveryCodes },
        ipHash: context.ipHash,
        userAgent: context.userAgent,
        requestId: context.requestId,
      });
    } catch (error) {
      await this.audit.record({
        tenantId: tenant.tenantId,
        actorType: AuditActorType.USER,
        actorId: user.id,
        actorEmail: user.email,
        action: AuditAction.TWO_FACTOR_FAILED,
        outcome: AuditOutcome.FAILURE,
        resourceType: 'User',
        resourceId: user.id,
        description: 'Two-factor verification failed.',
        ipHash: context.ipHash,
        requestId: context.requestId,
      });
      throw error;
    }

    return this.establishSession(user.id, tenant, {
      deviceId: dto.deviceId,
      deviceName: null,
      platform: null,
      appVersion: null,
      trusted: dto.trustDevice,
      context,
      ...(origin ?? {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh and logout
  // ---------------------------------------------------------------------------

  async refresh(
    refreshToken: string,
    deviceId: string,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionDto> {
    const consumed = await this.tokens.consumeRefreshToken(refreshToken, deviceId, {
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    const user = await this.prisma.user.findFirst({
      where: { id: consumed.userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        isPlatformUser: true,
        tenantId: true,
        sessionVersion: true,
      },
    });

    if (!user) {
      throw new AppException({ code: ErrorCode.TOKEN_INVALID });
    }

    this.assertAccountUsable(user.status);

    const access = await this.permissions.getEffectiveAccess(user.id);

    const tokens = await this.tokens.issueTokenPair({
      userId: user.id,
      tenantId: consumed.tenantId,
      sessionId: consumed.sessionId,
      roles: access.roleKeys,
      permissions: access.permissionKeys,
      isPlatformUser: user.isPlatformUser,
      sessionVersion: user.sessionVersion,
      familyId: consumed.familyId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });

    await this.sessions.touch(consumed.sessionId, context.ipHash);

    await this.audit.record({
      tenantId: consumed.tenantId,
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AuditAction.TOKEN_REFRESHED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: consumed.sessionId,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    const profile = await this.users.findByIdForSession(user.id, consumed.tenantId);

    return { tokens, user: profile, sessionId: consumed.sessionId };
  }

  async logout(
    userId: string,
    tenantId: string,
    sessionId: string,
    accessTokenId: string,
    accessTokenExp: number,
    allDevices: boolean,
    context: AuthRequestContext,
  ): Promise<{ loggedOut: true; sessionsRevoked: number }> {
    let sessionsRevoked = 1;

    if (allDevices) {
      sessionsRevoked = await this.sessions.revokeAll(userId, null, 'user_logout_all');
      await this.tokens.revokeAllUserTokens(userId, 'user_logout_all');
      await this.prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });
    } else {
      await this.sessions.revoke(userId, sessionId, 'user_logout');
      await this.tokens.revokeSessionTokens(sessionId, 'user_logout');
    }

    await this.tokens.blacklistAccessToken(accessTokenId, accessTokenExp);
    await this.permissions.invalidateUser(userId);

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      action: AuditAction.USER_LOGGED_OUT,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: sessionId,
      metadata: { allDevices, sessionsRevoked },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { loggedOut: true, sessionsRevoked };
  }

  // ---------------------------------------------------------------------------
  // Password management
  // ---------------------------------------------------------------------------

  async changePassword(
    userId: string,
    tenantId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
    context: AuthRequestContext,
  ): Promise<{ changed: true; sessionsRevoked: number }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Account not found.' });
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Your current password is incorrect.',
      });
    }

    this.passwords.assertPolicy(dto.newPassword, { email: user.email });

    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    });

    let sessionsRevoked = 0;
    if (dto.revokeOtherSessions) {
      sessionsRevoked = await this.sessions.revokeAll(
        userId,
        currentSessionId,
        'password_changed',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      actorEmail: user.email,
      action: AuditAction.PASSWORD_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      description: 'Account password changed.',
      metadata: { sessionsRevoked },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    await this.notifications.enqueueTransactional({
      tenantId,
      userId,
      type: 'security.password_changed',
      locale: context.locale,
      data: {},
    });

    return { changed: true, sessionsRevoked };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Single sign-on completion (Part 11)
  // ---------------------------------------------------------------------------

  /**
   * Issues a session for a user whose identity an IdP has already proven
   * (see modules/auth/sso). Uses exactly the same machinery as password
   * login: account-state checks, the 2FA challenge when the account has 2FA
   * enabled, the revocable server-side session, rotating hashed refresh
   * tokens, risk assessment, login-attempt and audit records.
   */
  async completeSsoLogin(
    userId: string,
    tenant: TenantContext,
    device: { deviceId: string; deviceName: string | null; platform: string | null; appVersion: string | null },
    context: AuthRequestContext,
    sso?: { providerType: 'OIDC' | 'SAML'; configurationId: string; transactionId?: string },
  ): Promise<LoginResultDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.tenantId, deletedAt: null },
      select: { id: true, email: true, status: true, twoFactorEnabled: true },
    });
    if (!user) {
      throw new AppException({ code: ErrorCode.INVALID_CREDENTIALS });
    }

    this.assertAccountUsable(user.status);
    const emailIndex = this.crypto.blindIndex(user.email);

    // The session's SSO origin. With a login transaction it is read from that
    // (consumed, same-tenant) transaction and must agree with the caller's
    // provider binding; resolved before any two-factor challenge is issued.
    let origin: SsoSessionOrigin | null = null;
    if (sso?.transactionId) {
      origin = await this.ssoSessionOrigin(tenant.tenantId, sso.transactionId);
      if (origin.ssoConfigurationId !== sso.configurationId || origin.authMethod !== (sso.providerType === 'SAML' ? 'SSO_SAML' : 'SSO_OIDC')) {
        throw new AppException({ code: ErrorCode.TOKEN_INVALID, message: 'Single sign-on could not be completed.' });
      }
    } else if (sso) {
      origin = {
        authMethod: sso.providerType === 'SAML' ? 'SSO_SAML' : 'SSO_OIDC',
        ssoConfigurationId: sso.configurationId,
        samlLogout: null,
      };
    }

    if (user.twoFactorEnabled) {
      const challenge = sso?.transactionId
        ? await this.tokens.issueTwoFactorChallenge(user.id, tenant.tenantId, device.deviceId, { sso: sso.transactionId })
        : await this.tokens.issueTwoFactorChallenge(user.id, tenant.tenantId, device.deviceId);
      await this.recordLoginAttempt({
        tenantId: tenant.tenantId,
        userId: user.id,
        emailIndex,
        successful: false,
        reason: 'sso_two_factor_required',
        deviceId: device.deviceId,
        context,
      });
      const result: TwoFactorChallengeDto = {
        twoFactorRequired: true,
        challengeToken: challenge.token,
        expiresIn: challenge.expiresIn,
        methods: [TwoFactorMethod.TOTP, TwoFactorMethod.RECOVERY_CODE],
      };
      return result;
    }

    const session = await this.establishSession(user.id, tenant, {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      appVersion: device.appVersion,
      context,
      ...(origin ?? {}),
    });

    await this.recordLoginAttempt({
      tenantId: tenant.tenantId,
      userId: user.id,
      emailIndex,
      successful: true,
      reason: 'sso',
      deviceId: device.deviceId,
      context,
    });

    return session;
  }

  /** Revokes a just-issued SSO session (used when its durable audit record cannot be written). */
  async revokeSsoSession(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(userId, sessionId, 'sso_audit_failed');
    await this.tokens.revokeSessionTokens(sessionId, 'sso_audit_failed');
  }

  /**
   * IdP-initiated SAML Single Logout: revokes the subject's sessions issued by
   * the configuration (only the named SessionIndexes when the IdP gave any).
   * Access tokens of a revoked session are refused by the JWT strategy's
   * session check. Returns the number of sessions revoked.
   */
  async revokeSamlIdpSessions(input: {
    tenantId: string;
    configurationId: string;
    subjectHash: string;
    sessionIndexHashes: string[];
  }): Promise<number> {
    return this.sessions.revokeSamlSubjectSessions({ ...input, reason: 'saml_idp_logout' });
  }

  /**
   * The origin of an SSO login, read from its consumed login transaction:
   * it must belong to this tenant and be CONSUMED (the login completed).
   * The SAML logout data is copied as stored (sealed; never decrypted here).
   */
  private async ssoSessionOrigin(tenantId: string, transactionId: string): Promise<SsoSessionOrigin> {
    const tx = await this.prisma.ssoAuthTransaction.findFirst({
      where: { id: transactionId, tenantId, status: 'CONSUMED' },
      select: { providerType: true, configurationId: true, samlLogoutContext: true },
    });
    if (!tx) {
      throw new AppException({ code: ErrorCode.TOKEN_INVALID, message: 'Single sign-on could not be completed.' });
    }
    const stored = tx.samlLogoutContext as unknown as Partial<SessionSamlLogout> | null;
    const samlLogout =
      tx.providerType === 'SAML' && stored && stored.context && typeof stored.subjectHash === 'string'
        ? {
            context: stored.context,
            subjectHash: stored.subjectHash,
            sessionIndexHash: typeof stored.sessionIndexHash === 'string' ? stored.sessionIndexHash : null,
          }
        : null;
    return {
      authMethod: tx.providerType === 'SAML' ? 'SSO_SAML' : 'SSO_OIDC',
      ssoConfigurationId: tx.configurationId,
      samlLogout,
    };
  }

  private async completeLogin(
    userId: string,
    tenant: TenantContext,
    dto: LoginDto,
    context: AuthRequestContext,
    emailIndex: string,
  ): Promise<AuthenticatedSessionDto> {
    const session = await this.establishSession(userId, tenant, {
      deviceId: dto.deviceId,
      deviceName: dto.deviceName ?? null,
      platform: dto.platform ?? null,
      appVersion: dto.appVersion ?? null,
      trusted: dto.rememberDevice,
      context,
    });

    await this.recordLoginAttempt({
      tenantId: tenant.tenantId,
      userId,
      emailIndex,
      successful: true,
      reason: null,
      deviceId: dto.deviceId,
      context,
    });

    return session;
  }

  private async establishSession(
    userId: string,
    tenant: TenantContext,
    options: {
      deviceId: string;
      deviceName: string | null;
      platform: string | null;
      appVersion: string | null;
      trusted?: boolean;
      context: AuthRequestContext;
      authMethod?: SessionAuthMethod;
      ssoConfigurationId?: string | null;
      samlLogout?: SessionSamlLogout | null;
    },
  ): Promise<AuthenticatedSessionDto> {
    const { context } = options;

    const session = await this.sessions.createOrReuse({
      userId,
      tenantId: tenant.tenantId,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      platform: options.platform,
      appVersion: options.appVersion,
      userAgent: context.userAgent,
      ipHash: context.ipHash,
      trusted: options.trusted ?? false,
      authMethod: options.authMethod ?? 'PASSWORD',
      ssoConfigurationId: options.ssoConfigurationId ?? null,
      samlLogout: options.samlLogout ?? null,
    });

    const access = await this.permissions.getEffectiveAccess(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isPlatformUser: true, email: true, sessionVersion: true },
    });

    const tokens = await this.tokens.issueTokenPair({
      userId,
      tenantId: tenant.tenantId,
      sessionId: session.id,
      roles: access.roleKeys,
      permissions: access.permissionKeys,
      isPlatformUser: user.isPlatformUser,
      sessionVersion: user.sessionVersion,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastLoginIpHash: context.ipHash },
    });

    const risk = await this.riskDetector.assess({
      tenantId: tenant.tenantId,
      userId,
      emailIndex: this.crypto.blindIndex(user.email),
      ipHash: context.ipHash,
      deviceId: options.deviceId,
      userAgent: context.userAgent,
      requestId: context.requestId,
      geoLabel: null,
    });

    if (risk.requiresNotification) {
      await this.notifications.enqueueTransactional({
        tenantId: tenant.tenantId,
        userId,
        type: 'security.new_device',
        locale: context.locale,
        data: { deviceName: options.deviceName ?? 'Unknown device', riskScore: risk.riskScore },
      });
    }

    await this.audit.record({
      tenantId: tenant.tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      actorEmail: user.email,
      action: AuditAction.USER_LOGIN_SUCCEEDED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: session.id,
      metadata: {
        deviceId: options.deviceId,
        isNewDevice: risk.isNewDevice,
        riskScore: risk.riskScore,
      },
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    const profile: UserDto = await this.users.findByIdForSession(userId, tenant.tenantId);

    return { tokens, user: profile, sessionId: session.id };
  }

  private assertAccountUsable(status: string): void {
    if (status === 'SUSPENDED' || status === 'DEACTIVATED') {
      throw new AppException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled. Contact support for assistance.',
      });
    }
    if (status === 'LOCKED') {
      throw new AppException({
        code: ErrorCode.ACCOUNT_LOCKED,
        message: 'This account is locked. Reset your password or contact support.',
      });
    }
  }

  private async recordFailedAttempt(
    tenantId: string,
    emailIndex: string,
    userId: string | null,
    dto: LoginDto,
    context: AuthRequestContext,
    reason: string,
  ): Promise<void> {
    await this.recordLoginAttempt({
      tenantId,
      userId,
      emailIndex,
      successful: false,
      reason,
      deviceId: dto.deviceId,
      context,
    });

    await this.riskDetector.recordFailure(tenantId, context.ipHash, context.requestId);

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      action: AuditAction.USER_LOGIN_FAILED,
      outcome: AuditOutcome.FAILURE,
      resourceType: 'User',
      resourceId: userId,
      description: `Sign-in failed (${reason}).`,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });
  }

  private async recordLoginAttempt(input: {
    tenantId: string;
    userId: string | null;
    emailIndex: string;
    successful: boolean;
    reason: string | null;
    deviceId: string;
    context: AuthRequestContext;
  }): Promise<void> {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          emailIndex: input.emailIndex,
          successful: input.successful,
          reason: input.reason,
          ipHash: input.context.ipHash,
          userAgent: input.context.userAgent,
          deviceId: input.deviceId,
        },
      });
    } catch (error) {
      this.logger.warn(
        { event: 'auth.attempt_log_failed', message: (error as Error).message },
        'Failed to persist login attempt',
      );
    }
  }

  private generateReferralCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const raw = this.crypto.generateToken(8).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    let code = '';
    for (let index = 0; index < 8; index += 1) {
      const charCode = raw.charCodeAt(index % raw.length);
      code += alphabet[charCode % alphabet.length];
    }
    return code;
  }
}
