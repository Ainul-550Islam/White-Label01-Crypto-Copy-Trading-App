import { Injectable, Logger } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeConnectionState, ExchangeCapability, ExchangeConnectivityResult, ExchangeCapabilityDiscovery } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeProviderError, ExchangeProviderErrorCode, ExchangeProviderContext } from './exchange-provider.interface';
import { ExchangeAuditService } from './exchange-audit.service';

/**
 * Performs authenticated connectivity checks and clock/capability validation without placing trading orders.
 * Validates: credential validity, exchange reachability, server time, clock drift, account identity, basic API permissions, capability response.
 * Returns connected/degraded/failed, capability summary, latency, safe failure code. Never creates real order.
 */
@Injectable()
export class ExchangeConnectivityService {
  private readonly logger = new Logger(ExchangeConnectivityService.name);

  constructor(
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly registry: ExchangeRegistryService,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
  ) {}

  async checkConnectivity(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<ExchangeConnectivityResult> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    // Validate environment binding - fail closed
    try {
      this.providerFactory.validateEnvironmentBinding(input.venue, input.environment, isSandbox);
    } catch (e: any) {
      return {
        connected: false,
        degraded: false,
        state: ExchangeConnectionState.FAILED,
        latencyMs: Date.now() - start,
        serverTimeMicros: null,
        clockDriftMs: null,
        capabilities: [],
        failureCode: ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        failureReason: e.message,
        isSimulated: isSandbox,
        environment: input.environment,
      };
    }

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      return {
        connected: false,
        degraded: false,
        state: ExchangeConnectionState.FAILED,
        latencyMs: Date.now() - start,
        serverTimeMicros: null,
        clockDriftMs: null,
        capabilities: [],
        failureCode: e.code || ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        failureReason: e.message,
        isSimulated: isSandbox,
        environment: input.environment,
      };
    }

    // Build provider context - backend only, never logs secrets
    let credentials;
    try {
      // For ENVELOPE_DB, decrypt; for SECRET_MANAGER, this will throw explicit error if vault not configured
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e: any) {
      // If credential is SECRET_MANAGER and vault fetch not implemented, we return failure without activating account
      if (e.code === ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE && e.message.includes('SECRET_MANAGER')) {
        // For SECRET_MANAGER without vault, we cannot test connectivity - return degraded but not fake success
        return {
          connected: false,
          degraded: true,
          state: ExchangeConnectionState.FAILED,
          latencyMs: Date.now() - start,
          serverTimeMicros: null,
          clockDriftMs: null,
          capabilities: [],
          failureCode: ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
          failureReason: 'Secret manager vault not configured or fetch not implemented',
          isSimulated: isSandbox,
          environment: input.environment,
        };
      }

      // For ENVELOPE_DB missing or decryption failure
      return {
        connected: false,
        degraded: false,
        state: ExchangeConnectionState.FAILED,
        latencyMs: Date.now() - start,
        serverTimeMicros: null,
        clockDriftMs: null,
        capabilities: [],
        failureCode: ExchangeProviderErrorCode.AUTH_FAILED,
        failureReason: e.message,
        isSimulated: isSandbox,
        environment: input.environment,
      };
    }

