// # Issues and atomically consumes action-bound, single-use step-up proofs for sensitive operations, reusing the existing password/TOTP/recovery verifiers and auditing every issuance, consumption and refusal.
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  type AuthenticatedActor,
  type StepUpAction,
  type StepUpMethod,
  type StepUpProofIssued,
  type StepUpStatus,
} from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { AuditService } from '../audit/audit.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { TwoFactorService } from './services/two-factor.service';

/**
 * Step-up authentication, action-bound and single-use.
 *
 * THE PROBLEM WITH A TIME-BOUND GRANT
 * -----------------------------------
 * The previous implementation stored one grant per (tenant, user, session) for
 * N seconds and every decorated route read it. That is a *session elevation*,
 * not a step-up: after one TOTP entry an attacker (or a malicious script in
 * the page) could rotate a key, revoke a key, disable 2FA and approve a payout
 * for the rest of the window, and a proof obtained for reading was
 * indistinguishable from a proof obtained for paying out.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 *  - The proof records the ACTION it was issued for. A proof for action A is
 *    refused for action B, and the refusal does not spend it.
 *  - Consumption is atomic. A Lua script reads the proof, checks the binding and
 *    deletes it in one round trip, so two concurrent requests carrying the same
 *    proof cannot both succeed - exactly one wins and the other is refused. A
 *    get-then-delete pair in application code cannot promise that.
 *  - The binding is (tenantId, userId, sessionId, action). A proof issued in one
 *    session is useless in another, and a proof from another tenant cannot be
 *    presented at all: the key is derived from the caller's own principal.
 *  - Redis unavailable is a refusal. A verification store that fails open is a
 *    verification store that is bypassed by taking it down.
 *
 * The credential itself is still verified by the existing services - the
 * password hash comparison, the TOTP window and the recovery-code burn are not
 * reimplemented here, they are called.
 */

export interface StepUpProof {
  proofId: string;
  action: StepUpAction;
  method: StepUpMethod;
  tenantId: string;
  userId: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
}

export type IssuedStepUpProof = StepUpProofIssued;

export interface StepUpConsumeResult {
  consumed: boolean;
  action: StepUpAction | null;
  reasonCode:
    | 'CONSUMED'
    | 'NO_PROOF'
    | 'ACTION_MISMATCH'
    | 'SESSION_MISMATCH'
    | 'USER_MISMATCH'
    | 'TENANT_MISMATCH'
    | 'EXPIRED'
    | 'STORE_UNAVAILABLE'
    | 'MALFORMED';
  proof: StepUpProof | null;
}

export interface StepUpSecurityContext {
  ipHash: string;
  requestId: string;
  userAgent?: string | null;
}

/**
 * Atomic read-check-delete.
 *
 * KEYS[1] = the proof key. ARGV[1] = the action the caller is attempting,
 * ARGV[2] = tenantId, ARGV[3] = userId, ARGV[4] = sessionId, ARGV[5] = now (ms).
 *
 * Returns the proof JSON on success (and deletes it), or a short refusal code
 * with the proof left in place, so a mismatch cannot be used to burn somebody
 * else's proof.
 */
export const STEP_UP_CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'NO_PROOF' end
local ok, proof = pcall(cjson.decode, raw)
if not ok or type(proof) ~= 'table' then
  redis.call('DEL', KEYS[1])
  return 'MALFORMED'
end
if proof['action'] ~= ARGV[1] then return 'ACTION_MISMATCH' end
if proof['tenantId'] ~= ARGV[2] then return 'TENANT_MISMATCH' end
if proof['userId'] ~= ARGV[3] then return 'USER_MISMATCH' end
if proof['sessionId'] ~= ARGV[4] then return 'SESSION_MISMATCH' end
if tonumber(proof['expiresAtMs']) <= tonumber(ARGV[5]) then
  redis.call('DEL', KEYS[1])
  return 'EXPIRED'
