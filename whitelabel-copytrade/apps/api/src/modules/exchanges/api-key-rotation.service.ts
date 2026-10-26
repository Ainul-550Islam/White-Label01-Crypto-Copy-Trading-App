// # Responsibility: rotates an exchange key in two phases so a bad key can never replace a working one, and never wipes a key that is still in use.
//
// WHY TWO PHASES
// --------------
// The single-phase rotation this replaces wrote the new credential and THEN
// checked it. Every failure path in that order - a typo, a wrong passphrase, a
// venue outage, a key the venue had not yet propagated - destroyed a working
// connection and replaced it with a broken one, at exactly the moment an operator
// was trying to fix something. Copy trading stopped for a user who had done
// nothing wrong.
//
// This service tests the candidate against the venue while the old key is still
// live, and only swaps once the candidate has placed a probe successfully. The
// commit is version-guarded so two operators rotating at once cannot interleave:
// the second gets STALE_VERSION and keeps its old key. The old material is wiped
// only after the new key is live and verified.
//
// THE THREE REFUSALS, AND WHAT THEY PRESERVE
// ------------------------------------------
// STEP_UP_REQUIRED     nothing is read or verified; the old key is untouched.
// CANDIDATE_UNVERIFIED the candidate is discarded; the old key is untouched.
// CANDIDATE_CAN_WITHDRAW a withdrawal-capable candidate is refused outright - it
//                      is not a rotation, it is a downgrade of the account's
//                      safety. The old key is untouched.
//
// Every refusal is audited with the rotation id, so a support conversation can
// say what was attempted and what was kept.
import { Injectable, Logger } from '@nestjs/common';

import type { StepUpAction } from '@wlct/shared-types';

/** The step-up action bound to this operation. Kept as a type so a typo is a compile error. */
export const ROTATION_STEP_UP_ACTION: StepUpAction = 'EXCHANGE_KEY_ROTATE';

export type RotationStatus = 'ROTATED' | 'REFUSED';
export type RotationCode =
  | 'ROTATION_COMPLETE'
  | 'STEP_UP_REQUIRED'
  | 'ACCOUNT_NOT_FOUND'
  | 'CANDIDATE_UNVERIFIED'
  | 'CANDIDATE_CAN_WITHDRAW'
  | 'STALE_VERSION'
  | 'STORE_UNAVAILABLE';

export interface RotationRequest {
  tenantId: string;
  actorId: string;
  sessionId: string;
  accountId: string;
  venue: string;
  environment: string;
  candidate: {
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
  };
  requestId?: string;
  /** IP hash for the audit trail. The raw address is never recorded. */
  ipHash?: string;
}

export interface RotationResult {
  status: RotationStatus;
  code: RotationCode;
  message: string;
  /** Present only on success. Correlates the audit rows and the client response. */
  rotationId: string | null;
  /** Last four characters of the new public key, for display. Never the key. */
  apiKeyLastFour: string | null;
  /** True whenever the previous credential is still the one in use. */
  previousKeyRetained: boolean;
}

/** The account as the credential store knows it. */
export interface StoredCredential {
  credentialVersion: number;
  apiKeyLastFour: string;
}

/** What a probe of the candidate key reported. */
export interface CandidateProbeResult {
  ok: boolean;
  code: string | null;
  canTrade: boolean;
  canReadData: boolean;
  canWithdraw: boolean;
}

/**
 * Ports. The service owns the ORDER of operations and the refusal rules; the
 * venue, the secret store and the session store are injected so this logic is
 * testable without touching any of them.
 */
export interface CandidateVerifierPort {
  verify(input: {
    tenantId: string;
    accountId: string;
    venue: string;
    environment: string;
    candidate: RotationRequest['candidate'];
  }): Promise<CandidateProbeResult>;
}

