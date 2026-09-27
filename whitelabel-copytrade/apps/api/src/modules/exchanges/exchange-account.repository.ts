import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeAccountState, ExchangeConnectionState, ExchangeHealthState, ExchangeCapability } from './exchange.types';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

export interface CreateExchangeAccountInput {
  tenantId: string;
  userId: string | null;
  exchangeId: string;
  venue: ExchangeVenue;
  label: string;
  environment: ExchangeEnvironment;
  isSandbox: boolean;
  credentialSource: string;
  credentialRef?: string | null;
  apiKeyLastFour?: string | null;
  apiKeyBlindIndex?: string | null;
  idempotencyKey?: string | null;
}

export interface ExchangeAccountRecord {
  id: string;
  tenantId: string;
  userId: string | null;
  exchangeId: string;
  venue: ExchangeVenue;
  label: string;
  status: ExchangeAccountState;
  environment: ExchangeEnvironment;
  isSandbox: boolean;
  credentialSource: string;
  credentialRef: string | null;
  apiKeyLastFour: string | null;
  apiKeyBlindIndex: string | null;
  capabilities: ExchangeCapability[];
  healthState: ExchangeHealthState;
  connectionState: ExchangeConnectionState;
  lastVerifiedAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  liveTradingEnabled: boolean;
  privateStreamEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  idempotencyKey: string | null;
  metadata: Record<string, any>;
}

/**
 * Persistent exchange-account records: tenant/user ownership, venue, environment, credential reference, status, capability snapshot, health, sync metadata, and idempotency.
 * Use existing Prisma/tenant patterns. Every query must be tenant-safe.
 */
@Injectable()
export class ExchangeAccountRepository {
  private readonly logger = new Logger(ExchangeAccountRepository.name);