    const context: ExchangeProviderContext = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      isSandbox,
      credentials: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    try {
      const result = await provider.testConnectivity(context);
      const latency = Date.now() - start;

      // Update health in repository
      await this.accountRepo.updateHealth(input.accountId, input.tenantId, {
        lastVerifiedAt: new Date(),
        consecutiveFailures: result.connected ? 0 : undefined,
        lastFailureCode: result.failureCode || null,
      });

      return { ...result, latencyMs: latency, isSimulated: isSandbox, environment: input.environment };
    } catch (e: any) {
      const latency = Date.now() - start;
      const code = e.code || ExchangeProviderErrorCode.UNKNOWN;
      const isAuthFailed = code === ExchangeProviderErrorCode.AUTH_FAILED || code === ExchangeProviderErrorCode.INVALID_CREDENTIALS;

      // Update failure count
      try {
        const existing = await this.accountRepo.findById(input.accountId, input.tenantId);
        if (existing) {
          await this.accountRepo.updateHealth(input.accountId, input.tenantId, {
            consecutiveFailures: (existing as any).consecutiveFailures ? (existing as any).consecutiveFailures + 1 : 1,
            lastFailureCode: code,
          });
        }
      } catch {}

      this.logger.warn(`Connectivity check failed tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} env=${input.environment} code=${code} latency=${latency}ms`);

      return {
        connected: false,
        degraded: !isAuthFailed,
        state: isAuthFailed ? ExchangeConnectionState.FAILED : ExchangeConnectionState.DEGRADED,
        latencyMs: latency,
        serverTimeMicros: null,
        clockDriftMs: null,
        capabilities: [],
        failureCode: code,
        failureReason: e.message?.substring(0, 200) || 'Unknown error',
        isSimulated: isSandbox,
        environment: input.environment,
      };
    }
  }

  async discoverCapabilities(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<ExchangeCapabilityDiscovery> {
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      throw new ExchangeProviderError(
        e.code || ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        `Provider unavailable for capability discovery: ${e.message}`,
        input.venue,
        input.environment,
        false,
      );
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e: any) {
      if (e.code === ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE) {
        // For SECRET_MANAGER without vault, return registry capabilities as fallback, not fake success
        const registryEntry = this.registry.getVenue(input.venue);
        if (registryEntry) {
          return {
            venue: input.venue,
            environment: input.environment,
            capabilities: registryEntry.supportedCapabilities,
            supportedOrderTypes: registryEntry.supportedOrderTypes as any,
            supportedEnvironments: registryEntry.supportedEnvironments,
            apiVersion: registryEntry.apiVersion,
            restAvailable: registryEntry.restAvailable,
            websocketAvailable: registryEntry.websocketAvailable,
            rateLimitModel: registryEntry.rateLimitModel,
            authenticationModel: registryEntry.authenticationModel,
            symbolFormat: registryEntry.symbolFormat,
            timestamp: new Date().toISOString(),
          };
        }
      }
      throw e;
    }

    const context: ExchangeProviderContext = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      isSandbox,
      credentials: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    try {
      const discovery = await provider.getCapabilities(context);
      return discovery;
    } catch (e: any) {
      // On failure, fallback to registry safe metadata, not fake
      const registryEntry = this.registry.getVenue(input.venue);
      if (registryEntry) {
        this.logger.warn(`Capability discovery failed, using registry fallback tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} error=${e.message}`);
        return {
          venue: input.venue,
          environment: input.environment,
          capabilities: registryEntry.supportedCapabilities,
          supportedOrderTypes: registryEntry.supportedOrderTypes as any,
          supportedEnvironments: registryEntry.supportedEnvironments,
          apiVersion: registryEntry.apiVersion,
          restAvailable: registryEntry.restAvailable,
          websocketAvailable: registryEntry.websocketAvailable,
          rateLimitModel: registryEntry.rateLimitModel,
          authenticationModel: registryEntry.authenticationModel,
          symbolFormat: registryEntry.symbolFormat,
          timestamp: new Date().toISOString(),
        };
      }
      throw e;
    }
  }

  async checkServerTime(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<{ driftMs: number; serverTimeMicros: string; localTimeMicros: string }> {
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    const provider = this.providerFactory.getProvider(input.venue, input.environment);

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch {
      // Server time can be fetched without auth for some venues - try with empty credentials
      credentials = { apiKey: '', apiSecret: '' } as any;
    }

    const context: ExchangeProviderContext = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      isSandbox,
      credentials: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: (credentials as any).passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    const serverTime = await provider.getServerTime(context);
    return { driftMs: serverTime.driftMs, serverTimeMicros: serverTime.serverTimeMicros, localTimeMicros: serverTime.localTimeMicros };
  }
}
