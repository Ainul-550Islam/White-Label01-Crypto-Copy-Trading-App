// # Responsibility: binds the account-recovery ports to Postgres, the blind-indexed user table and Redis, keeping every write tenant-scoped.
//
// The recovery service itself is written against ports so its single-use,
// expiry and enumeration rules can be tested without a database. These are the
// production implementations of those ports; they contain no policy, only the
// mechanics of reading and writing.
//
// Two details are load-bearing:
//
//   * The token lookup is by HMAC and is deliberately NOT tenant-scoped. The hash
//     identifies exactly one row, and a customer filling in a public recovery form
//     does not know their tenant id. The tenant is read from the row and used for
//     every write that follows, so the scoping still exists - it just starts one
//     step later.
//   * Email lookup uses the blind index, never the plaintext column. A recovery
//     form is an unauthenticated endpoint; a query on `email` would put a raw
//     address in the slow-query log and in every replica's cache.
import { Injectable } from '@nestjs/common';

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type {
  AccountLookupPort,
  AccountRecoveryRepository,
  RecoveryAccount,
  RecoveryTokenRecord,
  SessionRevocationPort,
} from './account-recovery.service';

function toRecord(row: {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}): RecoveryTokenRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaAccountRecoveryRepository implements AccountRecoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(input: { tokenHash: string }): Promise<RecoveryTokenRecord | null> {
    const row = await this.prisma.accountRecoveryToken.findFirst({
      where: { tokenHash: input.tokenHash },
    });
    return row ? toRecord(row) : null;
  }

  async createToken(input: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestIpHash: string | null;
  }): Promise<RecoveryTokenRecord> {
    const row = await this.prisma.accountRecoveryToken.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        requestIpHash: input.requestIpHash,
        method: 'EMAIL',
      },
    });
    return toRecord(row);
  }

  async markUsed(input: { tenantId: string; id: string; usedAt: Date }): Promise<boolean> {
    // `usedAt: null` in the predicate makes the burn conditional in the database:
    // of two concurrent completions, exactly one updates a row.
    const result = await this.prisma.accountRecoveryToken.updateMany({
      where: { id: input.id, tenantId: input.tenantId, usedAt: null },
      data: { usedAt: input.usedAt },
    });
    return result.count === 1;
  }

  async invalidateUserTokens(input: { tenantId: string; userId: string; at: Date }): Promise<number> {
    const result = await this.prisma.accountRecoveryToken.updateMany({
      where: { tenantId: input.tenantId, userId: input.userId, usedAt: null },
      data: { usedAt: input.at },
    });
    return result.count;
  }

  async countRecentRequests(input: {
    tenantId: string | null;
    userId: string | null;
    ipHash: string | null;
    since: Date;
  }): Promise<number> {
    return this.prisma.accountRecoveryToken.count({
      where: {
        createdAt: { gte: input.since },
        OR: [
          ...(input.userId && input.tenantId ? [{ tenantId: input.tenantId, userId: input.userId }] : []),
          ...(input.ipHash ? [{ requestIpHash: input.ipHash }] : []),
        ],
      },
    });
  }
}

@Injectable()
export class PrismaAccountLookup implements AccountLookupPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Resolve an address to one account.
   *
   * Ambiguity (the same address registered in two tenants, which is legal on a
   * white-label platform) resolves to `null`. Guessing the first match would send
   * a recovery link for one tenant's account to a person who may be trying to
   * recover another's.
   */
  async findByEmail(email: string): Promise<RecoveryAccount | null> {
    const normalised = String(email ?? '').trim().toLowerCase();
    if (!normalised || !normalised.includes('@')) return null;
    const emailIndex = this.crypto.blindIndex(normalised);
    const matches = await this.prisma.user.findMany({
      where: { emailIndex, deletedAt: null },
      select: { id: true, tenantId: true },
      take: 2,
    });
    if (matches.length !== 1) return null;
    return { tenantId: matches[0].tenantId, userId: matches[0].id };
  }
}

@Injectable()
export class RedisSessionRevocationAdapter implements SessionRevocationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async revokeAllSessions(input: { tenantId: string; userId: string; reason: string }): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: input.reason.slice(0, 120) },
    });
    return result.count;
  }

  /**
   * Delete every outstanding step-up proof for this user.
   *
   * Proofs are keyed by session, and the sessions are gone by the time this runs -
   * but the Redis entries would survive their session and remain readable until
   * their TTL. Deleting them removes any doubt, and SCAN rather than KEYS keeps
   * the operation from blocking the shared Redis instance.
   */
  async revokeStepUpState(input: { tenantId: string; userId: string }): Promise<void> {
    const pattern = `stepup:proof:${input.tenantId}:${input.userId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.redis.client.del(...keys);
    } while (cursor !== '0');
  }
}
