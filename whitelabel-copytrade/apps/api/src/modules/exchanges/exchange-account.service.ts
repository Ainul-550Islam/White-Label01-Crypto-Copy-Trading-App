import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeConnectivityService } from './exchange-connectivity.service';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeHealthService } from './exchange-health.service';
import { ExchangeSymbolService } from './exchange-symbol.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeAccountState, ExchangeSafeReference, maskApiKey } from './exchange.types';
import { ExchangeProviderError, ExchangeProviderErrorCode } from './exchange-provider.interface';
import { PlanLimitExchangeAccountsGuard } from '../billing/enforcement/plan-limit-exchange-accounts.guard';
import { ExecutionSafetyService } from '../execution/execution-safety.service';

export interface ConnectAccountInput {
  tenantId: string;
  userId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  credentialSource: 'ENVELOPE_DB' | 'SECRET_MANAGER' | 'ENVIRONMENT';
  credentialRef?: string | null;
  idempotencyKey?: string | null;
  ipAllowlist?: string[];
  actorId: string;
  requestId?: string;
}

export interface EnableAccountInput {
  tenantId: string;
  accountId: string;
  actorId: string;
  requestId?: string;
  liveTradingRequested?: boolean;
}

/**
 * Main exchange-account orchestration: connect, validate, enable/disable, rotate credentials, capability discovery, health state, and account lifecycle.
 * Flow: Request → entitlement/plan limit check → secure credential reference → provider validation → capability discovery → health check → activate
 * Important: A connected account must NOT automatically receive live trading permission.
 */
@Injectable()
export class ExchangeAccountService {
  private readonly logger = new Logger(ExchangeAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly credentialService: ExchangeCredentialService,
    private readonly registry: ExchangeRegistryService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly connectivityService: ExchangeConnectivityService,
    private readonly auditService: ExchangeAuditService,
    private readonly healthService: ExchangeHealthService,
    private readonly symbolService: ExchangeSymbolService,
    private readonly limitGuard: PlanLimitExchangeAccountsGuard,
    private readonly safetyService: ExecutionSafetyService,
  ) {}

