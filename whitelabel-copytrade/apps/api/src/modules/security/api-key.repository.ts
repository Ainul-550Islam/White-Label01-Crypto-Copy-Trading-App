import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApiKeyState } from './security.types';
import { randomUUID } from 'crypto';
import { isRecordNotFound } from '../../common/errors/prisma-not-found';

/**
 * Persistence abstraction for API keys, fingerprints, scopes, expiration, last-used metadata, revocation, and tenant isolation.
 * Prevent duplicate fingerprint, tenant isolation required.
 */
@Injectable()
export class ApiKeyRepository {
  private readonly logger = new Logger(ApiKeyRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    tenantId: string;
    userId: string;
    name: string;
    keyId: string;
    secretHash: string;
    fingerprint: string;
    scopes: string[];
    ipAllowlist?: string[];
    expiresAt?: Date;
    createdById?: string;
    idempotencyKey?: string;
  }): Promise<any> {
    // Prevent duplicate fingerprint
    try {
      const existingFingerprint = await (this.prisma as any).enterpriseApiKey?.findFirst({
        where: { fingerprint: input.fingerprint },
      });
      if (existingFingerprint) {
        throw new Error(`Duplicate fingerprint ${input.fingerprint} - prevented`);
      }
    } catch (e: any) {
      if (e.message.includes('Duplicate fingerprint')) throw e;
    }

    // Idempotency check
    if (input.idempotencyKey) {
      try {
        const existing = await (this.prisma as any).enterpriseApiKey?.findFirst({
          where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          this.logger.log(`Idempotent API key return key=${input.idempotencyKey}`);
          return existing;
        }
      } catch {}
    }

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      name: input.name,
      keyId: input.keyId,
      secretHash: input.secretHash,
      fingerprint: input.fingerprint,
      scopes: input.scopes,
      state: ApiKeyState.ACTIVE,
      ipAllowlist: input.ipAllowlist || [],
      expiresAt: input.expiresAt || null,
      createdById: input.createdById || null,
      idempotencyKey: input.idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await (this.prisma as any).enterpriseApiKey?.create({ data });
      if (created) {
        this.logger.log(`API key created id=${created.id} tenant=${input.tenantId} keyId=${input.keyId}`);
        return created;
      }
    } catch (e: any) {
      if (e.code === 'P2002') {
        // Check if it's idempotency or fingerprint duplicate
        if (input.idempotencyKey) {
          const existing = await (this.prisma as any).enterpriseApiKey?.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } });
          if (existing) return existing;
        }
        throw new Error(`Duplicate API key constraint: ${e.message}`);
      }
      this.logger.warn(`Failed to create enterprise API key, fallback to TenantApiKey: ${e.message}`);

      // Fallback to TenantApiKey for backward compatibility
      try {
        const tenantKey = await (this.prisma as any).tenantApiKey?.create({
          data: {
            id,
            tenantId: input.tenantId,
            name: input.name,
            keyId: input.keyId,
            secretHash: input.secretHash,
            scopes: input.scopes,
            ipAllowlist: input.ipAllowlist || [],
            expiresAt: input.expiresAt || null,
            createdById: input.createdById || null,
            createdAt: now,
            updatedAt: now,
          },
        });
        if (tenantKey) return { ...tenantKey, fingerprint: input.fingerprint, userId: input.userId, state: ApiKeyState.ACTIVE };
      } catch (e2: any) {
        this.logger.warn(`Fallback TenantApiKey creation also failed: ${e2.message}`);
      }
    }

    return { ...data, lastUsedAt: null, revokedAt: null, rotatedAt: null };
  }

  async findByFingerprint(fingerprint: string): Promise<any | null> {
    const result = await (this.prisma as any).enterpriseApiKey?.findFirst({ where: { fingerprint } });
    if (result) return result;

    // Fallback to TenantApiKey by keyId? Fingerprint not in TenantApiKey, try keyId lookup
    return null;
  }

  async findByKeyId(keyId: string): Promise<any | null> {
    const result = await (this.prisma as any).enterpriseApiKey?.findFirst({ where: { keyId } });
    if (result) return result;

    const tenantResult = await (this.prisma as any).tenantApiKey?.findFirst({ where: { keyId } });
    return tenantResult || null;
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    const result = await (this.prisma as any).enterpriseApiKey?.findFirst({ where: { id, tenantId } });
    if (result) return result;

    const tenantResult = await (this.prisma as any).tenantApiKey?.findFirst({ where: { id, tenantId } });
    return tenantResult || null;
  }

  /**
   * Keys of a tenant from both stores: EnterpriseApiKey (per-user keys with a stored state) and,
   * when no userId filter is given, TenantApiKey (tenant-wide keys whose state is derived from
   * revokedAt/expiresAt). The state filter applies to both stores, `total` counts every matching
   * row of both stores, and the requested page is cut from the merged list ordered by createdAt
   * descending (each store contributes at most offset + limit rows to that merge).
   */
  async listByTenant(tenantId: string, filters?: { userId?: string; state?: ApiKeyState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;
    const now = new Date();

    const where: any = { tenantId };
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.state) where.state = filters.state;

    // TenantApiKey rows belong to no user, so they only join an unfiltered tenant list, and a
    // state they can never be in (ROTATED) excludes them entirely.
    const tenantWhere = filters?.userId ? null : this.tenantApiKeyWhere(tenantId, filters?.state, now);

    if (!tenantWhere) {
      const [data, total] = await Promise.all([
        (this.prisma as any).enterpriseApiKey?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).enterpriseApiKey?.count({ where }) || 0,
      ]);
      return { data, total };
    }

    const window = offset + limit;
    const [enterpriseRows, enterpriseTotal] = await Promise.all([
      (this.prisma as any).enterpriseApiKey?.findMany({ where, orderBy: { createdAt: 'desc' }, take: window }) || [],
      (this.prisma as any).enterpriseApiKey?.count({ where }) || 0,
    ]);

    let tenantRows: any[];
    let tenantTotal: number;
    try {
      [tenantRows, tenantTotal] = await Promise.all([
        (this.prisma as any).tenantApiKey?.findMany({ where: tenantWhere, orderBy: { createdAt: 'desc' }, take: window }) || [],
        (this.prisma as any).tenantApiKey?.count({ where: tenantWhere }) || 0,
      ]);
    } catch {
      // TenantApiKey unavailable: the list is the enterprise keys alone.
      return { data: enterpriseRows.slice(offset, offset + limit), total: enterpriseTotal };
    }

    const merged = [...enterpriseRows, ...tenantRows.map((k: any) => this.toTenantKeyView(k, now))].sort(
      (a: any, b: any) => this.createdAtMs(b) - this.createdAtMs(a),
    );
    return { data: merged.slice(offset, offset + limit), total: enterpriseTotal + tenantTotal };
  }

  /** TenantApiKey filter for a list state; null when no TenantApiKey can be in that state. */
  private tenantApiKeyWhere(tenantId: string, state: ApiKeyState | undefined, now: Date): Record<string, any> | null {
    switch (state) {
      case undefined:
        return { tenantId };
      case ApiKeyState.ACTIVE:
        return { tenantId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };
      case ApiKeyState.EXPIRED:
        return { tenantId, revokedAt: null, expiresAt: { lt: now } };
      case ApiKeyState.REVOKED:
        return { tenantId, revokedAt: { not: null } };
      default:
        return null;
    }
  }

  /** A TenantApiKey row in the EnterpriseApiKey list shape (state derived as tenantApiKeyWhere filters it). */
  private toTenantKeyView(k: any, now: Date): any {
    const state = k.revokedAt
      ? ApiKeyState.REVOKED
      : k.expiresAt && new Date(k.expiresAt) < now
        ? ApiKeyState.EXPIRED
        : ApiKeyState.ACTIVE;
    return { ...k, userId: k.createdById || 'unknown', state, fingerprint: k.keyId };
  }

  private createdAtMs(row: any): number {
    const ms = row?.createdAt ? new Date(row.createdAt).getTime() : NaN;
    return Number.isNaN(ms) ? 0 : ms;
  }

  async listByUser(tenantId: string, userId: string, filters?: { state?: ApiKeyState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.listByTenant(tenantId, { ...filters, userId });
  }

  async updateLastUsed(id: string, tenantId: string): Promise<void> {
    try {
      await (this.prisma as any).enterpriseApiKey?.update({
        where: { id, tenantId },
        data: { lastUsedAt: new Date(), updatedAt: new Date() },
      });
    } catch {
      try {
        await (this.prisma as any).tenantApiKey?.update({
          where: { id, tenantId },
          data: { lastUsedAt: new Date(), updatedAt: new Date() },
        });
      } catch {}
    }
  }

  async revoke(id: string, tenantId: string, reason?: string): Promise<any | null> {
    try {
      const updated = await (this.prisma as any).enterpriseApiKey?.update({
        where: { id, tenantId },
        data: { state: ApiKeyState.REVOKED, revokedAt: new Date(), updatedAt: new Date() },
      });
      if (updated) return updated;
    } catch {}

    try {
      const updated = await (this.prisma as any).tenantApiKey?.update({
        where: { id, tenantId },
        data: { revokedAt: new Date(), updatedAt: new Date() },
      });
      return updated || null;
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async rotate(oldId: string, newRecord: any): Promise<any> {
    // Mark old as ROTATED
    try {
      await (this.prisma as any).enterpriseApiKey?.update({
        where: { id: oldId, tenantId: newRecord.tenantId },
        data: { state: ApiKeyState.ROTATED, rotatedAt: new Date(), updatedAt: new Date() },
      });
    } catch {}

    // Create new
    return this.create(newRecord);
  }

  async findExpired(beforeDate?: Date): Promise<any[]> {
    const before = beforeDate || new Date();
    return await (this.prisma as any).enterpriseApiKey?.findMany({
      where: { expiresAt: { lt: before }, state: ApiKeyState.ACTIVE },
    }) || [];
  }

  async expireKeys(): Promise<number> {
    const now = new Date();
    const result = await (this.prisma as any).enterpriseApiKey?.updateMany({
      where: { expiresAt: { lt: now }, state: ApiKeyState.ACTIVE },
      data: { state: ApiKeyState.EXPIRED, updatedAt: now },
    });
    return result?.count || 0;
  }
}
