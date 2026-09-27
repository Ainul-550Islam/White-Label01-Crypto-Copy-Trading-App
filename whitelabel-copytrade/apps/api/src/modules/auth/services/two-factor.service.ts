import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  TwoFactorMethod,
  type TwoFactorSetupDto,
} from '@wlct/shared-types';
import type { SealedPayload } from '@wlct/utils';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../../infrastructure/crypto/password.service';
import { AuditService } from '../../audit/audit.service';
import { AppException } from '../../../common/errors/app.exception';

export interface TwoFactorVerificationResult {
  verified: boolean;
  usedRecoveryCode: boolean;
  remainingRecoveryCodes: number;
}

/**
 * TOTP based two-factor authentication.
 *
 * Security properties:
 *   - the shared secret is stored envelope-encrypted, bound to the user id as
 *     additional authenticated data, so a stolen row cannot be decrypted in a
 *     different context;
 *   - the last accepted time-step counter is persisted, which blocks replay of
 *     a code that is still inside the acceptance window;
 *   - recovery codes are argon2 hashed and single use;
 *   - activation requires proving possession of the authenticator before the
 *     factor is enforced, so a user cannot lock themselves out.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    @InjectPinoLogger(TwoFactorService.name) private readonly logger: PinoLogger,
  ) {
    authenticator.options = {
      digits: this.config.twoFactorDigits,
      step: this.config.twoFactorPeriod,
      window: this.config.twoFactorWindow,
    };
  }

  /** Step 1: generate a secret and provisioning URI. 2FA is not active yet. */
  async beginSetup(
    userId: string,
    tenantId: string,
    email: string,
    password: string,
  ): Promise<TwoFactorSetupDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, passwordHash: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Account not found.' });
    }

    // Re-authentication: enabling 2FA is a security-sensitive operation.
    const passwordValid = await this.passwords.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Your password is incorrect.',
      });
    }

    if (user.twoFactorEnabled) {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        message: 'Two-factor authentication is already enabled for this account.',
      });
    }

    const secret = authenticator.generateSecret(32);
    const otpauthUrl = authenticator.keyuri(email, this.config.twoFactorIssuer, secret);
    const sealed = this.crypto.encrypt(secret, this.aad(userId));

    const recoveryCodes = Array.from({ length: this.config.twoFactorRecoveryCodeCount }, () =>
      this.crypto.generateRecoveryCode(),
    );
    const hashedCodes = await Promise.all(
      recoveryCodes.map((code) => this.passwords.hash(code)),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorAuth.upsert({
        where: { userId },
        create: {
          userId,
          method: TwoFactorMethod.TOTP,
          status: 'PENDING_ACTIVATION',
          secretCiphertext: sealed as unknown as object,
          encryptionKeyId: sealed.keyId,
        },
        update: {
          method: TwoFactorMethod.TOTP,
          status: 'PENDING_ACTIVATION',
          secretCiphertext: sealed as unknown as object,
          encryptionKeyId: sealed.keyId,
          failedAttempts: 0,
          lastUsedCounter: null,
          disabledAt: null,
        },
      });

      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.twoFactorRecoveryCode.createMany({
        data: hashedCodes.map((codeHash) => ({ userId, codeHash })),
      });
    });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });

    // The plaintext secret and recovery codes are returned exactly once here.
    return {
      method: TwoFactorMethod.TOTP,
      secretIssuedAt: new Date().toISOString(),
      otpauthUrl,
      qrCodeDataUrl,
      recoveryCodes,
    };
  }

  /** Step 2: prove possession of the authenticator and activate the factor. */
  async confirmSetup(
    userId: string,
    tenantId: string,
    code: string,
    context: { ipHash: string; requestId: string },
  ): Promise<{ enabled: true }> {
    const record = await this.prisma.twoFactorAuth.findUnique({ where: { userId } });

    if (!record || record.status === 'DISABLED') {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
        message: 'Start the two-factor setup before confirming it.',
      });
    }

    const secret = this.crypto.decrypt(
      record.secretCiphertext as unknown as SealedPayload,
      this.aad(userId),
    );

    if (!authenticator.check(code, secret)) {
      await this.prisma.twoFactorAuth.update({
        where: { userId },
        data: { failedAttempts: { increment: 1 } },
      });
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_INVALID,
        message: 'That code is not valid. Check your authenticator app and try again.',
      });
    }

    const counter = this.currentCounter();

    await this.prisma.$transaction([
      this.prisma.twoFactorAuth.update({
        where: { userId },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          lastVerifiedAt: new Date(),
          lastUsedCounter: BigInt(counter),
          failedAttempts: 0,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true },
      }),
    ]);

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      action: AuditAction.TWO_FACTOR_ENABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      description: 'Two-factor authentication activated.',
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { enabled: true };
  }

  /** Verifies a TOTP code or a recovery code during sign-in. */
  async verify(
    userId: string,
    input: { code?: string; recoveryCode?: string },
  ): Promise<TwoFactorVerificationResult> {
    const record = await this.prisma.twoFactorAuth.findUnique({ where: { userId } });

    if (!record || record.status !== 'ACTIVE') {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
        message: 'Two-factor authentication is not active for this account.',
      });
    }

    if (input.recoveryCode) {
      return this.verifyRecoveryCode(userId, input.recoveryCode);
    }

    if (!input.code) {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_INVALID,
        message: 'An authenticator code is required.',
      });
    }

    const secret = this.crypto.decrypt(
      record.secretCiphertext as unknown as SealedPayload,
      this.aad(userId),
    );

    if (!authenticator.check(input.code, secret)) {
      await this.prisma.twoFactorAuth.update({
        where: { userId },
        data: { failedAttempts: { increment: 1 } },
      });
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_INVALID,
        message: 'That code is not valid. Check your authenticator app and try again.',
      });
    }

    const counter = this.currentCounter();
    if (record.lastUsedCounter !== null && BigInt(counter) <= record.lastUsedCounter) {
      // The code is arithmetically valid but was already consumed.
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_INVALID,
        message: 'That code has already been used. Wait for the next code and try again.',
      });
    }

    await this.prisma.twoFactorAuth.update({
      where: { userId },
      data: {
        lastVerifiedAt: new Date(),
        lastUsedCounter: BigInt(counter),
        failedAttempts: 0,
      },
    });

    const remaining = await this.prisma.twoFactorRecoveryCode.count({
      where: { userId, usedAt: null },
    });

    return { verified: true, usedRecoveryCode: false, remainingRecoveryCodes: remaining };
  }

  async disable(
    userId: string,
    tenantId: string,
    password: string,
    proof: { code?: string; recoveryCode?: string },
    context: { ipHash: string; requestId: string },
  ): Promise<{ disabled: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { passwordHash: true, twoFactorEnabled: true },
    });

    if (!user || !user.twoFactorEnabled) {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
        message: 'Two-factor authentication is not enabled for this account.',
      });
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Your password is incorrect.',
      });
    }

    await this.verify(userId, proof);

    await this.prisma.$transaction([
      this.prisma.twoFactorAuth.update({
        where: { userId },
        data: { status: 'DISABLED', disabledAt: new Date() },
      }),
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    ]);

    this.logger.warn(
      { event: 'auth.two_factor_disabled', userId, tenantId },
      'Two-factor authentication disabled',
    );

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: userId,
      action: AuditAction.TWO_FACTOR_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      description: 'Two-factor authentication disabled.',
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { disabled: true };
  }

  /** Issues a fresh set of recovery codes, invalidating the previous set. */
  async regenerateRecoveryCodes(userId: string, password: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, twoFactorEnabled: true },
    });

    if (!user?.twoFactorEnabled) {
      throw new AppException({
        code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
        message: 'Two-factor authentication is not enabled for this account.',
      });
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Your password is incorrect.',
      });
    }

    const codes = Array.from({ length: this.config.twoFactorRecoveryCodeCount }, () =>
      this.crypto.generateRecoveryCode(),
    );
    const hashes = await Promise.all(codes.map((code) => this.passwords.hash(code)));

    await this.prisma.$transaction([
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);

    return codes;
  }

  private async verifyRecoveryCode(
    userId: string,
    recoveryCode: string,
  ): Promise<TwoFactorVerificationResult> {
    const candidates = await this.prisma.twoFactorRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });

    for (const candidate of candidates) {
      const matches = await this.passwords.verify(candidate.codeHash, recoveryCode.toUpperCase());
      if (matches) {
        await this.prisma.twoFactorRecoveryCode.update({
          where: { id: candidate.id },
          data: { usedAt: new Date() },
        });

        const remaining = await this.prisma.twoFactorRecoveryCode.count({
          where: { userId, usedAt: null },
        });

        this.logger.warn(
          { event: 'auth.recovery_code_used', userId, remaining },
          'A two-factor recovery code was consumed',
        );

        return { verified: true, usedRecoveryCode: true, remainingRecoveryCodes: remaining };
      }
    }

    throw new AppException({
      code: ErrorCode.TWO_FACTOR_INVALID,
      message: 'That recovery code is not valid.',
    });
  }

  /** Binds the encrypted secret to its owner. */
  private aad(userId: string): string {
    return `two_factor_secret:${userId}`;
  }

  private currentCounter(): number {
    return Math.floor(Date.now() / 1000 / this.config.twoFactorPeriod);
  }
}
