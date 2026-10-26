// # Verifies existing password/TOTP/recovery-code proofs and stores a short-lived device/session/action-bound Redis grant.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AuthenticatedActor,
  type StepUpAction,
  type StepUpMethod,
  type StepUpStatus,
} from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PasswordService } from '../../../infrastructure/crypto/password.service';
import { AuditService } from '../../audit/audit.service';
import { AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { AccountLockoutService } from '../services/account-lockout.service';
import { TwoFactorService } from '../services/two-factor.service';

interface StepUpProof {
  action: StepUpAction;
  tenantId: string;
  userId: string;
  sessionId: string;
  deviceId: string;
  deviceFingerprint: string;
  verifiedAt: string;
  expiresAt: string;
}

interface SecurityContext {
  ipHash: string;
  requestId: string;
  userAgent?: string | null;
}

@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly twoFactor: TwoFactorService,
    private readonly lockout: AccountLockoutService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async verify(
    actor: AuthenticatedActor,
    input: {
      method: StepUpMethod;
      action: StepUpAction;
      code?: string;
      password?: string;
      recoveryCode?: string;
    },
    context: SecurityContext,
  ): Promise<StepUpStatus> {
    const [user, session] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: actor.userId, tenantId: actor.tenantId, deletedAt: null },
        select: { id: true, email: true, passwordHash: true, status: true },
      }),
      this.prisma.userSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          tenantId: actor.tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, deviceId: true, userAgent: true },
      }),
    ]);
    if (!user || user.status !== 'ACTIVE' || !session) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'A current authenticated device session is required.',
      });
    }

    await this.lockout.assertNotLocked(actor.tenantId, user.email);
    let valid = false;
    try {
      if (input.method === 'PASSWORD') {
        valid = await this.passwords.verify(user.passwordHash, input.password ?? '');
      } else {
        const result = await this.twoFactor.verify(actor.userId, {
          ...(input.method === 'TOTP'
            ? { code: input.code }
            : { recoveryCode: input.recoveryCode }),
        });
        valid = result.verified;
      }
    } catch (error) {
      await this.lockout.registerFailure(actor.tenantId, user.email, actor.userId, {
        ipHash: context.ipHash,
        requestId: context.requestId,
      });
      throw error;
    }

    if (!valid) {
      await this.lockout.registerFailure(actor.tenantId, user.email, actor.userId, {
        ipHash: context.ipHash,
        requestId: context.requestId,
      });
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'The step-up credential is invalid.',
      });
    }

    await this.lockout.clear(actor.tenantId, user.email, actor.userId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.stepUpTtlSeconds * 1000);
    const proof: StepUpProof = {
      action: input.action,
      tenantId: actor.tenantId,
      userId: actor.userId,
      sessionId: actor.sessionId,
      deviceId: session.deviceId,
      deviceFingerprint: this.deviceFingerprint(session.deviceId, session.userAgent),
      verifiedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.redis.client.set(
      this.key(actor),
      JSON.stringify(proof),
      'EX',
      this.config.stepUpTtlSeconds,
    );
    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: 'STEP_UP_VERIFIED',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: actor.sessionId,
      description: 'Sensitive-operation step-up proof verified.',
      ipHash: context.ipHash,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId,
      metadata: { action: input.action, method: input.method },
    });
    return { fresh: true, action: input.action, expiresAt: proof.expiresAt };
  }

  async isFresh(actor: AuthenticatedActor, action: StepUpAction): Promise<boolean> {
    try {
      const raw = await this.redis.client.get(this.key(actor));
      if (!raw) return false;
      const proof = JSON.parse(raw) as StepUpProof;
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          tenantId: actor.tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { deviceId: true, userAgent: true },
      });
      if (!session) return false;
      return (
        proof.action === action &&
        proof.tenantId === actor.tenantId &&
        proof.userId === actor.userId &&
        proof.sessionId === actor.sessionId &&
        proof.deviceId === session.deviceId &&
        proof.deviceFingerprint === this.deviceFingerprint(session.deviceId, session.userAgent) &&
        Date.parse(proof.expiresAt) > Date.now()
      );
    } catch {
      // Redis or session state unavailable is explicitly not a fresh proof.
      return false;
    }
  }

  async status(actor: AuthenticatedActor, action: StepUpAction | null): Promise<StepUpStatus> {
    if (!action || !(await this.isFresh(actor, action)))
      return { fresh: false, action, expiresAt: null };
    try {
      const raw = await this.redis.client.get(this.key(actor));
      if (!raw) return { fresh: false, action, expiresAt: null };
      const proof = JSON.parse(raw) as StepUpProof;
      return { fresh: true, action, expiresAt: proof.expiresAt };
    } catch {
      return { fresh: false, action, expiresAt: null };
    }
  }

  private key(actor: AuthenticatedActor): string {
    return `stepup:${actor.tenantId}:${actor.userId}:${actor.sessionId}`;
  }

  private deviceFingerprint(deviceId: string, userAgent: string | null): string {
    return createHash('sha256')
      .update(`${deviceId}\n${userAgent ?? ''}`)
      .digest('hex');
  }
}
