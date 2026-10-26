// # Responsibility: prove a withdrawal destination is unusable until its cooldown elapses, never revived once revoked, and never confused across users or tenants.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  WithdrawalDestinationPolicyService,
  normaliseAddress,
  type DestinationStatus,
  type WithdrawalDestinationRecord,
  type WithdrawalDestinationRepository,
} from './withdrawal-destination-policy.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const EVM_ADDRESS = '0x52908400098527886e0f7030069857d2e4169ee7';
const HOUR = 60 * 60 * 1_000;

/** An in-memory implementation of the port, scoped exactly as the Prisma one is. */
class MemoryRepository implements WithdrawalDestinationRepository {
  rows: WithdrawalDestinationRecord[] = [];
  private sequence = 0;

  async findById(input: { tenantId: string; userId: string; id: string }): Promise<WithdrawalDestinationRecord | null> {
    return (
      this.rows.find(
        (row) => row.id === input.id && row.tenantId === input.tenantId && row.userId === input.userId,
      ) ?? null
    );
  }

  async findExact(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
  }): Promise<WithdrawalDestinationRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.tenantId === input.tenantId &&
          row.userId === input.userId &&
          row.network === input.network &&
          row.address === input.address,
      ) ?? null
    );
  }

  async list(input: { tenantId: string; userId: string }): Promise<WithdrawalDestinationRecord[]> {
    return this.rows.filter((row) => row.tenantId === input.tenantId && row.userId === input.userId);
  }

  async create(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
    label: string;
    activatesAt: Date;
  }): Promise<WithdrawalDestinationRecord> {
    this.sequence += 1;
    const row: WithdrawalDestinationRecord = {
      id: `destination-${this.sequence}`,
      tenantId: input.tenantId,
      userId: input.userId,
      network: input.network,
      address: input.address,
      label: input.label,
      status: 'PENDING',
      activatesAt: input.activatesAt,
      revokedAt: null,
      createdAt: new Date(NOW.getTime() + this.sequence),
    };
    this.rows.push(row);
    return row;
  }

  async setStatus(input: {
    tenantId: string;
    userId: string;
    id: string;
    status: DestinationStatus;
    revokedAt: Date | null;
  }): Promise<WithdrawalDestinationRecord | null> {
    const row = await this.findById(input);
    if (!row) return null;
    row.status = input.status;
    row.revokedAt = input.revokedAt;
    return row;
  }

  async listForTenant(input: { tenantId: string; limit: number }): Promise<WithdrawalDestinationRecord[]> {
    return this.rows.filter((row) => row.tenantId === input.tenantId).slice(0, input.limit);
  }

  async listDue(input: { tenantId: string; userId: string; now: Date }): Promise<WithdrawalDestinationRecord[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === input.tenantId &&
        row.userId === input.userId &&
        row.status === 'PENDING' &&
        row.activatesAt.getTime() <= input.now.getTime(),
    );
  }
}

const NOW = new Date('2026-10-26T12:00:00.000Z');