  private async resolveExchangeId(venue: ExchangeVenue): Promise<string> {
    // Find or create Exchange entry in Prisma
    let exchange = await this.prisma.exchange.findFirst({ where: { venue: venue as any } });
    if (!exchange) {
      // Create exchange entry if not exists - safe metadata only
      const registryEntry = this.registry.getVenue(venue);
      if (!registryEntry) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, `Venue ${venue} not in registry`, venue, ExchangeEnvironment.LIVE, false);
      }
      exchange = await this.prisma.exchange.create({
        data: {
          venue: venue as any,
          name: registryEntry.displayName,
          isEnabled: true,
          tradingEnabled: false, // Must be explicitly enabled by operator
          supportedMarketTypes: ['SPOT'] as any,
          restBaseUrl: registryEntry.baseRestUrlLive,
          wsBaseUrl: registryEntry.baseWsUrlLive,
          requiresPassphrase: registryEntry.requiresPassphrase,
          supportsSandbox: true,
          weightLimitPerMinute: 1200,
          maxOrdersPerSecond: 5,
          maxLeverage: 1,
          defaultBookDepth: 50,
        },
      });
    }
    return exchange.id;
  }

  async connectAccount(input: ConnectAccountInput): Promise<ExchangeSafeReference> {
    // 1. Validate venue and environment
    if (!this.registry.isVenueSupported(input.venue) && input.venue !== ExchangeVenue.OTHER_CONFIGURED) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, `Unknown venue ${input.venue}`, input.venue, input.environment, false);
    }

    if (!this.registry.isEnvironmentSupported(input.venue, input.environment)) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        `Environment ${input.environment} not supported for ${input.venue}`,
        input.venue,
        input.environment,
        false,
      );
    }

    // 2. Environment binding validation - LIVE vs TESTNET fail closed
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    if (!this.registry.validateEnvironmentBinding(input.venue, input.environment, isSandbox)) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        `Environment mismatch: ${input.environment} isSandbox=${isSandbox}`,
        input.venue,
        input.environment,
        false,
      );
    }

    // 3. Entitlement/plan limit check - use existing maxExchangeAccountsPerUser
    const enforcementActor = { tenantId: input.tenantId, userId: input.actorId } as any;
    try {
      await this.limitGuard.reserve(enforcementActor, input.userId);
    } catch (e: any) {
      this.logger.warn(`Plan limit exceeded tenant=${input.tenantId} user=${input.userId} venue=${input.venue}`);
      throw e;
    }

    let accountRecord;
    try {
      // 4. Resolve exchangeId
      const exchangeId = await this.resolveExchangeId(input.venue);

      // 5. Create account metadata first (without secrets)
      accountRecord = await this.accountRepo.create({
        tenantId: input.tenantId,
        userId: input.userId,
        exchangeId,
        venue: input.venue,
        label: input.label,
        environment: input.environment,
        isSandbox,
        credentialSource: input.credentialSource,
        credentialRef: input.credentialRef || null,
        apiKeyLastFour: input.apiKey.slice(-4),
        idempotencyKey: input.idempotencyKey || null,
      });

      // 6. Secure credential reference - never store plaintext
      await this.credentialService.createCredentialReference({
        tenantId: input.tenantId,
        userId: input.userId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
        credentialSource: input.credentialSource,
        credentialRef: input.credentialRef || null,
      });

      // 7. Provider validation - connectivity check without placing orders
      const connectivityResult = await this.connectivityService.checkConnectivity({
        tenantId: input.tenantId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
      });

      if (!connectivityResult.connected) {
        await this.accountRepo.updateStatus(accountRecord.id, input.tenantId, ExchangeAccountState.ERROR, connectivityResult.failureCode, connectivityResult.failureReason);
        await this.auditService.record({
          tenantId: input.tenantId,
          accountId: accountRecord.id,
          venue: input.venue,
          environment: input.environment,
          event: 'EXCHANGE_ACCOUNT_CONNECTED' as any,
          result: 'FAILURE',
          actorId: input.actorId,
          safeMetadata: { failureCode: connectivityResult.failureCode, latencyMs: connectivityResult.latencyMs },
          requestId: input.requestId,
        });
        throw new ExchangeProviderError(
          ExchangeProviderErrorCode.AUTH_FAILED,
          `Connectivity check failed: ${connectivityResult.failureReason || connectivityResult.failureCode}`,
          input.venue,
          input.environment,
          false,
        );
      }

      // 8. Capability discovery
      const capabilities = await this.connectivityService.discoverCapabilities({
        tenantId: input.tenantId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
      });

      // 9. Health check
      await this.healthService.checkHealth({
        tenantId: input.tenantId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
      });

      // 10. Activate - but NOT live trading
      const activated = await this.accountRepo.enableAccount(accountRecord.id, input.tenantId);
      if (!activated) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, 'Failed to activate account', input.venue, input.environment, false);
      }

      await this.accountRepo.updateSyncMetadata(accountRecord.id, input.tenantId, {
        lastSyncAt: new Date(),
        capabilities: capabilities.capabilities,
      });

      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
        event: 'EXCHANGE_ACCOUNT_CONNECTED',
        result: 'SUCCESS',
        actorId: input.actorId,
        safeMetadata: { capabilities: capabilities.capabilities, latencyMs: connectivityResult.latencyMs, isSandbox },
        requestId: input.requestId,
      });

      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: accountRecord.id,
        venue: input.venue,
        environment: input.environment,
        event: 'EXCHANGE_ACCOUNT_ACTIVATED',
        result: 'SUCCESS',
        actorId: input.actorId,
        safeMetadata: { venue: input.venue, environment: input.environment },
        requestId: input.requestId,
      });

      this.logger.log(`Account connected and activated id=${accountRecord.id} tenant=${input.tenantId} venue=${input.venue} env=${input.environment}`);

      return this.toSafeReference(activated);
    } catch (e: any) {
      // Release slot on failure
      try {
        await this.limitGuard.release(enforcementActor, input.userId);
      } catch {}

      // If account was created but failed later, mark as ERROR and do not leave as ACTIVE
      if (accountRecord) {
        try {
          await this.accountRepo.updateStatus(accountRecord.id, input.tenantId, ExchangeAccountState.ERROR, e.code || 'CONNECT_FAILED', e.message?.substring(0, 200));
        } catch {}
      }

      if (e instanceof ExchangeProviderError) throw e;
      this.logger.error(`Failed to connect account tenant=${input.tenantId} venue=${input.venue} error=${e.message}`);
      throw new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, `Failed to connect account: ${e.message}`, input.venue, input.environment, false);
    }
  }

  async getAccount(tenantId: string, accountId: string, userId?: string | null): Promise<ExchangeSafeReference | null> {
    const record = await this.accountRepo.findByIdWithUserCheck(accountId, tenantId, userId);
    if (!record) return null;
    return this.toSafeReference(record);
  }

  async listAccounts(
    tenantId: string,
    filters: { userId?: string; venue?: ExchangeVenue; environment?: ExchangeEnvironment; status?: ExchangeAccountState; page?: number; limit?: number; search?: string },
    requesterUserId?: string | null,
    isPrivileged?: boolean,
  ): Promise<{ data: ExchangeSafeReference[]; total: number }> {
    // Tenant isolation + user isolation for non-privileged
    const effectiveUserId = isPrivileged ? filters.userId : requesterUserId || filters.userId;
    const result = await this.accountRepo.listByTenant(tenantId, { ...filters, userId: effectiveUserId || undefined });
    return { data: result.data.map((r) => this.toSafeReference(r)), total: result.total };
  }

  async disableAccount(tenantId: string, accountId: string, actorId: string, reason?: string, requestId?: string): Promise<ExchangeSafeReference | null> {
    const record = await this.accountRepo.findById(accountId, tenantId);
    if (!record) return null;

    const disabled = await this.accountRepo.disableAccount(accountId, tenantId, reason);
    if (!disabled) return null;

    await this.auditService.record({
      tenantId,
      accountId,
      venue: record.venue,
      environment: record.environment,
      event: 'EXCHANGE_ACCOUNT_DISABLED',
      result: 'SUCCESS',
      actorId,
      safeMetadata: { reason: reason?.substring(0, 200) },
      requestId,
    });

    return this.toSafeReference(disabled);
  }

  async revokeAccount(tenantId: string, accountId: string, actorId: string, requestId?: string): Promise<ExchangeSafeReference | null> {
    const record = await this.accountRepo.findById(accountId, tenantId);
    if (!record) return null;

    // Revoke credential first
    await this.credentialService.revokeCredential(tenantId, accountId, record.venue, record.environment);

    const revoked = await this.accountRepo.revokeAccount(accountId, tenantId);
    if (!revoked) return null;

    // Release plan limit slot
    if (record.userId) {
      try {
        const actor = { tenantId, userId: actorId } as any;
        await this.limitGuard.release(actor, record.userId);
      } catch {}
    }

    await this.auditService.record({
      tenantId,
      accountId,
      venue: record.venue,
      environment: record.environment,
      event: 'EXCHANGE_ACCOUNT_REVOKED',
      result: 'SUCCESS',
      actorId,
      safeMetadata: { venue: record.venue },
      requestId,
    });

    return this.toSafeReference(revoked);
  }

  async rotateCredentials(input: {
    tenantId: string;
    accountId: string;
    venue: ExchangeVenue;
    environment: ExchangeEnvironment;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    credentialSource: 'ENVELOPE_DB' | 'SECRET_MANAGER' | 'ENVIRONMENT';
    credentialRef?: string | null;
    actorId: string;
    requestId?: string;
  }): Promise<ExchangeSafeReference | null> {
    const record = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!record) return null;

    // Environment mismatch must fail closed
    if (record.environment !== input.environment) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        `Cannot rotate with different environment: existing=${record.environment} new=${input.environment}`,
        input.venue,
        input.environment,
        false,
      );
    }

    const rotated = await this.credentialService.rotateCredential({
      tenantId: input.tenantId,
      userId: record.userId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      passphrase: input.passphrase,
      credentialSource: input.credentialSource,
      credentialRef: input.credentialRef || null,
    });

    // Re-validate connectivity after rotation
    const connectivity = await this.connectivityService.checkConnectivity({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
    });

    if (!connectivity.connected) {
      await this.accountRepo.updateStatus(input.accountId, input.tenantId, ExchangeAccountState.ERROR, connectivity.failureCode, connectivity.failureReason);
      throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, `Post-rotation connectivity failed: ${connectivity.failureReason}`, input.venue, input.environment, false);
    }

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      event: 'CREDENTIAL_ROTATED',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { apiKeyLastFour: rotated.apiKeyLastFour },
      requestId: input.requestId,
    });

    const updated = await this.accountRepo.findById(input.accountId, input.tenantId);
    return updated ? this.toSafeReference(updated) : null;
  }

  async enableLiveTrading(input: EnableAccountInput): Promise<ExchangeSafeReference | null> {
    // CRITICAL: Must call existing live safety gate
    const safety = await this.safetyService.safetySummary(input.tenantId);
    if (!safety.wouldTransmitLiveOrder) {
      this.logger.warn(`Live trading enable blocked by safety gate tenant=${input.tenantId} account=${input.accountId} reasons=${safety.blockingReasons.join(', ')}`);
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.PERMISSION_DENIED,
        `Live trading blocked by safety gate: ${safety.blockingReasons.join(', ')}`,
        ExchangeVenue.BINANCE,
        ExchangeEnvironment.LIVE,
        false,
      );
    }

    const record = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!record) return null;

    if (record.environment !== ExchangeEnvironment.LIVE) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        'Live trading can only be enabled for LIVE environment accounts',
        record.venue,
        record.environment,
        false,
      );
    }

    if (record.status !== ExchangeAccountState.ACTIVE) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.PERMISSION_DENIED, 'Account must be ACTIVE to enable live trading', record.venue, record.environment, false);
    }

    const updated = await this.accountRepo.updateLiveTradingEnabled(input.accountId, input.tenantId, true);
    if (!updated) return null;

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: updated.venue,
      environment: updated.environment,
      event: 'EXCHANGE_ACCOUNT_ACTIVATED',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { liveTradingEnabled: true, safetyGatePassed: true },
      requestId: input.requestId,
    });

    return this.toSafeReference(updated);
  }

  async refreshCapabilities(tenantId: string, accountId: string, actorId: string, requestId?: string): Promise<ExchangeSafeReference | null> {
    const record = await this.accountRepo.findById(accountId, tenantId);
    if (!record) return null;

    const capabilities = await this.connectivityService.discoverCapabilities({
      tenantId,
      accountId,
      venue: record.venue,
      environment: record.environment,
    });

    await this.accountRepo.updateSyncMetadata(accountId, tenantId, { capabilities: capabilities.capabilities, lastSyncAt: new Date() });

    await this.auditService.record({
      tenantId,
      accountId,
      venue: record.venue,
      environment: record.environment,
      event: 'CAPABILITIES_DISCOVERED',
      result: 'SUCCESS',
      actorId,
      safeMetadata: { capabilities: capabilities.capabilities },
      requestId,
    });

    const updated = await this.accountRepo.findById(accountId, tenantId);
    return updated ? this.toSafeReference(updated) : null;
  }

  private toSafeReference(record: any): ExchangeSafeReference {
    return {
      accountId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      venue: record.venue,
      environment: record.environment,
      label: record.label,
      maskedApiKey: record.apiKeyLastFour ? maskApiKey(`****${record.apiKeyLastFour}`) : '****',
      status: record.status,
      connectionState: record.connectionState,
      healthState: record.healthState,
      capabilities: record.capabilities || [],
      isSandbox: record.isSandbox,
      liveTradingEnabled: record.liveTradingEnabled,
      credentialRef: record.credentialRef,
      credentialSource: record.credentialSource,
      lastVerifiedAt: record.lastVerifiedAt ? new Date(record.lastVerifiedAt).toISOString() : null,
      lastSyncAt: record.lastSyncAt ? new Date(record.lastSyncAt).toISOString() : null,
      lastErrorCode: record.lastErrorCode,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
    };
  }
}
