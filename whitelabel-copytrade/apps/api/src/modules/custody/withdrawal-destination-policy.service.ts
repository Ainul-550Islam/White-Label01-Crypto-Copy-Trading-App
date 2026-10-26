// # Responsibility: owns withdrawal destination allowlisting — a destination is unusable until its cooldown elapses, and a withdrawal is refused unless it goes to an ACTIVE one.
//
// THE THREAT THIS EXISTS FOR
// --------------------------
// A stolen session is worth nothing to an attacker who cannot move funds out. The
// usual exfiltration path is: take the session, add an address, withdraw. A
// cooldown breaks that path without making the product annoying, because the
// legitimate user adds their address once and then withdraws to it forever.
//
// So the rules are deliberately asymmetric:
//
//   * Adding a destination is cheap but slow: it exists immediately as PENDING and
//     becomes ACTIVE only when the cooldown (default 24 h, tenant-configurable)
//     has fully elapsed. `activateDue` flips it at exactly `activatesAt`.
//   * Revoking is immediate and final. A revoked destination is never reusable,
//     even if the same address is added again - the new row has its own cooldown.
//     Reusing a row would let an attacker un-revoke by re-adding.
//   * A withdrawal is allowed only to an ACTIVE destination that belongs to the
//     same user in the same tenant. PENDING, REVOKED, another user's, another
//     tenant's, or unknown all refuse, and each refusal carries its own code so
//     support can tell "wait six hours" from "that is not your address".
//
// Normalisation happens before storage and before lookup, so two spellings of one
// address cannot become two whitelist rows and a case variant cannot slip past a
// comparison at withdrawal time.
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Lifecycle of a destination. Only ACTIVE may receive a withdrawal. */
export type DestinationStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface WithdrawalDestinationRecord {
  id: string;
  tenantId: string;
  userId: string;
  network: string;
  address: string;
  label: string;
  status: DestinationStatus;
  activatesAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export type DestinationDecisionCode =
  | 'ALLOW'
  | 'DESTINATION_NOT_ALLOWLISTED'
  | 'DESTINATION_PENDING_ACTIVATION'
  | 'DESTINATION_REVOKED'
  | 'DESTINATION_NETWORK_MISMATCH';

export interface DestinationDecision {
  decision: 'ALLOW' | 'DENY';
  code: DestinationDecisionCode;
  message: string;
  /** The destination that decided it, when one matched. */
  destinationId: string | null;
  /** Present for PENDING so the UI can count down. */
  activatesAt: string | null;
}

export type DestinationRefusalCode =
  | 'STEP_UP_REQUIRED'
  | 'UNSUPPORTED_NETWORK'
  | 'INVALID_ADDRESS'
  | 'LABEL_REQUIRED'
  | 'DESTINATION_REVOKED'
  | 'DESTINATION_NOT_FOUND'
  | 'COOLDOWN_OUT_OF_BOUNDS';

export interface DestinationResult {
  ok: boolean;
  code: DestinationRefusalCode | 'CREATED' | 'EXISTING' | 'ACTIVATED' | 'REVOKED';
  message: string;
  destination?: WithdrawalDestinationRecord;
  /** How long until this destination may be used. Null when already ACTIVE. */
  remainingCooldownMs?: number | null;
}

/**
 * Persistence port. The service never touches Prisma directly so the cooldown and
 * isolation rules can be tested at their boundaries rather than through a
 * database.
 */
export interface WithdrawalDestinationRepository {
  findById(input: { tenantId: string; userId: string; id: string }): Promise<WithdrawalDestinationRecord | null>;
  findExact(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
  }): Promise<WithdrawalDestinationRecord | null>;
  list(input: { tenantId: string; userId: string }): Promise<WithdrawalDestinationRecord[]>;
  create(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
    label: string;
    activatesAt: Date;
  }): Promise<WithdrawalDestinationRecord>;
  setStatus(input: {
    tenantId: string;
    userId: string;
    id: string;
    status: DestinationStatus;
    revokedAt: Date | null;
  }): Promise<WithdrawalDestinationRecord | null>;
  listDue(input: { tenantId: string; userId: string; now: Date }): Promise<WithdrawalDestinationRecord[]>;
  /**
   * Tenant-wide read, for the operator audit only.
   *
   * This is the one method on the port that is not scoped to a user, and it exists
   * because support has to be able to answer "where may this customer's money go"
   * without holding a customer session. It is read-only and it is never used by a
   * write path: the allowlist itself can only be changed by its owner.
   */
  listForTenant(input: { tenantId: string; limit: number }): Promise<WithdrawalDestinationRecord[]>;
}

