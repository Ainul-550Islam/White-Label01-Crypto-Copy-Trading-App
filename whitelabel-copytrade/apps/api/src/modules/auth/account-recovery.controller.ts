// # Exposes the three public account-recovery steps, throttled per address hash and answering identically whatever the truth is.
//
// These routes are PUBLIC by necessity - a customer who has lost access cannot
// authenticate. Everything that makes them safe lives in the service (hashed
// single-use tokens, enumeration-safe responses, session revocation on
// completion); what this controller adds is the shape of the response, which is
// the same for every caller:
//
//   POST /v1/auth/recovery/request  -> { accepted: true, message, deliveryQueued }
//   POST /v1/auth/recovery/verify   -> { valid, reason, message }
//   POST /v1/auth/recovery/complete -> { status, message, sessionsRevoked }
//
// `deliveryQueued` is forwarded on purpose and is the only asymmetry that exists;
// it is also the reason the rate limiter must be unobservable - a caller who could
// tell "queued" from "throttled" in the response body would have the oracle back.
// The email dispatch itself is queued by the notification worker from the audit
// row, never by this handler, so a mail failure cannot turn into a 5xx that
// distinguishes a real account from an unknown one.
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type { AppRequest } from '../../common/types/request.types';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountRecoveryService } from './account-recovery.service';
import {
  CompleteAccountRecoveryDto,
  RequestAccountRecoveryDto,
  VerifyAccountRecoveryDto,
} from './dto/account-recovery.dto';

/** Five requests per hour per address, matching the service's own window. */
const RECOVERY_THROTTLE = { default: { limit: 5, ttl: 60 * 60 * 1_000 } };

@Controller('auth/recovery')
export class AccountRecoveryController {
  constructor(
    private readonly recovery: AccountRecoveryService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(RECOVERY_THROTTLE)
  async request(
    @Body() dto: RequestAccountRecoveryDto,
    @Req() request: Pick<AppRequest, 'ipHash' | 'requestId'>,
  ): Promise<{ accepted: true; message: string; deliveryQueued: boolean }> {
    const result = await this.recovery.request({
      email: dto.email,
      tenantHint: dto.tenantSlug ?? null,
      // The raw address never reaches the service; the middleware already hashed it.
      ipHash: request.ipHash ?? null,
      requestId: request.requestId,
    });
    // `tokenForDelivery` is deliberately dropped here: it belongs to the mailbox.
    return { accepted: true, message: result.message, deliveryQueued: result.deliveryQueued };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1_000 } })
  async verify(
    @Body() dto: VerifyAccountRecoveryDto,
  ): Promise<{ valid: boolean; reason: string | null; message: string }> {
    const result = await this.recovery.verify({ token: dto.token });
    return { valid: result.valid, reason: result.reason, message: result.message };
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1_000 } })
  async complete(
    @Body() dto: CompleteAccountRecoveryDto,
    @Req() request: Pick<AppRequest, 'ipHash' | 'requestId'>,
  ): Promise<{
    status: string;
    reason: string | null;
    message: string;
    sessionsRevoked: number;
    requiresTwoFactorEnrolment: boolean;
  }> {
    // Order matters and is deliberate:
    //
    //   1. Resolve the token to its account WITHOUT consuming it, so the password
    //      policy is checked against the real account (the policy compares against
    //      the email, which this controller does not otherwise know).
    //   2. Hash the new password. Nothing is written yet.
    //   3. Consume the token and revoke every session (the security half).
    //   4. Write the hash.
    //
    // Hashing before consuming means a weak password is a clean 422 that leaves the
    // link usable. Consuming before writing means a crash between the two cannot
    // leave a live token pointing at a half-recovered account.
    // 1. Resolve the account WITHOUT consuming the token.
    const account = await this.recovery.resolveAccountForToken(dto.token);
    if (!account) {
      // Nothing resolved, so fall through to the service's own refusal path: the
      // audit row and the reason code are produced in exactly one place.
      const refused = await this.recovery.complete({
        token: dto.token,
        ipHash: request.ipHash ?? null,
        requestId: request.requestId,
      });
      return {
        status: refused.status,
        reason: refused.reason,
        message: refused.message,
        sessionsRevoked: refused.sessionsRevoked,
        requiresTwoFactorEnrolment: false,
      };
    }

    // 2. Check the password policy against the real account and hash it. Nothing
    //    is written yet, so a password the policy rejects leaves the link usable.
    const owner = await this.prisma.user.findFirst({
      where: { id: account.userId, tenantId: account.tenantId, deletedAt: null },
      select: { email: true },
    });
    this.passwords.assertPolicy(dto.newPassword, { email: owner?.email ?? '' });
    const passwordHash = await this.passwords.hash(dto.newPassword);

    // 3. Burn the token and revoke every session, then 4. write the hash. In that
    //    order: a crash between the two must not leave a live token pointing at a
    //    half-recovered account.
    const result = await this.recovery.complete({
      token: dto.token,
      ipHash: request.ipHash ?? null,
      requestId: request.requestId,
    });
    if (result.status !== 'RECOVERED') {
      return {
        status: result.status,
        reason: result.reason,
        message: result.message,
        sessionsRevoked: result.sessionsRevoked,
        requiresTwoFactorEnrolment: false,
      };
    }

    await this.prisma.user.update({
      where: { id: account.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        // Bumping the version invalidates any access token minted before this
        // moment, on top of the session revocation the service performed.
        sessionVersion: { increment: 1 },
      },
    });

    return {
      status: result.status,
      reason: result.reason,
      message: result.message,
      sessionsRevoked: result.sessionsRevoked,
      requiresTwoFactorEnrolment: result.requiresTwoFactorEnrolment,
    };
  }
}