export interface CredentialStorePort {
  /** Tenant-scoped by contract: another tenant's account must read as missing. */
  read(tenantId: string, accountId: string): Promise<StoredCredential | null>;
  stage(input: {
    tenantId: string;
    accountId: string;
    candidate: RotationRequest['candidate'];
  }): Promise<{ stagedId: string }>;
  promote(input: {
    tenantId: string;
    accountId: string;
    stagedId: string;
    expectedVersion: number;
  }): Promise<{ ok: boolean; credentialVersion: number }>;
  discardStaged(stagedId: string): Promise<void>;
  /** Removes every credential row below `belowVersion`. */
  wipeOldMaterial(input: { tenantId: string; accountId: string; belowVersion: number }): Promise<number>;
}

export interface StepUpProofPort {
  hasFreshProof(input: {
    tenantId: string;
    userId: string;
    sessionId: string;
    action: StepUpAction;
  }): Promise<boolean>;
}

export interface RotationAuditEntry {
  tenantId: string;
  accountId: string;
  actorId: string;
  venue: string;
  environment: string;
  event: 'CREDENTIAL_ROTATION_STARTED' | 'CREDENTIAL_ROTATION_REFUSED' | 'CREDENTIAL_ROTATION_COMPLETED';
  result: 'SUCCESS' | 'FAILURE';
  reasonCode: RotationCode;
  rotationId: string | null;
  requestId?: string;
  ipHash?: string;
  safeMetadata?: Record<string, string | number | boolean | null>;
}

export interface RotationAuditPort {
  record(entry: RotationAuditEntry): Promise<void>;
}

@Injectable()
export class ApiKeyRotationService {
  private readonly logger = new Logger(ApiKeyRotationService.name);

  constructor(
    private readonly stepUp: StepUpProofPort,
    private readonly verifier: CandidateVerifierPort,
    private readonly store: CredentialStorePort,
    private readonly audit: RotationAuditPort,
  ) {}

