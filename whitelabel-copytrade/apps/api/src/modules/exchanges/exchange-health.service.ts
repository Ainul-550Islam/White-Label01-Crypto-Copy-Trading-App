// # Responsibility: derive health from fresh authenticated connectivity, native credential/counter evidence and validated telemetry; unknown/stale/degraded/simulated health never permits live trading.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeHealthState, type ExchangeHealth } from './exchange.types';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeConnectivityService } from './exchange-connectivity.service';

interface HealthMetrics {
  tenantId: string; accountId: string;
  latencyMs: number | null; latencyMeasuredAt: string | null;
  rateLimitPressure: number | null; rateLimitMeasuredAt: string | null; retryUntilMs: number | null;
}
const HEALTH_TTL_MS = 60_000;

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value: unknown): value is number { return finite(value) && value >= 0; }
function nullableNumber(value: unknown): value is number | null { return value === null || nonnegative(value); }
function nullableCount(value: unknown): value is number | null { return value === null || (nonnegative(value) && Number.isSafeInteger(value)); }
function nullableText(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function recent(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const age = Date.now() - new Date(value).getTime();
  return Number.isFinite(age) && age >= 0 && age <= HEALTH_TTL_MS;
}
function healthRecord(value: unknown): value is ExchangeHealth {
  if (!object(value)) return false;
  return typeof value.tenantId === 'string' && typeof value.accountId === 'string'
    && Object.values(ExchangeVenue).some((venue) => venue === value.venue)
    && Object.values(ExchangeEnvironment).some((environment) => environment === value.environment)
    && Object.values(ExchangeHealthState).some((state) => state === value.state)
    && nullableNumber(value.latencyMs) && nullableCount(value.authFailures) && nullableCount(value.apiErrors)
    && nullableNumber(value.rateLimitPressure) && (value.rateLimitPressure === null || value.rateLimitPressure <= 100)
    && nullableNumber(value.syncAgeMs) && (value.clockDriftMs === null || finite(value.clockDriftMs))
    && (value.websocketConnected === null || typeof value.websocketConnected === 'boolean')
    && typeof value.providerAvailable === 'boolean' && typeof value.credentialExpired === 'boolean' && typeof value.credentialRevoked === 'boolean'
    && (value.dataCompleteness === 'OBSERVED' || value.dataCompleteness === 'UNKNOWN')
    && recent(value.lastCheckedAt) && nullableText(value.lastErrorCode) && nullableText(value.message);
}

@Injectable()
export class ExchangeHealthService {
  private readonly logger = new Logger(ExchangeHealthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
    private readonly cache: CacheService,
    private readonly connectivityService: ExchangeConnectivityService,
  ) {}

  async checkHealth(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<ExchangeHealth> {
    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    const now = new Date();
    const health: ExchangeHealth = { ...input, state: ExchangeHealthState.UNAVAILABLE, latencyMs: null, authFailures: null,
      apiErrors: null, rateLimitPressure: null, syncAgeMs: null, clockDriftMs: null, websocketConnected: null,
      providerAvailable: false, credentialExpired: false, credentialRevoked: false, dataCompleteness: 'UNKNOWN',
      lastCheckedAt: now.toISOString(), lastErrorCode: 'ACCOUNT_NOT_FOUND', message: 'Account unavailable' };
    if (!account) return health;
    if (account.tenantId !== input.tenantId || account.venue !== input.venue || account.environment !== input.environment
      || account.isSandbox !== (input.environment !== ExchangeEnvironment.LIVE)) {
      return { ...health, lastErrorCode: 'ENVIRONMENT_MISMATCH', message: 'Account tenant/venue/environment mismatch' };
    }
    let credentialsKnown = false;
    try {
      const validation = await this.credentialService.validateCredentialReference(input.tenantId, input.accountId);
      const native = await this.prisma.tradingAccount.findFirst({ where: { id: input.accountId, tenantId: input.tenantId, deletedAt: null },
        select: { credentialExpiresAt: true, consecutiveFailures: true, lastFailureCode: true } });
      if (native) {
        credentialsKnown = true;
        health.credentialRevoked = validation.valid !== true;
        health.credentialExpired = native.credentialExpiresAt !== null
          && (!Number.isFinite(native.credentialExpiresAt.getTime()) || native.credentialExpiresAt.getTime() <= now.getTime());
        // The schema stores a total consecutive-failure count, not an auth/API breakdown. Positive totals cannot prove either category's exact count.
        if (Number.isSafeInteger(native.consecutiveFailures) && native.consecutiveFailures === 0 && native.lastFailureCode === null) {
          health.authFailures = 0; health.apiErrors = 0;
        }
        health.lastErrorCode = native.lastFailureCode;
      }
    } catch { health.credentialRevoked = true; }
    if (!credentialsKnown) return { ...health, state: ExchangeHealthState.AUTH_FAILED, credentialRevoked: true,
      lastErrorCode: 'CREDENTIAL_EVIDENCE_UNAVAILABLE', message: 'Required native credential evidence unavailable' };
    if (health.credentialRevoked || health.credentialExpired) return { ...health, state: ExchangeHealthState.AUTH_FAILED,
      lastErrorCode: health.credentialRevoked ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_EXPIRED', message: 'Credential invalid or expired' };

    try {
      const connectivity = await this.connectivityService.checkConnectivity(input);
      health.providerAvailable = connectivity.connected === true && connectivity.environment === input.environment
        && connectivity.isSimulated === (input.environment !== ExchangeEnvironment.LIVE);
      health.latencyMs = nonnegative(connectivity.latencyMs) ? connectivity.latencyMs : null;
      health.clockDriftMs = connectivity.clockDriftMs !== null && finite(connectivity.clockDriftMs) ? connectivity.clockDriftMs : null;
      if (!health.providerAvailable || connectivity.degraded || connectivity.failureCode !== null) {
        return { ...health, state: ExchangeHealthState.UNAVAILABLE, lastErrorCode: connectivity.failureCode ?? 'PROVIDER_UNAVAILABLE',
          message: 'Fresh authenticated connectivity evidence unavailable/degraded' };
      }
    } catch { return { ...health, lastErrorCode: 'PROVIDER_UNAVAILABLE', message: 'Fresh authenticated connectivity probe failed' }; }
    const metrics = await this.readMetrics(input.tenantId, input.accountId);
    health.rateLimitPressure = metrics.rateLimitPressure;
    if (account.lastSyncAt) {
      const age = now.getTime() - account.lastSyncAt.getTime();
      health.syncAgeMs = Number.isFinite(age) && age >= 0 ? age : null;
    }
    health.dataCompleteness = health.latencyMs !== null && health.clockDriftMs !== null && health.authFailures !== null
      && health.apiErrors !== null && health.rateLimitPressure !== null && health.syncAgeMs !== null ? 'OBSERVED' : 'UNKNOWN';
    health.state = ExchangeHealthState.HEALTHY;
    health.message = null;
    if ((health.authFailures !== null && health.authFailures > 0) || health.lastErrorCode?.includes('AUTH') || health.lastErrorCode === 'INVALID_CREDENTIALS') {
      health.state = ExchangeHealthState.AUTH_FAILED; health.message = 'Persisted authentication failure evidence';
    } else if (health.rateLimitPressure !== null && (health.rateLimitPressure > 80 || (metrics.retryUntilMs !== null && metrics.retryUntilMs > Date.now()))) {
      health.state = ExchangeHealthState.RATE_LIMITED; health.lastErrorCode = 'RATE_LIMITED'; health.message = 'Observed rate-limit pressure/retry window';
    } else if (health.syncAgeMs !== null && health.syncAgeMs > 5 * 60_000) {
      health.state = ExchangeHealthState.STALE; health.lastErrorCode = 'STALE_SYNC'; health.message = 'Observed synchronization is stale';
    } else if (health.dataCompleteness !== 'OBSERVED') {
      health.state = ExchangeHealthState.DEGRADED; health.lastErrorCode = 'HEALTH_EVIDENCE_UNKNOWN'; health.message = 'Required health metrics/sync evidence are unknown';
    } else if (health.latencyMs !== null && health.latencyMs > 2000) {
      health.state = ExchangeHealthState.DEGRADED; health.message = 'Observed high latency';
    } else if (health.apiErrors !== null && health.apiErrors > 5) {
      health.state = ExchangeHealthState.DEGRADED; health.message = 'Persisted API failure evidence';
    }
    await this.cache.set(this.healthKey(input.tenantId, input.accountId), health, HEALTH_TTL_MS / 1000);
    if (health.state !== ExchangeHealthState.HEALTHY) await this.auditService.record({ ...input, event: 'EXCHANGE_HEALTH_CHANGED', result: 'SUCCESS',
      safeMetadata: { state: health.state, dataCompleteness: health.dataCompleteness, lastErrorCode: health.lastErrorCode } });
    this.logger.log(`Health check tenant=${input.tenantId} account=${input.accountId} state=${health.state}`);
    return health;
  }

  async getHealth(tenantId: string, accountId: string): Promise<ExchangeHealth | null> {
    const account = await this.accountRepo.findById(accountId, tenantId);
    if (!account) return null;
    const cached = await this.cache.get<unknown>(this.healthKey(tenantId, accountId));
    // Valid cached denials are safe short-lived diagnostics. Cached HEALTHY never replaces a fresh authenticated check.
    if (healthRecord(cached) && cached.tenantId === tenantId && cached.accountId === accountId
      && cached.venue === account.venue && cached.environment === account.environment && cached.state !== ExchangeHealthState.HEALTHY) return cached;
    return this.checkHealth({ tenantId, accountId, venue: account.venue, environment: account.environment });
  }

  async listHealthByTenant(tenantId: string, userId?: string): Promise<ExchangeHealth[]> {
    const results: ExchangeHealth[] = [];
    let page = 1;
    while (true) {
      const { data, total } = await this.accountRepo.listByTenant(tenantId, { userId, page, limit: 100 });
      for (const account of data) { const health = await this.getHealth(tenantId, account.id); if (health) results.push(health); }
      if (page * 100 >= total || data.length === 0) break;
      page += 1;
    }
    return results;
  }

  async recordLatency(tenantId: string, accountId: string, latencyMs: number): Promise<void> {
    if (!nonnegative(latencyMs)) throw new BadRequestException('Latency must be finite and nonnegative');
    const metrics = await this.readMetrics(tenantId, accountId);
    await this.writeMetrics({ ...metrics, latencyMs, latencyMeasuredAt: new Date().toISOString() });
  }

  async recordAuthFailure(tenantId: string, accountId: string, errorCode: string): Promise<void> {
    const persisted = await this.accountRepo.recordConnectivityFailure(accountId, tenantId, errorCode);
    if (!persisted) throw new BadRequestException('Account failure evidence could not be persisted for tenant');
    await this.cache.delete(this.healthKey(tenantId, accountId));
  }

  async recordRateLimit(tenantId: string, accountId: string, pressure: number, retryAfterMs?: number): Promise<void> {
    if (!finite(pressure) || pressure < 0 || pressure > 100 || (retryAfterMs !== undefined && !nonnegative(retryAfterMs))) {
      throw new BadRequestException('Rate-limit measurements must be finite and within range');
    }
    const metrics = await this.readMetrics(tenantId, accountId);
    await this.writeMetrics({ ...metrics, rateLimitPressure: pressure, rateLimitMeasuredAt: new Date().toISOString(),
      retryUntilMs: retryAfterMs === undefined ? metrics.retryUntilMs : Date.now() + retryAfterMs });
  }

  isStaleHealthAllowsLiveTrading(health: ExchangeHealth): boolean {
    // Only a satisfied health prerequisite is returned here; this does not enable trading or replace the separate live/risk/compliance gates.
    return healthRecord(health) && health.environment === ExchangeEnvironment.LIVE && health.state === ExchangeHealthState.HEALTHY
      && health.dataCompleteness === 'OBSERVED' && health.providerAvailable === true && health.credentialExpired === false && health.credentialRevoked === false
      && health.lastErrorCode === null && health.clockDriftMs !== null && health.authFailures === 0 && health.apiErrors !== null && health.apiErrors <= 5 && health.rateLimitPressure !== null && health.rateLimitPressure <= 80
      && health.syncAgeMs !== null && health.syncAgeMs <= 5 * 60_000 && health.latencyMs !== null && health.latencyMs <= 2000;
  }

  private healthKey(tenantId: string, accountId: string): string { return `exchange:health:${tenantId}:${accountId}`; }
  private metricsKey(tenantId: string, accountId: string): string { return `exchange:health:metrics:${tenantId}:${accountId}`; }
  private async readMetrics(tenantId: string, accountId: string): Promise<HealthMetrics> {
    const empty: HealthMetrics = { tenantId, accountId, latencyMs: null, latencyMeasuredAt: null,
      rateLimitPressure: null, rateLimitMeasuredAt: null, retryUntilMs: null };
    const cached = await this.cache.get<unknown>(this.metricsKey(tenantId, accountId));
    if (!object(cached) || cached.tenantId !== tenantId || cached.accountId !== accountId
      || !nullableNumber(cached.latencyMs) || !nullableNumber(cached.rateLimitPressure) || !nullableNumber(cached.retryUntilMs)
      || !nullableText(cached.latencyMeasuredAt) || !nullableText(cached.rateLimitMeasuredAt)
      || (cached.rateLimitPressure !== null && cached.rateLimitPressure > 100)) return empty;
    // Updating latency cannot renew the provenance/freshness of an older rate-limit measurement.
    const latencyCurrent = recent(cached.latencyMeasuredAt); const rateCurrent = recent(cached.rateLimitMeasuredAt);
    return { tenantId, accountId, latencyMs: latencyCurrent ? cached.latencyMs : null,
      latencyMeasuredAt: latencyCurrent ? cached.latencyMeasuredAt : null,
      rateLimitPressure: rateCurrent ? cached.rateLimitPressure : null, rateLimitMeasuredAt: rateCurrent ? cached.rateLimitMeasuredAt : null,
      retryUntilMs: rateCurrent ? cached.retryUntilMs : null };
  }
  private async writeMetrics(metrics: HealthMetrics): Promise<void> {
    await this.cache.set(this.metricsKey(metrics.tenantId, metrics.accountId), metrics, HEALTH_TTL_MS / 1000);
    await this.cache.delete(this.healthKey(metrics.tenantId, metrics.accountId));
  }
}
