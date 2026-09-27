import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CACHE_KEY } from '@wlct/config';
import { ErrorCode, SecurityEventType, SecuritySeverity } from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SecurityEventService as SecurityEventsService } from '../../security/security-event.service';
import { AppException } from '../../../common/errors/app.exception';

/**
 * Progressive account lockout.
 *
 * Counters live in Redis (fast, shared across replicas) and are mirrored onto
 * the user row so an operator can see the state in the admin console. The lock
 * is keyed by tenant + email so the same address in two brands is independent.
 */
@Injectable()
export class AccountLockoutService {
  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly securityEvents: SecurityEventsService,
    @InjectPinoLogger(AccountLockoutService.name) private readonly logger: PinoLogger,
  ) {}

  /** Throws when the account is currently locked. */
  async assertNotLocked(tenantId: string, email: string): Promise<void> {
    const lockKey = CACHE_KEY.accountLock(tenantId, email);
    const lockedUntil = await this.cache.get<number>(lockKey);

    if (lockedUntil && lockedUntil > Date.now()) {
      const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000));
      throw new AppException({
        code: ErrorCode.ACCOUNT_LOCKED,
        message: `Too many failed attempts. Your account is locked for another ${minutes} minute(s).`,
        context: { tenantId },
      });
    }
  }

  /**
   * Registers a failed attempt and locks the account once the threshold is hit.
   * Returns the number of attempts recorded in the current window.
   */
  async registerFailure(
    tenantId: string,
    email: string,
    userId: string | null,
    context: { ipHash: string; requestId: string },
  ): Promise<number> {
    const counterKey = CACHE_KEY.loginFailures(tenantId, email);
    const attempts = await this.cache.increment(counterKey, this.config.loginFailedWindowSeconds);

    if (attempts >= this.config.loginMaxFailedAttempts) {
      const lockedUntil = Date.now() + this.config.accountLockoutSeconds * 1000;
      await this.cache.set(
        CACHE_KEY.accountLock(tenantId, email),
        lockedUntil,
        this.config.accountLockoutSeconds,
      );
      await this.cache.delete(counterKey);

      if (userId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            failedLoginAttempts: attempts,
            lockedUntil: new Date(lockedUntil),
            status: 'LOCKED',
          },
        });
      }

      this.logger.warn(
        { event: 'auth.account_locked', tenantId, userId, attempts },
        'Account locked after repeated failed sign-in attempts',
      );

      await this.securityEvents.record({
        tenantId,
        userId,
        type: SecurityEventType.BRUTE_FORCE_SUSPECTED,
        severity: SecuritySeverity.MEDIUM,
        description: 'Account locked after reaching the failed sign-in threshold.',
        ipHash: context.ipHash,
        requestId: context.requestId,
        metadata: { attempts, lockSeconds: this.config.accountLockoutSeconds },
      });
    } else if (userId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: attempts },
      });
    }

    return attempts;
  }

  /** Clears counters after a successful authentication. */
  async clear(tenantId: string, email: string, userId: string): Promise<void> {
    await this.cache.delete(
      CACHE_KEY.loginFailures(tenantId, email),
      CACHE_KEY.accountLock(tenantId, email),
    );

    const restoreActive = await this.shouldRestoreActive(userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(restoreActive ? { status: 'ACTIVE' as const } : {}),
      },
    });
  }

  /** Administrative unlock. */
  async unlock(tenantId: string, email: string, userId: string): Promise<void> {
    await this.cache.delete(
      CACHE_KEY.loginFailures(tenantId, email),
      CACHE_KEY.accountLock(tenantId, email),
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' },
    });
  }

  /** Only a LOCKED account returns to ACTIVE; SUSPENDED stays suspended. */
  private async shouldRestoreActive(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status === 'LOCKED';
  }
}