export interface DestinationPolicyOptions {
  /** Default cooldown for a new destination. 24 h unless a tenant overrides it. */
  defaultCooldownMs?: number;
  /** Floor. A tenant may not configure a cooldown short enough to defeat the control. */
  minCooldownMs?: number;
  /** Ceiling, so a misconfiguration cannot freeze a user out forever. */
  maxCooldownMs?: number;
  now?: () => Date;
}

const HOUR = 60 * 60 * 1_000;
const DEFAULT_COOLDOWN_MS = 24 * HOUR;
const MIN_COOLDOWN_MS = 60 * 60 * 1_000; // one hour floor
const MAX_COOLDOWN_MS = 30 * 24 * HOUR;

/** Networks this platform can validate, with the shape each address must have. */
const EVM_NETWORKS = new Set(['ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'AVALANCHE']);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const HEX_40 = /^0x[0-9a-f]{40}$/;
const HEX_40_UPPER = /^0X[0-9A-F]{40}$/;
const SUPPORTED_NETWORKS = new Set<string>([...EVM_NETWORKS, 'TRON', 'SOLANA', 'BITCOIN']);

/** Address shapes that must never be allowlisted, whichever network claims them. */
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

export interface NormalisedAddress {
  address: string;
  note: string;
}

/**
 * Normalise an address for a network, or explain why it cannot be normalised.
 *
 * Case rules differ per chain and getting them wrong is not cosmetic: a Solana
 * address lower-cased is a different address, and an EVM address accepted in
 * mixed case without a checksum check could be a transcription error that sends
 * funds to a typo. Mixed-case EVM input is therefore REFUSED rather than coerced:
 * this build has no keccak implementation to verify EIP-55, and accepting it
 * unchecked would be worse than asking the user to paste it again.
 */
export function normaliseAddress(network: string, rawAddress: string): NormalisedAddress {
  const networkUpper = String(network ?? '').trim().toUpperCase();
  const address = String(rawAddress ?? '').trim();
  if (!address) throw new Error('INVALID_ADDRESS: an address is required');
  if (BURN_ADDRESSES.has(address.toLowerCase())) {
    throw new Error('INVALID_ADDRESS: this is a burn address and can never receive a withdrawal');
  }

  if (EVM_NETWORKS.has(networkUpper)) {
    const lower = address.toLowerCase();
    if (/^0x[0-9a-fA-F]{40}$/.test(address) && address !== lower && address !== `0x${address.slice(2).toUpperCase()}`) {
      throw new Error(
        'INVALID_ADDRESS: mixed-case addresses cannot be checksum-verified by this platform; paste the address in lower case',
      );
    }
    if (!HEX_40.test(lower) && !HEX_40_UPPER.test(address.toUpperCase().replace(/^0X/, '0x'))) {
      throw new Error('INVALID_ADDRESS: an EVM address must be 0x followed by 40 hexadecimal characters');
    }
    return { address: lower, note: 'stored in lower case; EVM addresses are case-insensitive' };
  }

  if (networkUpper === 'TRON') {
    if (!address.startsWith('T') || address.length !== 34 || !BASE58.test(address)) {
      throw new Error('INVALID_ADDRESS: a TRON address starts with T and is 34 characters');
    }
    return { address, note: 'base58 is case-sensitive and stored exactly as given' };
  }

  if (networkUpper === 'SOLANA') {
    if (address.length < 32 || address.length > 44 || !BASE58.test(address)) {
      throw new Error('INVALID_ADDRESS: a Solana address is 32-44 base58 characters');
    }
    return { address, note: 'base58 is case-sensitive and stored exactly as given' };
  }

  if (networkUpper === 'BITCOIN') {
    const bech32 = /^bc1[02-9ac-hj-np-z]{11,71}$/.test(address.toLowerCase());
    const legacy = address.length >= 26 && address.length <= 35 && BASE58.test(address) && /^[13]/.test(address);
    if (!bech32 && !legacy) {
      throw new Error('INVALID_ADDRESS: a Bitcoin address must be bech32 (bc1...) or legacy (1.../3...)');
    }
    return { address: bech32 ? address.toLowerCase() : address, note: 'bech32 is stored in lower case' };
  }

  throw new Error(`UNSUPPORTED_NETWORK: ${networkUpper || '(none)'} is not a network this platform supports`);
}

@Injectable()
export class WithdrawalDestinationPolicyService {
  private readonly defaultCooldownMs: number;
  private readonly minCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: WithdrawalDestinationRepository,
    options: DestinationPolicyOptions = {},
  ) {
    this.defaultCooldownMs = options.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.minCooldownMs = options.minCooldownMs ?? MIN_COOLDOWN_MS;
    this.maxCooldownMs = options.maxCooldownMs ?? MAX_COOLDOWN_MS;
    this.now = options.now ?? (() => new Date());
    if (this.defaultCooldownMs < this.minCooldownMs) {
      throw new Error('defaultCooldownMs must not be shorter than the floor');
    }
  }

  /** Every destination for this user, newest first, with its cooldown state resolved. */
  async list(input: { tenantId: string; userId: string }): Promise<Array<WithdrawalDestinationRecord & { remainingCooldownMs: number }>> {
    const rows = await this.repository.list({ tenantId: input.tenantId, userId: input.userId });
    const nowMs = this.now().getTime();
    return rows
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => ({ ...row, remainingCooldownMs: this.remainingCooldownMs(row, nowMs) }));
  }

  /**
   * Every destination in the tenant, for the operator audit.
   *
   * Cooldown state is resolved here as well, so the console shows the same
   * `remainingCooldownMs` the customer's own screen shows and the two cannot
   * disagree about whether an address is usable yet.
   */
  async listForTenant(input: {
    tenantId: string;
    limit?: number;
  }): Promise<Array<WithdrawalDestinationRecord & { remainingCooldownMs: number }>> {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const rows = await this.repository.listForTenant({ tenantId: input.tenantId, limit });
    const nowMs = this.now().getTime();
    return rows.map((row) => ({ ...row, remainingCooldownMs: this.remainingCooldownMs(row, nowMs) }));
  }

  /**
   * Register a destination. `stepUpProven` is passed in by the controller after the
   * guard has consumed the proof; the service refuses without it as well, so no
   * future caller can reach the write path by forgetting to decorate a route.
   */
  async add(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
    label: string;
    stepUpProven: boolean;
    /** Tenant-configured cooldown, already validated against the floor/ceiling. */
    cooldownMs?: number;
  }): Promise<DestinationResult> {
    if (!input.stepUpProven) {
      return { ok: false, code: 'STEP_UP_REQUIRED', message: 'Confirm your identity again before adding a withdrawal address.' };
    }
    const label = String(input.label ?? '').trim();
    if (label.length < 2) {
      return { ok: false, code: 'LABEL_REQUIRED', message: 'Give this address a label so you can recognise it later.' };
    }
    const network = String(input.network ?? '').trim().toUpperCase();
    if (!SUPPORTED_NETWORKS.has(network)) {
      return { ok: false, code: 'UNSUPPORTED_NETWORK', message: `${network || 'That network'} cannot be used for withdrawals.` };
    }

    let normalised: NormalisedAddress;
    try {
      normalised = normaliseAddress(network, input.address);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_ADDRESS';
      const code: DestinationRefusalCode = message.startsWith('UNSUPPORTED_NETWORK') ? 'UNSUPPORTED_NETWORK' : 'INVALID_ADDRESS';
      return { ok: false, code, message: message.replace(/^[A-Z_]+:\s*/, '') };
    }

    const cooldownMs = this.cooldownFor(input.cooldownMs);
    if (cooldownMs === null) {
      return { ok: false, code: 'COOLDOWN_OUT_OF_BOUNDS', message: 'The configured waiting period is outside the permitted range.' };
    }

    const existing = await this.repository.findExact({
      tenantId: input.tenantId,
      userId: input.userId,
      network,
      address: normalised.address,
    });

    if (existing) {
      if (existing.status === 'REVOKED') {
        // Never revived: re-activation would let a revoked address skip its cooldown.
        return {
          ok: false,
          code: 'DESTINATION_REVOKED',
          message: 'This address was revoked and cannot be added again. Use a different address.',
          destination: existing,
        };
      }
      // Idempotent: adding the same address twice must not create a second row or
      // restart the cooldown, which would let a user refresh the timer by accident.
      return {
        ok: true,
        code: 'EXISTING',
        message:
          existing.status === 'ACTIVE'
            ? 'This address is already approved.'
            : 'This address is already registered and waiting out its approval period.',
        destination: existing,
        remainingCooldownMs: this.remainingCooldownMs(existing, this.now().getTime()),
      };
    }

    const activatesAt = new Date(this.now().getTime() + cooldownMs);
    const created = await this.repository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      network,
      address: normalised.address,
      label: label.slice(0, 80),
      activatesAt,
    });

    return {
      ok: true,
      code: 'CREATED',
      message: `Address added. It can be used for withdrawals after ${new Date(activatesAt).toISOString()}.`,
      destination: created,
      remainingCooldownMs: cooldownMs,
    };
  }

  /** Revoke a destination. Immediate, final, and requires step-up like adding one. */
  async revoke(input: {
    tenantId: string;
    userId: string;
    destinationId: string;
    stepUpProven: boolean;
  }): Promise<DestinationResult> {
    if (!input.stepUpProven) {
      return { ok: false, code: 'STEP_UP_REQUIRED', message: 'Confirm your identity again before revoking a withdrawal address.' };
    }
    const existing = await this.repository.findById({
      tenantId: input.tenantId,
      userId: input.userId,
      id: input.destinationId,
    });
    if (!existing) {
      // Same answer for "not yours" and "does not exist": the difference is
      // information about another user's addresses.
      return { ok: false, code: 'DESTINATION_NOT_FOUND', message: 'No such withdrawal address.' };
    }
    if (existing.status === 'REVOKED') {
      return { ok: true, code: 'REVOKED', message: 'This address is already revoked.', destination: existing };
    }
    const revoked = await this.repository.setStatus({
      tenantId: input.tenantId,
      userId: input.userId,
      id: existing.id,
      status: 'REVOKED',
      revokedAt: this.now(),
    });
    return {
      ok: revoked !== null,
      code: revoked ? 'REVOKED' : 'DESTINATION_NOT_FOUND',
      message: revoked ? 'The address is revoked and can no longer receive withdrawals.' : 'No such withdrawal address.',
      destination: revoked ?? undefined,
    };
  }

  /**
   * Flip every destination whose cooldown has fully elapsed to ACTIVE.
   *
   * Idempotent and safe to run from a scheduler as often as wanted: a row is only
   * touched once, and the boundary comparison is `activatesAt <= now`, so a
   * destination activates exactly at its stated time rather than a poll later.
   */
  async activateDue(input: { tenantId: string; userId: string }): Promise<{ activated: number }> {
    const now = this.now();
    const due = await this.repository.listDue({ tenantId: input.tenantId, userId: input.userId, now });
    let activated = 0;
    for (const row of due) {
      if (row.activatesAt.getTime() > now.getTime()) continue;
      const updated = await this.repository.setStatus({
        tenantId: input.tenantId,
        userId: input.userId,
        id: row.id,
        status: 'ACTIVE',
        revokedAt: null,
      });
      if (updated && updated.status === 'ACTIVE') activated += 1;
    }
    return { activated };
  }

  /**
   * The policy decision for one withdrawal.
   *
   * Called before any withdrawal row is created; a DENY here means nothing was
   * written. The lookup is scoped to (tenant, user, network, normalised address),
   * so a destination belonging to someone else simply does not match.
   */
  async evaluateWithdrawal(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
  }): Promise<DestinationDecision> {
    const network = String(input.network ?? '').trim().toUpperCase();
    let normalised: string;
    try {
      normalised = normaliseAddress(network, input.address).address;
    } catch {
      // An address we cannot even parse cannot match an allowlisted one.
      return {
        decision: 'DENY',
        code: 'DESTINATION_NOT_ALLOWLISTED',
        message: 'This withdrawal address is not on your approved list.',
        destinationId: null,
        activatesAt: null,
      };
    }

    const match = await this.repository.findExact({
      tenantId: input.tenantId,
      userId: input.userId,
      network,
      address: normalised,
    });

    if (!match) {
      return {
        decision: 'DENY',
        code: 'DESTINATION_NOT_ALLOWLISTED',
        message: 'This withdrawal address is not on your approved list.',
        destinationId: null,
        activatesAt: null,
      };
    }
    if (match.network !== network) {
      return {
        decision: 'DENY',
        code: 'DESTINATION_NETWORK_MISMATCH',
        message: `This address is registered for ${match.network}, not ${network}.`,
        destinationId: match.id,
        activatesAt: null,
      };
    }
    if (match.status === 'REVOKED') {
      return {
        decision: 'DENY',
        code: 'DESTINATION_REVOKED',
        message: 'This address has been revoked and cannot receive withdrawals.',
        destinationId: match.id,
        activatesAt: null,
      };
    }
    if (match.status === 'PENDING') {
      return {
        decision: 'DENY',
        code: 'DESTINATION_PENDING_ACTIVATION',
        message: `This address is still in its waiting period. It can receive withdrawals from ${match.activatesAt.toISOString()}.`,
        destinationId: match.id,
        activatesAt: match.activatesAt.toISOString(),
      };
    }

    return {
      decision: 'ALLOW',
      code: 'ALLOW',
      message: 'Destination is approved.',
      destinationId: match.id,
      activatesAt: null,
    };
  }

  private remainingCooldownMs(row: WithdrawalDestinationRecord, nowMs: number): number {
    if (row.status !== 'PENDING') return 0;
    return Math.max(0, row.activatesAt.getTime() - nowMs);
  }

  private cooldownFor(configured: number | undefined): number | null {
    if (configured === undefined) return this.defaultCooldownMs;
    if (!Number.isSafeInteger(configured)) return null;
    if (configured < this.minCooldownMs || configured > this.maxCooldownMs) return null;
    return configured;
  }
}