end
redis.call('DEL', KEYS[1])
return raw
`;

@Injectable()
export class StepUpAuthService {
  private readonly logger = new Logger(StepUpAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly twoFactor: TwoFactorService,
    private readonly lockout: AccountLockoutService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Verify a credential and mint a single-use proof for exactly one action. */
  async issue(
    actor: AuthenticatedActor,
    input: { method: StepUpMethod; action: StepUpAction; code?: string; password?: string; recoveryCode?: string },
    context: StepUpSecurityContext,
  ): Promise<IssuedStepUpProof> {
    // Both tables enforce tenant RLS. An unscoped lookup makes an active
    // session invisible (or relies on an unsafe BYPASSRLS application role).
    const [user, session] = await this.prisma.withTenantRls(actor.tenantId, (tx) => Promise.all([
      tx.user.findFirst({
        where: { id: actor.userId, tenantId: actor.tenantId, deletedAt: null },
        select: { id: true, email: true, passwordHash: true, status: true },
      }),
      tx.userSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          tenantId: actor.tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, deviceId: true },
      }),
    ]));
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
          ...(input.method === 'TOTP' ? { code: input.code } : { recoveryCode: input.recoveryCode }),
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
      await this.audit.recordImmediate({
        tenantId: actor.tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: 'STEP_UP_ISSUE_DENIED',
        outcome: AuditOutcome.FAILURE,
        resourceType: 'SensitiveOperation',
        description: 'Step-up credential verification failed.',
        ipHash: context.ipHash,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId,
        metadata: { action: input.action, method: input.method, reason: 'INVALID_CREDENTIAL' },
      });
      throw new AppException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'The step-up credential is invalid.',
      });
    }

    await this.lockout.clear(actor.tenantId, user.email, actor.userId);

    const now = Date.now();
    const ttlSeconds = this.config.stepUpTtlSeconds;
    const proofId = randomUUID();
    const proof: StepUpProof & { expiresAtMs: number } = {
      proofId,
      action: input.action,
      method: input.method,
      tenantId: actor.tenantId,
      userId: actor.userId,
      sessionId: actor.sessionId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
      expiresAtMs: now + ttlSeconds * 1000,
    };

    try {
      await this.redis.client.set(this.key(actor), JSON.stringify(proof), 'EX', ttlSeconds);
    } catch (error) {
      // No proof -> no sensitive operation. Reporting success here would hand the
      // caller a proof id that verifies nothing.
      this.logger.error(`Step-up proof store unavailable tenant=${actor.tenantId} (${error instanceof Error ? error.name : 'unknown error'})`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Step-up verification is unavailable; the action was not authorised.',
      });
    }

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: 'STEP_UP_PROOF_ISSUED',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'SensitiveOperation',
      resourceId: proofId,
      description: 'Single-use, action-bound step-up proof issued.',
      ipHash: context.ipHash,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId,
      metadata: { action: input.action, method: input.method, ttlSeconds },
    });

    return { proofId, action: input.action, method: input.method, expiresAt: proof.expiresAt, ttlSeconds };
  }

  /**
   * Consume the caller's proof for `action`. Exactly one caller can succeed.
   *
   * Never throws for a refusal: the caller (a guard) needs a boolean and an
   * auditable reason, and an exception here would be caught and rendered as a
   * 500 for what is an ordinary 403.
   */
  async consume(actor: AuthenticatedActor, action: StepUpAction): Promise<StepUpConsumeResult> {
    let raw: unknown;
    try {
      raw = await this.redis.client.eval(
        STEP_UP_CONSUME_LUA,
        1,
        this.key(actor),
        action,
        actor.tenantId,
        actor.userId,
        actor.sessionId,
        String(Date.now()),
      );
    } catch (error) {
      this.logger.warn(`Step-up store unavailable tenant=${actor.tenantId} (${error instanceof Error ? error.name : 'unknown error'})`);
      return { consumed: false, action: null, reasonCode: 'STORE_UNAVAILABLE', proof: null };
    }

    if (typeof raw !== 'string' || raw.length === 0) {
      return { consumed: false, action: null, reasonCode: 'MALFORMED', proof: null };
    }
    if (!raw.trimStart().startsWith('{')) {
      return { consumed: false, action: null, reasonCode: raw as StepUpConsumeResult['reasonCode'], proof: null };
    }

    try {
      const proof = JSON.parse(raw) as StepUpProof;
      return { consumed: true, action: proof.action, reasonCode: 'CONSUMED', proof };
    } catch {
      return { consumed: false, action: null, reasonCode: 'MALFORMED', proof: null };
    }
  }

  /** Read-only status for the dialog: is there a live proof for this action? */
  async status(actor: AuthenticatedActor, action: StepUpAction | null): Promise<StepUpStatus> {
    if (!action) return { fresh: false, action: null, expiresAt: null };
    try {
      const raw = await this.redis.client.get(this.key(actor));
      if (!raw) return { fresh: false, action, expiresAt: null };
      const proof = JSON.parse(raw) as StepUpProof & { expiresAtMs?: number };
      const expiresMs = typeof proof.expiresAtMs === 'number' ? proof.expiresAtMs : Date.parse(proof.expiresAt);
      if (proof.action !== action || !Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
        return { fresh: false, action, expiresAt: null };
      }
      return { fresh: true, action, expiresAt: new Date(expiresMs).toISOString() };
    } catch {
      return { fresh: false, action, expiresAt: null };
    }
  }

  /**
   * The guard's entry point: consume and audit in one place so a refusal is
   * always recorded with the reason the store gave.
   */
  async consumeForRoute(
    actor: AuthenticatedActor | null,
    action: StepUpAction,
    context: Partial<StepUpSecurityContext> & { path?: string; method?: string },
  ): Promise<boolean> {
    if (!actor) {
      await this.audit.recordImmediate({
        tenantId: null,
        actorType: AuditActorType.USER,
        actorId: null,
        action: 'STEP_UP_ROUTE_DENIED',
        outcome: AuditOutcome.FAILURE,
        resourceType: 'SensitiveOperation',
        description: 'Sensitive operation refused without an authenticated principal.',
        ipHash: context.ipHash ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
        metadata: { action, path: context.path ?? null, method: context.method ?? null, reason: 'NO_ACTOR' },
      });
      return false;
    }
    const result = await this.consume(actor, action);
    // Payouts and withdrawal destinations require a second factor, not merely
    // a repeated password. A consumed password proof is denied and cannot be reused.
    const mfaRequired = action === 'PAYOUT_CREATE';
    const allowed = result.consumed && (!mfaRequired || result.proof?.method === 'TOTP' || result.proof?.method === 'RECOVERY_CODE');
    const denialReason = result.consumed && !allowed ? 'MFA_REQUIRED' : result.reasonCode;
    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: allowed ? 'STEP_UP_ROUTE_ALLOWED' : 'STEP_UP_ROUTE_DENIED',
      outcome: allowed ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
      resourceType: 'SensitiveOperation',
      description: allowed
        ? 'Single-use step-up proof consumed for this action.'
        : 'Sensitive operation refused: no usable single-use proof for this action.',
      ipHash: context.ipHash ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
      metadata: {
        action,
        path: context.path ?? null,
        method: context.method ?? null,
        reason: denialReason,
        proofId: result.proof?.proofId ?? null,
      },
    });
    return allowed;
  }

  private key(actor: AuthenticatedActor): string {
    return `stepup:proof:${actor.tenantId}:${actor.userId}:${actor.sessionId}`;
  }
}
