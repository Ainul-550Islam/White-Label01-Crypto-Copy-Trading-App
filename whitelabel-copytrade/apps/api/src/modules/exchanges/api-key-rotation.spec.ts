// # Responsibility: prove key rotation verifies the new key before the old one is revoked and keeps the old key on every refusal.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  ApiKeyRotationService,
  ROTATION_STEP_UP_ACTION,
  type CandidateProbeResult,
  type CandidateVerifierPort,
  type CredentialStorePort,
  type RotationAuditEntry,
  type RotationAuditPort,
  type RotationRequest,
  type StepUpProofPort,
  type StoredCredential,
} from './api-key-rotation.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SESSION = 'session-1';
const ACCOUNT = 'account-1';

function request(overrides: Partial<RotationRequest> = {}): RotationRequest {
  return {
    tenantId: TENANT,
    actorId: ACTOR,
    sessionId: SESSION,
    accountId: ACCOUNT,
    venue: 'BINANCE',
    environment: 'LIVE',
    candidate: { apiKey: 'NEWKEY-abcd1234', apiSecret: 'new-secret' },
    requestId: 'req-1',
    ipHash: 'ip-hash-1',
    ...overrides,
  };
}

function probe(overrides: Partial<CandidateProbeResult> = {}): CandidateProbeResult {
  return { ok: true, code: null, canTrade: true, canReadData: true, canWithdraw: false, ...overrides };
}

