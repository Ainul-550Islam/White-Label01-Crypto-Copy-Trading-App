import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeHealthState, ExchangeHealth } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeProviderContext } from './exchange-provider.interface';

/**
 * Exchange/account health monitoring: latency, auth failures, rate-limit state, stale sync, clock drift, degraded state, and provider availability.
 * No health result may automatically enable live trading.
 */
@Injectable()
export class ExchangeHealthService {
  private readonly logger = new Logger(ExchangeHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
    private readonly cache: CacheService,
  ) {}

  async checkHealth(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<ExchangeHealth> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    const now = new Date();
    const nowIso = now.toISOString();

    if (!account) {
      return {
        accountId: input.accountId,
        tenantId: input.tenantId,
        venue: input.venue,
        environment: input.environment,
        state: ExchangeHealthState.UNAVAILABLE,
        latencyMs: null,
        authFailures: 0,
        apiErrors: 1,
        rateLimitPressure: 0,
        syncAgeMs: null,
        clockDriftMs: null,
        websocketConnected: null,
        providerAvailable: false,
        credentialExpired: false,
        credentialRevoked: false,
        lastCheckedAt: nowIso,
        lastErrorCode: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found',
      };
    }

    // Check provider availability
    let providerAvailable = false;
    try {
      const provider = this.providerFactory.getProvider(input.venue, input.environment);
      providerAvailable = !!provider;
    } catch {
      providerAvailable = false;
    }

    // Check credential expiration/revocation
    let credentialExpired = false;
    let credentialRevoked = false;
    try {
      const credValidation = await this.credentialService.validateCredentialReference(input.tenantId, input.accountId);
      credentialRevoked = !credValidation.valid;
      // Check expiration from DB
      const dbAccount = await this.prisma.tradingAccount.findFirst({
        where: { id: input.accountId, tenantId: input.tenantId },
        select: { credentialExpiresAt: true },
      });
      if (dbAccount?.credentialExpiresAt && new Date(dbAccount.credentialExpiresAt) < now) {
        credentialExpired = true;
      }
    } catch {
      credentialRevoked = true;
    }

    // Calculate sync age
    let syncAgeMs: number | null = null;
    if (account.lastSyncAt) {
      syncAgeMs = now.getTime() - new Date(account.lastSyncAt).getTime();
    }

    // Get cached health metrics
    let latencyMs: number | null = null;
    let authFailures = 0;
    let apiErrors = 0;
    let rateLimitPressure = 0;
    let clockDriftMs: number | null = null;
    let websocketConnected: boolean | null = null;

    try {
      const cached = await this.cache.get<any>(`exchange:health:${input.tenantId}:${input.accountId}`);
      if (cached) {
        latencyMs = cached.latencyMs || null;
        authFailures = cached.authFailures || 0;
        apiErrors = cached.apiErrors || 0;
        rateLimitPressure = cached.rateLimitPressure || 0;
        clockDriftMs = cached.clockDriftMs || null;
        websocketConnected = cached.websocketConnected ?? null;
      }
    } catch {}

    // Determine health state
    let state = ExchangeHealthState.HEALTHY;
    let message: string | null = null;
    let lastErrorCode = account.lastErrorCode;

    if (!providerAvailable) {
      state = ExchangeHealthState.UNAVAILABLE;
      message = 'Provider unavailable';
      lastErrorCode = 'PROVIDER_UNAVAILABLE';
    } else if (credentialRevoked) {
      state = ExchangeHealthState.AUTH_FAILED;
      message = 'Credential revoked';
      lastErrorCode = 'CREDENTIAL_REVOKED';
    } else if (credentialExpired) {
      state = ExchangeHealthState.AUTH_FAILED;
      message = 'Credential expired';
      lastErrorCode = 'CREDENTIAL_EXPIRED';
    } else if (account.lastErrorCode && account.lastErrorCode.includes('AUTH')) {
      state = ExchangeHealthState.AUTH_FAILED;
      message = `Auth failed: ${account.lastErrorCode}`;
      authFailures = (account as any).consecutiveFailures || 1;
    } else if (rateLimitPressure > 80) {
      state = ExchangeHealthState.RATE_LIMITED;
      message = `Rate limit pressure ${rateLimitPressure}%`;
      lastErrorCode = 'RATE_LIMITED';
    } else if (syncAgeMs && syncAgeMs > 5 * 60 * 1000) {
      state = ExchangeHealthState.STALE;
      message = `Sync stale: ${Math.floor(syncAgeMs / 1000)}s ago`;
      lastErrorCode = 'STALE_SYNC';
    } else if (latencyMs && latencyMs > 2000) {
      state = ExchangeHealthState.DEGRADED;
      message = `High latency: ${latencyMs}ms`;
    } else if (authFailures > 3 || apiErrors > 5) {
      state = ExchangeHealthState.DEGRADED;
      message = `Degraded: authFailures=${authFailures} apiErrors=${apiErrors}`;
    }

    const health: ExchangeHealth = {
      accountId: input.accountId,
      tenantId: input.tenantId,
      venue: input.venue,
      environment: input.environment,
      state,
      latencyMs,
      authFailures,
      apiErrors,
      rateLimitPressure,
      syncAgeMs,
      clockDriftMs,
      websocketConnected,
      providerAvailable,
      credentialExpired,
      credentialRevoked,
      lastCheckedAt: nowIso,
      lastErrorCode,
      message,
    };

    // Cache health
    try {
      await this.cache.set(`exchange:health:${input.tenantId}:${input.accountId}`, health, 60);
    } catch {}

    // Audit health change
    if (state !== ExchangeHealthState.HEALTHY) {
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        event: 'EXCHANGE_HEALTH_CHANGED',
        result: 'SUCCESS',
        safeMetadata: { state, latencyMs, authFailures, rateLimitPressure, syncAgeMs, message, lastErrorCode },
      });
    }

    this.logger.log(`Health check tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} state=${state} latency=${latencyMs}ms`);

    return health;
  }

  async getHealth(tenantId: string, accountId: string): Promise<ExchangeHealth | null> {
    try {
      const cached = await this.cache.get<ExchangeHealth>(`exchange:health:${tenantId}:${accountId}`);
      if (cached) return cached;
    } catch {}

    const account = await this.accountRepo.findById(accountId, tenantId);
    if (!account) return null;

    return this.checkHealth({ tenantId, accountId, venue: account.venue, environment: account.environment });
  }

  async listHealthByTenant(tenantId: string): Promise<ExchangeHealth[]> {
    const { data } = await this.accountRepo.listByTenant(tenantId, { limit: 100 });
    const results: ExchangeHealth[] = [];
    for (const account of data) {
      try {
        const health = await this.getHealth(tenantId, account.id);
        if (health) results.push(health);
      } catch {}
    }
    return results;
  }

  async recordLatency(tenantId: string, accountId: string, latencyMs: number): Promise<void> {
    try {
      const existing = (await this.cache.get<any>(`exchange:health:${tenantId}:${accountId}`)) || {};
      await this.cache.set(`exchange:health:${tenantId}:${accountId}`, { ...existing, latencyMs, lastCheckedAt: new Date().toISOString() }, 60);
    } catch {}
  }

  async recordAuthFailure(tenantId: string, accountId: string, errorCode: string): Promise<void> {
    try {
      const existing = (await this.cache.get<any>(`exchange:health:${tenantId}:${accountId}`)) || { authFailures: 0 };
      await this.cache.set(
        `exchange:health:${tenantId}:${accountId}`,
        { ...existing, authFailures: (existing.authFailures || 0) + 1, lastErrorCode: errorCode, lastCheckedAt: new Date().toISOString() },
        60,
      );
    } catch {}
  }

  async recordRateLimit(tenantId: string, accountId: string, pressure: number, retryAfterMs?: number): Promise<void> {
    try {
      const existing = (await this.cache.get<any>(`exchange:health:${tenantId}:${accountId}`)) || {};
      await this.cache.set(
        `exchange:health:${tenantId}:${accountId}`,
        { ...existing, rateLimitPressure: pressure, retryAfterMs, lastCheckedAt: new Date().toISOString() },
        60,
      );
    } catch {}
  }

  isStaleHealthAllowsLiveTrading(health: ExchangeHealth): boolean {
    // Stale exchange health does not silently authorize live trading - must fail closed
    if (health.state === ExchangeHealthState.STALE) {
      return false;
    }
    if (health.state === ExchangeHealthState.AUTH_FAILED) {
      return false;
    }
    if (health.state === ExchangeHealthState.UNAVAILABLE) {
      return false;
    }
    if (health.credentialExpired || health.credentialRevoked) {
      return false;
    }
    return true;
  }
}
