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
import { SessionService } from './services/session.service';
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