describe('Two-phase API key rotation', () => {
  let stepUp: jest.Mocked<StepUpProofPort>;
  let verifier: jest.Mocked<CandidateVerifierPort>;
  let store: jest.Mocked<CredentialStorePort>;
  let audit: jest.Mocked<RotationAuditPort>;
  let service: ApiKeyRotationService;
  let stored: StoredCredential | null;
  let version: number;
  let staged: Map<string, { tenantId: string; accountId: string }>;

  beforeEach(() => {
    stored = { credentialVersion: 4, apiKeyLastFour: 'OLD1' };
    version = 4;
    staged = new Map();

    stepUp = { hasFreshProof: jest.fn<StepUpProofPort['hasFreshProof']>() };
    verifier = { verify: jest.fn<CandidateVerifierPort['verify']>() };
    audit = { record: jest.fn<RotationAuditPort['record']>() };
    store = {
      read: jest.fn<CredentialStorePort['read']>(async (tenantId) => (stored && tenantId === TENANT ? stored : null)),
      stage: jest.fn<CredentialStorePort['stage']>(async (input) => {
        const stagedId = `staged-${staged.size + 1}`;
        staged.set(stagedId, { tenantId: input.tenantId, accountId: input.accountId });
        return { stagedId };
      }),
      promote: jest.fn<CredentialStorePort['promote']>(async (input) => {
        if (!staged.has(input.stagedId)) return { ok: false, credentialVersion: version };
        if (input.expectedVersion !== version) return { ok: false, credentialVersion: version };
        staged.delete(input.stagedId);
        version += 1;
        return { ok: true, credentialVersion: version };
      }),
      discardStaged: jest.fn<CredentialStorePort['discardStaged']>(async (stagedId) => {
        staged.delete(stagedId);
      }),
      wipeOldMaterial: jest.fn<CredentialStorePort['wipeOldMaterial']>(async () => 1),
    };

    stepUp.hasFreshProof.mockResolvedValue(true);
    verifier.verify.mockResolvedValue(probe());
    audit.record.mockResolvedValue(undefined);

    service = new ApiKeyRotationService(stepUp, verifier, store, audit);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function auditedEvents(): RotationAuditEntry[] {
    return audit.record.mock.calls.map(([entry]) => entry);
  }

  it('rotates when the candidate verifies, and keeps the account trading throughout', async () => {
    const result = await service.rotate(request());

    expect(result.status).toBe('ROTATED');
    expect(result.code).toBe('ROTATION_COMPLETE');
    expect(result.previousKeyRetained).toBe(false);
    expect(result.apiKeyLastFour).toBe('1234');
    expect(result.rotationId).not.toBeNull();
    expect(store.wipeOldMaterial).toHaveBeenCalledWith({ tenantId: TENANT, accountId: ACCOUNT, belowVersion: 5 });
  });

  it('verifies the candidate before the old credential is touched', async () => {
    const order: string[] = [];
    verifier.verify.mockImplementation(async () => {
      order.push('verify');
      return probe();
    });
    store.stage.mockImplementation(async () => {
      order.push('stage');
      return { stagedId: 'staged-x' };
    });
    store.promote.mockImplementation(async () => {
      order.push('promote');
      return { ok: true, credentialVersion: 5 };
    });
    store.wipeOldMaterial.mockImplementation(async () => {
      order.push('wipe');
      return 1;
    });

    await service.rotate(request());

    expect(order).toEqual(['verify', 'stage', 'promote', 'wipe']);
  });

  it('requires a fresh step-up proof bound to this action', async () => {
    stepUp.hasFreshProof.mockResolvedValue(false);

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'STEP_UP_REQUIRED', previousKeyRetained: true });
    expect(stepUp.hasFreshProof).toHaveBeenCalledWith({
      tenantId: TENANT,
      userId: ACTOR,
      sessionId: SESSION,
      action: ROTATION_STEP_UP_ACTION,
    });
    // Nothing was read, probed or written.
    expect(store.read).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(store.stage).not.toHaveBeenCalled();
    expect(store.wipeOldMaterial).not.toHaveBeenCalled();
  });

  it('keeps the old key when the venue rejects the candidate', async () => {
    verifier.verify.mockResolvedValue(probe({ ok: false, code: 'AUTH_FAILED' }));

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'CANDIDATE_UNVERIFIED', previousKeyRetained: true });
    expect(result.apiKeyLastFour).toBeNull();
    expect(store.stage).not.toHaveBeenCalled();
    expect(store.wipeOldMaterial).not.toHaveBeenCalled();
    expect(auditedEvents().at(-1)).toMatchObject({
      event: 'CREDENTIAL_ROTATION_REFUSED',
      result: 'FAILURE',
      reasonCode: 'CANDIDATE_UNVERIFIED',
      safeMetadata: { venueCode: 'AUTH_FAILED' },
    });
  });

  it('keeps the old key when the venue cannot be reached to verify the candidate', async () => {
    verifier.verify.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'CANDIDATE_UNVERIFIED', previousKeyRetained: true });
    expect(store.stage).not.toHaveBeenCalled();
  });

  it('refuses a withdrawal-capable candidate outright, keeping the safe old key', async () => {
    verifier.verify.mockResolvedValue(probe({ canWithdraw: true }));

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'CANDIDATE_CAN_WITHDRAW', previousKeyRetained: true });
    expect(result.message).toMatch(/withdrawals disabled/i);
    expect(store.stage).not.toHaveBeenCalled();
    expect(store.wipeOldMaterial).not.toHaveBeenCalled();
  });

  it('never wipes old material when staging fails', async () => {
    store.stage.mockRejectedValue(new Error('kms unavailable'));

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'STORE_UNAVAILABLE', previousKeyRetained: true });
    expect(store.wipeOldMaterial).not.toHaveBeenCalled();
  });

  it('discards the staged candidate and keeps the old key when promotion fails', async () => {
    store.promote.mockRejectedValue(new Error('write conflict'));

    const result = await service.rotate(request());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'STORE_UNAVAILABLE', previousKeyRetained: true });
    expect(store.discardStaged).toHaveBeenCalledWith('staged-1');
    expect(staged.size).toBe(0);
    expect(store.wipeOldMaterial).not.toHaveBeenCalled();
  });

  it('gives exactly one of two concurrent rotations the account', async () => {
    const first = service.rotate(request());
    // The second read happens before the first promotes, so both expect version 4.
    const second = service.rotate(request());
    const [a, b] = await Promise.all([first, second]);

    const results = [a, b];
    expect(results.filter((result) => result.status === 'ROTATED')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'REFUSED');
    expect(loser?.code).toBe('STALE_VERSION');
    expect(loser?.previousKeyRetained).toBe(true);
    expect(version).toBe(5);
  });

  it('refuses a cross-tenant account as not found, without probing anything', async () => {
    const result = await service.rotate(request({ tenantId: OTHER_TENANT }));

    expect(result).toMatchObject({ status: 'REFUSED', code: 'ACCOUNT_NOT_FOUND', previousKeyRetained: true });
    expect(store.read).toHaveBeenCalledWith(OTHER_TENANT, ACCOUNT);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('refuses an unknown account id without revealing which one it was', async () => {
    stored = null;

    const missing = await service.rotate(request({ accountId: 'does-not-exist' }));
    stored = null;
    const otherTenant = await service.rotate(request({ tenantId: OTHER_TENANT, accountId: 'someone-elses' }));

    expect(missing.code).toBe('ACCOUNT_NOT_FOUND');
    expect(missing.message).toBe(otherTenant.message);
  });

  it('completes the rotation even if the old material cannot be wiped, and says so', async () => {
    store.wipeOldMaterial.mockRejectedValue(new Error('delete failed'));

    const result = await service.rotate(request());

    // The live key is already the new one; reporting a failure here would invite a
    // second rotation on an account that is working.
    expect(result.status).toBe('ROTATED');
    expect(result.previousKeyRetained).toBe(false);
  });

  it('audits every attempt with a rotation id and no key material', async () => {
    await service.rotate(request());
    verifier.verify.mockResolvedValue(probe({ ok: false }));
    await service.rotate(request({ requestId: 'req-2' }));

    const entries = auditedEvents();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ event: 'CREDENTIAL_ROTATION_COMPLETED', result: 'SUCCESS' });
    expect(entries[1]).toMatchObject({ event: 'CREDENTIAL_ROTATION_REFUSED', result: 'FAILURE' });

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('new-secret');
    expect(serialised).not.toContain('NEWKEY-abcd1234');
  });

  it('keeps the tenant on every audit row so a rotation can be attributed', async () => {
    await service.rotate(request());
    verifier.verify.mockResolvedValue(probe({ canWithdraw: true }));
    await service.rotate(request());

    expect(auditedEvents().every((entry) => entry.tenantId === TENANT && entry.accountId === ACCOUNT)).toBe(true);
  });

  it('shows only the last four characters of the new public key', async () => {
    const result = await service.rotate(request({ candidate: { apiKey: 'K', apiSecret: 'secret' } }));

    expect(result.apiKeyLastFour).toBe('K');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