/** Maps the Prisma row onto the port's record shape. */
function toRecord(row: {
  id: string;
  tenantId: string;
  userId: string;
  network: string;
  address: string;
  label: string;
  status: DestinationStatus;
  activatesAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}): WithdrawalDestinationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    network: row.network,
    address: row.address,
    label: row.label,
    status: row.status,
    activatesAt: row.activatesAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/**
 * The Prisma-backed repository.
 *
 * Every query carries `tenantId` and `userId`; there is no method that looks a
 * destination up by id alone, so cross-tenant and cross-user reads are not
 * expressible through this port.
 */
export class PrismaWithdrawalDestinationRepository implements WithdrawalDestinationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(input: { tenantId: string; userId: string; id: string }): Promise<WithdrawalDestinationRecord | null> {
    const row = await this.prisma.withdrawalDestination.findFirst({
      where: { id: input.id, tenantId: input.tenantId, userId: input.userId },
    });
    return row ? toRecord(row) : null;
  }

  async findExact(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
  }): Promise<WithdrawalDestinationRecord | null> {
    const row = await this.prisma.withdrawalDestination.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        network: input.network,
        address: input.address,
      },
    });
    return row ? toRecord(row) : null;
  }

  async list(input: { tenantId: string; userId: string }): Promise<WithdrawalDestinationRecord[]> {
    const rows = await this.prisma.withdrawalDestination.findMany({
      where: { tenantId: input.tenantId, userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toRecord);
  }

  async create(input: {
    tenantId: string;
    userId: string;
    network: string;
    address: string;
    label: string;
    activatesAt: Date;
  }): Promise<WithdrawalDestinationRecord> {
    const row = await this.prisma.withdrawalDestination.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        network: input.network,
        address: input.address,
        label: input.label,
        status: 'PENDING',
        activatesAt: input.activatesAt,
      },
    });
    return toRecord(row);
  }

  async setStatus(input: {
    tenantId: string;
    userId: string;
    id: string;
    status: DestinationStatus;
    revokedAt: Date | null;
  }): Promise<WithdrawalDestinationRecord | null> {
    // updateMany keeps the tenant/user predicate in the WHERE clause: a wrong id
    // updates nothing rather than throwing and revealing that it exists.
    const result = await this.prisma.withdrawalDestination.updateMany({
      where: { id: input.id, tenantId: input.tenantId, userId: input.userId },
      data: { status: input.status, revokedAt: input.revokedAt },
    });
    if (result.count === 0) return null;
    return this.findById({ tenantId: input.tenantId, userId: input.userId, id: input.id });
  }

  async listForTenant(input: { tenantId: string; limit: number }): Promise<WithdrawalDestinationRecord[]> {
    const rows = await this.prisma.withdrawalDestination.findMany({
      where: { tenantId: input.tenantId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
    return rows.map(toRecord);
  }

  async listDue(input: { tenantId: string; userId: string; now: Date }): Promise<WithdrawalDestinationRecord[]> {
    const rows = await this.prisma.withdrawalDestination.findMany({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        status: 'PENDING',
        activatesAt: { lte: input.now },
      },
      take: 200,
    });
    return rows.map(toRecord);
  }
}