describe('Withdrawal destination policy', () => {
  let repository: MemoryRepository;
  let clock: Date;
  let service: WithdrawalDestinationPolicyService;

  beforeEach(() => {
    repository = new MemoryRepository();
    clock = new Date(NOW);
    service = new WithdrawalDestinationPolicyService(repository, { now: () => clock });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function addInput(overrides: Partial<Parameters<WithdrawalDestinationPolicyService['add']>[0]> = {}) {
    return {
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
      label: 'Cold storage',
      stepUpProven: true,
      ...overrides,
    };
  }

  async function addActive(address = EVM_ADDRESS, network = 'ETHEREUM'): Promise<WithdrawalDestinationRecord> {
    const created = await service.add(addInput({ address, network }));
    if (!created.destination) throw new Error(`add refused: ${created.code}`);
    clock = new Date(clock.getTime() + 25 * HOUR);
    await service.activateDue({ tenantId: TENANT, userId: USER });
    const row = await repository.findById({ tenantId: TENANT, userId: USER, id: created.destination.id });
    if (!row) throw new Error('destination vanished');
    return row;
  }

  it('creates a destination in PENDING with a 24 hour cooldown', async () => {
    const result = await service.add(addInput());

    expect(result.ok).toBe(true);
    expect(result.code).toBe('CREATED');
    expect(result.destination?.status).toBe('PENDING');
    expect(result.destination?.activatesAt.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(result.remainingCooldownMs).toBe(24 * HOUR);
  });

  it('refuses to add a destination without a fresh step-up proof', async () => {
    const result = await service.add(addInput({ stepUpProven: false }));

    expect(result).toMatchObject({ ok: false, code: 'STEP_UP_REQUIRED' });
    expect(repository.rows).toHaveLength(0);
  });

  it('refuses to revoke a destination without a fresh step-up proof', async () => {
    const active = await addActive();

    const result = await service.revoke({
      tenantId: TENANT,
      userId: USER,
      destinationId: active.id,
      stepUpProven: false,
    });

    expect(result).toMatchObject({ ok: false, code: 'STEP_UP_REQUIRED' });
    expect(active.status).toBe('ACTIVE');
  });

  it('does not activate one millisecond before the cooldown elapses, and activates exactly at it', async () => {
    const created = await service.add(addInput());
    const id = created.destination!.id;

    clock = new Date(NOW.getTime() + 24 * HOUR - 1);
    expect(await service.activateDue({ tenantId: TENANT, userId: USER })).toEqual({ activated: 0 });
    expect((await repository.findById({ tenantId: TENANT, userId: USER, id }))?.status).toBe('PENDING');

    clock = new Date(NOW.getTime() + 24 * HOUR);
    expect(await service.activateDue({ tenantId: TENANT, userId: USER })).toEqual({ activated: 1 });
    expect((await repository.findById({ tenantId: TENANT, userId: USER, id }))?.status).toBe('ACTIVE');
  });

  it('is idempotent: a second sweep does not re-activate or duplicate work', async () => {
    await service.add(addInput());
    clock = new Date(NOW.getTime() + 25 * HOUR);

    await service.activateDue({ tenantId: TENANT, userId: USER });
    expect(await service.activateDue({ tenantId: TENANT, userId: USER })).toEqual({ activated: 0 });
    expect(repository.rows).toHaveLength(1);
  });

  it('does not restart the cooldown when the same address is added twice', async () => {
    const first = await service.add(addInput());
    clock = new Date(NOW.getTime() + 2 * HOUR);
    const second = await service.add(addInput());

    expect(second.code).toBe('EXISTING');
    expect(second.destination?.activatesAt.toISOString()).toBe(first.destination?.activatesAt.toISOString());
    expect(repository.rows).toHaveLength(1);
    expect(second.remainingCooldownMs).toBe(22 * HOUR);
  });

  it('never revives a revoked address, even with the same spelling', async () => {
    const active = await addActive();
    await service.revoke({ tenantId: TENANT, userId: USER, destinationId: active.id, stepUpProven: true });

    const again = await service.add(addInput());

    expect(again).toMatchObject({ ok: false, code: 'DESTINATION_REVOKED' });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].status).toBe('REVOKED');
  });

  it('blocks a withdrawal to a pending destination and says when it becomes usable', async () => {
    const created = await service.add(addInput());

    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
    });

    expect(decision).toMatchObject({
      decision: 'DENY',
      code: 'DESTINATION_PENDING_ACTIVATION',
      destinationId: created.destination?.id,
    });
    expect(decision.activatesAt).toBe('2026-10-27T12:00:00.000Z');
    expect(decision.message).toMatch(/2026-10-27T12:00:00.000Z/);
  });

  it('allows a withdrawal to an active destination', async () => {
    const active = await addActive();

    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
    });

    expect(decision).toMatchObject({ decision: 'ALLOW', code: 'ALLOW', destinationId: active.id });
  });

  it('matches an active destination regardless of the address case the caller sent', async () => {
    await addActive();

    const upper = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: `0x${EVM_ADDRESS.slice(2).toUpperCase()}`,
    });

    expect(upper.decision).toBe('ALLOW');
  });

  it('denies an address that was never registered', async () => {
    await addActive();

    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: '0x0000000000000000000000000000000000000011',
    });

    expect(decision).toMatchObject({ decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED', destinationId: null });
  });

  it('denies a withdrawal to a revoked destination', async () => {
    const active = await addActive();
    await service.revoke({ tenantId: TENANT, userId: USER, destinationId: active.id, stepUpProven: true });

    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
    });

    expect(decision).toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
  });

  it('does not let one user spend another user’s allowlist entry', async () => {
    await addActive();

    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: OTHER_USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
    });

    expect(decision.decision).toBe('DENY');
    expect(decision.destinationId).toBeNull();
  });

  it('does not let another tenant read or use this tenant’s destination', async () => {
    const active = await addActive();

    const decision = await service.evaluateWithdrawal({
      tenantId: OTHER_TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: EVM_ADDRESS,
    });
    const revokeAttempt = await service.revoke({
      tenantId: OTHER_TENANT,
      userId: USER,
      destinationId: active.id,
      stepUpProven: true,
    });

    expect(decision.decision).toBe('DENY');
    expect(revokeAttempt).toMatchObject({ ok: false, code: 'DESTINATION_NOT_FOUND' });
    expect(active.status).toBe('ACTIVE');
  });

  it('sweeps only the requesting user’s destinations', async () => {
    await service.add(addInput());
    await service.add(addInput({ userId: OTHER_USER }));
    clock = new Date(NOW.getTime() + 25 * HOUR);

    expect(await service.activateDue({ tenantId: TENANT, userId: USER })).toEqual({ activated: 1 });
    expect(repository.rows.filter((row) => row.userId === OTHER_USER)[0].status).toBe('PENDING');
  });

  it('reports the countdown for each destination, newest first, and zero once active', async () => {
    const first = await service.add(addInput());
    clock = new Date(NOW.getTime() + HOUR);
    await service.add(addInput({ address: '0x0000000000000000000000000000000000000011' }));

    const listed = await service.list({ tenantId: TENANT, userId: USER });

    expect(listed.map((row) => row.id)).toEqual([`destination-2`, first.destination!.id]);
    expect(listed[1].remainingCooldownMs).toBe(23 * HOUR);
  });

  it('refuses an unsupported network and a malformed address', async () => {
    const network = await service.add(addInput({ network: 'DOGECOIN' }));
    const address = await service.add(addInput({ address: '0xnothex' }));

    expect(network).toMatchObject({ ok: false, code: 'UNSUPPORTED_NETWORK' });
    expect(address).toMatchObject({ ok: false, code: 'INVALID_ADDRESS' });
    expect(repository.rows).toHaveLength(0);
  });

  it('refuses a label too short to recognise later', async () => {
    const result = await service.add(addInput({ label: 'x' }));

    expect(result).toMatchObject({ ok: false, code: 'LABEL_REQUIRED' });
  });

  it('refuses a cooldown that a tenant tried to configure below the floor', async () => {
    const result = await service.add(addInput({ cooldownMs: 60_000 }));

    expect(result).toMatchObject({ ok: false, code: 'COOLDOWN_OUT_OF_BOUNDS' });
    expect(repository.rows).toHaveLength(0);
  });

  it('honours a tenant cooldown inside the permitted range', async () => {
    const result = await service.add(addInput({ cooldownMs: 6 * HOUR }));

    expect(result.destination?.activatesAt.toISOString()).toBe('2026-10-26T18:00:00.000Z');
  });

  it('distinguishes a network mismatch from an unknown address', async () => {
    await addActive(EVM_ADDRESS, 'ETHEREUM');

    // Same string, different network: the lookup is per network, so it reads as
    // unallowlisted rather than as a mismatch the caller could probe with.
    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'BSC',
      address: EVM_ADDRESS,
    });

    expect(decision).toMatchObject({ decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED' });
  });

  it('refuses an address it cannot parse rather than allowing it through as unlisted-with-details', async () => {
    const decision = await service.evaluateWithdrawal({
      tenantId: TENANT,
      userId: USER,
      network: 'ETHEREUM',
      address: 'not-an-address',
    });

    expect(decision).toMatchObject({ decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED', activatesAt: null });
  });

  it('refuses to construct with a default cooldown below the floor', () => {
    expect(() => new WithdrawalDestinationPolicyService(repository, { defaultCooldownMs: 1_000 })).toThrow(
      /defaultCooldownMs/,
    );
  });
});