  // Safe select - never includes ciphertext columns
  private static readonly SAFE_SELECT = {
    id: true,
    tenantId: true,
    userId: true,
    exchangeId: true,
    label: true,
    status: true,
    marketType: true,
    tradingMode: true,
    isSandbox: true,
    liveTradingEnabled: true,
    privateStreamEnabled: true,
    credentialSource: true,
    credentialRef: true,
    verifiedPermissions: true,
    credentialRotatedAt: true,
    credentialExpiresAt: true,
    apiKeyLastFour: true,
    apiKeyBlindIndex: true,
    canTrade: true,
    canReadData: true,
    canWithdraw: true,
    ipRestricted: true,
    lastVerifiedAt: true,
    lastFailureAt: true,
    lastFailureCode: true,
    consecutiveFailures: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    exchange: { select: { venue: true } },
  } satisfies Prisma.TradingAccountSelect;

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateExchangeAccountInput): Promise<ExchangeAccountRecord> {
    // Idempotency check
    if (input.idempotencyKey) {
      const existing = await this.prisma.tradingAccount.findFirst({
        where: { tenantId: input.tenantId, label: input.label, exchangeId: input.exchangeId } as any,
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      // Simple idempotency via label+tenant+exchange - if exists and not deleted, return
      if (existing && !(existing as any).deletedAt) {
        this.logger.log(`Idempotent account return tenant=${input.tenantId} label=${input.label} venue=${input.venue}`);
        return this.mapToRecord(existing);
      }
    }

    const id = randomUUID();
    const now = new Date();

    // Map environment to isSandbox and tradingMode per existing model
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    const tradingMode = isSandbox ? 'PAPER' : 'LIVE';
    const marketType = 'SPOT';

    try {
      const created = await this.prisma.tradingAccount.create({
        data: {
          id,
          tenantId: input.tenantId,
          exchangeId: input.exchangeId,
          userId: input.userId,
          label: input.label,
          status: 'PENDING_VALIDATION' as any,
          marketType: marketType as any,
          tradingMode: tradingMode as any,
          isSandbox,
          liveTradingEnabled: false, // Never auto-enable live per security requirement
          privateStreamEnabled: false,
          credentialSource: input.credentialSource as any,
          credentialRef: input.credentialRef || null,
          apiKeyLastFour: input.apiKeyLastFour || '****',
          apiKeyBlindIndex: input.apiKeyBlindIndex || 'pending_' + Math.random().toString(36).substring(2, 10),
          canTrade: false,
          canReadData: false,
          canWithdraw: false,
          ipRestricted: false,
          consecutiveFailures: 0,
          verifiedPermissions: [],
          createdAt: now,
          updatedAt: now,
        },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });

      this.logger.log(`Exchange account created id=${created.id} tenant=${input.tenantId} venue=${input.venue} env=${input.environment}`);
      return this.mapToRecord(created);
    } catch (e: any) {
      if (e.code === 'P2002') {
        // Unique constraint - try to find existing
        const existing = await this.prisma.tradingAccount.findFirst({
          where: { tenantId: input.tenantId, exchangeId: input.exchangeId, userId: input.userId, label: input.label },
          select: ExchangeAccountRepository.SAFE_SELECT,
        });
        if (existing) {
          return this.mapToRecord(existing);
        }
      }
      this.logger.error(`Failed to create exchange account tenant=${input.tenantId} venue=${input.venue} error=${e.message}`);
      throw e;
    }
  }

  async findById(id: string, tenantId: string): Promise<ExchangeAccountRecord | null> {
    const record = await this.prisma.tradingAccount.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: ExchangeAccountRepository.SAFE_SELECT,
    });
    return record ? this.mapToRecord(record) : null;
  }

  async findByIdWithUserCheck(id: string, tenantId: string, userId?: string | null): Promise<ExchangeAccountRecord | null> {
    const where: any = { id, tenantId, deletedAt: null };
    if (userId) {
      where.userId = userId;
    }
    const record = await this.prisma.tradingAccount.findFirst({
      where,
      select: ExchangeAccountRepository.SAFE_SELECT,
    });
    return record ? this.mapToRecord(record) : null;
  }

  async listByTenant(
    tenantId: string,
    filters?: {
      userId?: string;
      venue?: ExchangeVenue;
      environment?: ExchangeEnvironment;
      status?: ExchangeAccountState;
      page?: number;
      limit?: number;
      search?: string;
    },
  ): Promise<{ data: ExchangeAccountRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.TradingAccountWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filters?.userId ? { userId: filters.userId } : {}),
      ...(filters?.venue ? { exchange: { venue: filters.venue as any } } : {}),
      ...(filters?.status ? { status: filters.status as any } : {}),
      ...(filters?.environment
        ? filters.environment === ExchangeEnvironment.LIVE
          ? { isSandbox: false }
          : { isSandbox: true }
        : {}),
      ...(filters?.search ? { label: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tradingAccount.findMany({
        where,
        select: ExchangeAccountRepository.SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tradingAccount.count({ where }),
    ]);

    return { data: rows.map((r) => this.mapToRecord(r)), total };
  }

  async listByUser(tenantId: string, userId: string, filters?: { venue?: ExchangeVenue; environment?: ExchangeEnvironment; status?: ExchangeAccountState; page?: number; limit?: number }): Promise<{ data: ExchangeAccountRecord[]; total: number }> {
    return this.listByTenant(tenantId, { ...filters, userId });
  }

  async updateStatus(id: string, tenantId: string, status: ExchangeAccountState, errorCode?: string | null, errorMessage?: string | null): Promise<ExchangeAccountRecord | null> {
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: {
          status: status as any,
          lastFailureCode: errorCode || null,
          lastFailureAt: errorCode ? new Date() : undefined,
          updatedAt: new Date(),
        },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      // Verify tenant ownership after update (defense in depth)
      if ((updated as any).tenantId !== tenantId) {
        this.logger.error(`Tenant mismatch on updateStatus id=${id} expected=${tenantId} got=${(updated as any).tenantId}`);
        return null;
      }
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async updateHealth(id: string, tenantId: string, health: { lastVerifiedAt?: Date; consecutiveFailures?: number; canTrade?: boolean; canReadData?: boolean; canWithdraw?: boolean; verifiedPermissions?: string[]; lastFailureCode?: string | null }): Promise<ExchangeAccountRecord | null> {
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: {
          lastVerifiedAt: health.lastVerifiedAt || undefined,
          consecutiveFailures: health.consecutiveFailures,
          canTrade: health.canTrade,
          canReadData: health.canReadData,
          canWithdraw: health.canWithdraw ?? false,
          verifiedPermissions: health.verifiedPermissions,
          lastFailureCode: health.lastFailureCode,
          lastFailureAt: health.lastFailureCode ? new Date() : undefined,
          updatedAt: new Date(),
        },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      if ((updated as any).tenantId !== tenantId) return null;
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async enableAccount(id: string, tenantId: string): Promise<ExchangeAccountRecord | null> {
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: { status: 'ACTIVE' as any, updatedAt: new Date() },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      if ((updated as any).tenantId !== tenantId) return null;
      this.logger.log(`Account enabled id=${id} tenant=${tenantId}`);
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async disableAccount(id: string, tenantId: string, reason?: string): Promise<ExchangeAccountRecord | null> {
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: { status: 'DISABLED' as any, updatedAt: new Date(), lastFailureCode: reason?.substring(0, 64) || 'MANUAL_DISABLE' },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      if ((updated as any).tenantId !== tenantId) return null;
      this.logger.log(`Account disabled id=${id} tenant=${tenantId} reason=${reason || 'manual'}`);
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async revokeAccount(id: string, tenantId: string): Promise<ExchangeAccountRecord | null> {
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: {
          status: 'DISABLED' as any,
          apiKeyCiphertext: null,
          apiSecretCiphertext: null,
          passphraseCiphertext: null,
          encryptedDataKey: null,
          credentialRef: null,
          updatedAt: new Date(),
          deletedAt: new Date(),
        },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      if ((updated as any).tenantId !== tenantId) return null;
      this.logger.log(`Account revoked id=${id} tenant=${tenantId}`);
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async updateLiveTradingEnabled(id: string, tenantId: string, enabled: boolean): Promise<ExchangeAccountRecord | null> {
    // This must be gated by existing live enablement outside repository - repository itself does not authorize live
    try {
      const updated = await this.prisma.tradingAccount.update({
        where: { id },
        data: { liveTradingEnabled: enabled, updatedAt: new Date() },
        select: ExchangeAccountRepository.SAFE_SELECT,
      });
      if ((updated as any).tenantId !== tenantId) return null;
      this.logger.log(`Live trading ${enabled ? 'enabled' : 'disabled'} id=${id} tenant=${tenantId}`);
      return this.mapToRecord(updated);
    } catch {
      return null;
    }
  }

  async updateSyncMetadata(id: string, tenantId: string, metadata: { lastSyncAt?: Date; capabilities?: ExchangeCapability[] }): Promise<void> {
    try {
      await this.prisma.tradingAccount.update({
        where: { id },
        data: {
          lastVerifiedAt: metadata.lastSyncAt || undefined,
          updatedAt: new Date(),
          // Store capabilities in verifiedPermissions for backward compat, plus metadata
          verifiedPermissions: metadata.capabilities || undefined,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to update sync metadata id=${id} error=${e.message}`);
    }
  }

  async countByUser(tenantId: string, userId: string): Promise<number> {
    return this.prisma.tradingAccount.count({ where: { tenantId, userId, deletedAt: null } });
  }

  async countByTenant(tenantId: string): Promise<number> {
    return this.prisma.tradingAccount.count({ where: { tenantId, deletedAt: null } });
  }

  async findByBlindIndex(tenantId: string, blindIndex: string): Promise<ExchangeAccountRecord | null> {
    const record = await this.prisma.tradingAccount.findFirst({
      where: { tenantId, apiKeyBlindIndex: blindIndex, deletedAt: null },
      select: ExchangeAccountRepository.SAFE_SELECT,
    });
    return record ? this.mapToRecord(record) : null;
  }

  private mapToRecord(row: any): ExchangeAccountRecord {
    const venue = row.exchange?.venue || 'BINANCE';
    const environment = row.isSandbox ? ExchangeEnvironment.TESTNET : ExchangeEnvironment.LIVE;
    // Map TradingAccountStatus to ExchangeAccountState
    const statusMap: Record<string, ExchangeAccountState> = {
      PENDING_VALIDATION: ExchangeAccountState.PENDING,
      ACTIVE: ExchangeAccountState.ACTIVE,
      DISABLED: ExchangeAccountState.DISABLED,
      CREDENTIALS_INVALID: ExchangeAccountState.ERROR,
      WITHDRAWAL_ENABLED_REJECTED: ExchangeAccountState.ERROR,
    };
    const status = statusMap[row.status] || ExchangeAccountState.PENDING;

    // Derive health state from consecutive failures and last failure
    let healthState = ExchangeHealthState.HEALTHY;
    if (row.consecutiveFailures > 5) healthState = ExchangeHealthState.DEGRADED;
    if (row.consecutiveFailures > 10) healthState = ExchangeHealthState.UNAVAILABLE;
    if (row.lastFailureCode && row.lastFailureCode.includes('AUTH')) healthState = ExchangeHealthState.AUTH_FAILED;
    if (row.lastFailureCode && row.lastFailureCode.includes('RATE_LIMIT')) healthState = ExchangeHealthState.RATE_LIMITED;

    const connectionState = row.status === 'ACTIVE' ? ExchangeConnectionState.CONNECTED : row.status === 'PENDING_VALIDATION' ? ExchangeConnectionState.CONNECTING : ExchangeConnectionState.DISCONNECTED;

    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId || null,
      exchangeId: row.exchangeId,
      venue: venue as ExchangeVenue,
      label: row.label,
      status,
      environment,
      isSandbox: row.isSandbox,
      credentialSource: row.credentialSource,
      credentialRef: row.credentialRef || null,
      apiKeyLastFour: row.apiKeyLastFour || null,
      apiKeyBlindIndex: row.apiKeyBlindIndex || null,
      capabilities: (row.verifiedPermissions as ExchangeCapability[]) || [],
      healthState,
      connectionState,
      lastVerifiedAt: row.lastVerifiedAt || null,
      lastSyncAt: row.lastVerifiedAt || null,
      lastErrorCode: row.lastFailureCode || null,
      lastErrorMessage: null,
      liveTradingEnabled: row.liveTradingEnabled || false,
      privateStreamEnabled: row.privateStreamEnabled || false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt || null,
      idempotencyKey: null,
      metadata: {},
    };
  }
}