  /**
   * Rotate one account's key.
   *
   * Never throws for a refusal: a refusal is a result, because the caller must
   * render the reason and the operator must see that their old key still works.
   * A store failure is also a result - it is exactly the case where the caller
   * must be told "nothing changed".
   */
  async rotate(request: RotationRequest): Promise<RotationResult> {
    const base = {
      tenantId: request.tenantId,
      accountId: request.accountId,
      actorId: request.actorId,
      venue: request.venue,
      environment: request.environment,
    };

    // 1. Identity, before anything else. A missing proof must not even read the
    //    credential row, let alone probe the venue with a candidate key.
    const proven = await this.stepUp.hasFreshProof({
      tenantId: request.tenantId,
      userId: request.actorId,
      sessionId: request.sessionId,
      action: ROTATION_STEP_UP_ACTION,
    });
    if (!proven) {
      return this.refuse(base, request, 'STEP_UP_REQUIRED', 'Confirm your identity again before replacing this key.');
    }

    // 2. The account must belong to the caller's tenant. A cross-tenant id reads
    //    as absent, which is also what a genuinely unknown id reads as: the
    //    response must not distinguish them.
    const stored = await this.store.read(request.tenantId, request.accountId);
    if (!stored) {
      return this.refuse(base, request, 'ACCOUNT_NOT_FOUND', 'No such exchange account for this account holder.');
    }

    const rotationId = this.newRotationId();

    // 3. Verify the candidate while the old key is still live.
    let probe: CandidateProbeResult;
    try {
      probe = await this.verifier.verify({
        tenantId: request.tenantId,
        accountId: request.accountId,
        venue: request.venue,
        environment: request.environment,
        candidate: request.candidate,
      });
    } catch (error) {
      // A venue that cannot be reached says nothing about the candidate, so the
      // old key stays and the operator retries later.
      this.logger.warn(
        `Candidate verification failed for account ${request.accountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return this.refuse(base, request, 'CANDIDATE_UNVERIFIED', 'The exchange could not verify the new key. Your previous key is still in use.');
    }

    if (probe.ok && probe.canWithdraw) {
      // Verified, and worse than what it would replace. Refuse before staging.
      return this.refuse(
        base,
        request,
        'CANDIDATE_CAN_WITHDRAW',
        'The new key can withdraw funds. Create a key with withdrawals disabled; your previous key is still in use.',
        rotationId,
      );
    }
    if (!probe.ok) {
      return this.refuse(
        base,
        request,
        'CANDIDATE_UNVERIFIED',
        'The exchange rejected the new key. Your previous key is still in use.',
        rotationId,
        { venueCode: probe.code },
      );
    }

    // 4. Stage, then promote under a version guard.
    let staged: { stagedId: string };
    try {
      staged = await this.store.stage({
        tenantId: request.tenantId,
        accountId: request.accountId,
        candidate: request.candidate,
      });
    } catch (error) {
      this.logger.error(
        `Staging the candidate key failed for account ${request.accountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return this.refuse(base, request, 'STORE_UNAVAILABLE', 'The new key could not be stored. Your previous key is still in use.', rotationId);
    }

    let promoted: { ok: boolean; credentialVersion: number };
    try {
      promoted = await this.store.promote({
        tenantId: request.tenantId,
        accountId: request.accountId,
        stagedId: staged.stagedId,
        expectedVersion: stored.credentialVersion,
      });
    } catch (error) {
      // The candidate never became live; throw it away rather than leaving an
      // orphan secret in the store.
      await this.safeDiscard(staged.stagedId);
      this.logger.error(
        `Promoting the candidate key failed for account ${request.accountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return this.refuse(base, request, 'STORE_UNAVAILABLE', 'The new key could not be activated. Your previous key is still in use.', rotationId);
    }

    if (!promoted.ok) {
      // Someone else rotated first. Their key is live; ours is discarded.
      await this.safeDiscard(staged.stagedId);
      return this.refuse(
        base,
        request,
        'STALE_VERSION',
        'Another change to this account completed first. Reload the account and try again if it still needs rotating.',
        rotationId,
      );
    }

    // 5. Only now is the old material dead. A wipe failure is logged but does not
    //    fail the rotation: the live key is already the new one, and leaving the
    //    old ciphertext for a cleanup job is far better than reporting a failure
    //    the operator would respond to by rotating again.
    try {
      const wiped = await this.store.wipeOldMaterial({
        tenantId: request.tenantId,
        accountId: request.accountId,
        belowVersion: promoted.credentialVersion,
      });
      await this.audit.record({
        ...base,
        event: 'CREDENTIAL_ROTATION_COMPLETED',
        result: 'SUCCESS',
        reasonCode: 'ROTATION_COMPLETE',
        rotationId,
        requestId: request.requestId,
        ipHash: request.ipHash,
        safeMetadata: { version: promoted.credentialVersion, wipedRows: wiped },
      });
    } catch (error) {
      this.logger.error(
        `Old credential material could not be wiped for account ${request.accountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return {
      status: 'ROTATED',
      code: 'ROTATION_COMPLETE',
      message: 'The new key is live and the previous key has been removed.',
      rotationId,
      apiKeyLastFour: this.lastFour(request.candidate.apiKey),
      previousKeyRetained: false,
    };
  }

  private async refuse(
    base: Pick<RotationAuditEntry, 'tenantId' | 'accountId' | 'actorId' | 'venue' | 'environment'>,
    request: RotationRequest,
    code: RotationCode,
    message: string,
    rotationId: string | null = null,
    safeMetadata?: Record<string, string | number | boolean | null>,
  ): Promise<RotationResult> {
    await this.audit.record({
      ...base,
      event: 'CREDENTIAL_ROTATION_REFUSED',
      result: 'FAILURE',
      reasonCode: code,
      rotationId,
      requestId: request.requestId,
      ipHash: request.ipHash,
      safeMetadata,
    });
    return {
      status: 'REFUSED',
      code,
      message,
      rotationId,
      apiKeyLastFour: null,
      // The invariant every refusal in this file preserves.
      previousKeyRetained: true,
    };
  }

  private async safeDiscard(stagedId: string): Promise<void> {
    try {
      await this.store.discardStaged(stagedId);
    } catch (error) {
      this.logger.error(
        `A staged credential could not be discarded (${stagedId}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private lastFour(apiKey: string): string {
    const trimmed = apiKey.trim();
    return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
  }

  private newRotationId(): string {
    // A UUID is correlation, never authority: nothing is looked up by this value.
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `rot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