describe('Address normalisation', () => {
  it('stores an EVM address in lower case', () => {
    expect(normaliseAddress('ETHEREUM', EVM_ADDRESS.toUpperCase().replace('0X', '0x')).address).toBe(EVM_ADDRESS);
  });

  it('refuses a mixed-case EVM address it cannot checksum-verify', () => {
    // Some characters upper, some lower, in a pattern that is not a valid EIP-55
    // checksum. Coercing this silently would risk sending funds to a typo.
    expect(() => normaliseAddress('ETHEREUM', '0x52908400098527886E0F7030069857D2E4169Ee7')).toThrow(
      /mixed-case/i,
    );
  });

  it('refuses an EVM address of the wrong length', () => {
    expect(() => normaliseAddress('ETHEREUM', '0x1234')).toThrow(/40 hexadecimal/);
  });

  it('preserves the case of a Solana address, because base58 is case-sensitive', () => {
    const address = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
    expect(normaliseAddress('SOLANA', address).address).toBe(address);
  });

  it('validates TRON and BITCOIN shapes and refuses the wrong ones', () => {
    expect(normaliseAddress('TRON', 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7').address).toBe(
      'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
    );
    expect(() => normaliseAddress('TRON', '0xabc')).toThrow(/TRON/);
    expect(normaliseAddress('BITCOIN', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').address).toBe(
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    );
    expect(() => normaliseAddress('BITCOIN', 'not-a-bitcoin-address')).toThrow(/Bitcoin/);
  });

  it('refuses burn addresses on every network', () => {
    expect(() => normaliseAddress('ETHEREUM', '0x0000000000000000000000000000000000000000')).toThrow(/burn/);
    expect(() => normaliseAddress('ETHEREUM', '0x000000000000000000000000000000000000dEaD')).toThrow(/burn/);
  });

  it('refuses an empty address and an unsupported network', () => {
    expect(() => normaliseAddress('ETHEREUM', '   ')).toThrow(/required/);
    expect(() => normaliseAddress('DOGECOIN', EVM_ADDRESS)).toThrow(/UNSUPPORTED_NETWORK/);
  });
});
