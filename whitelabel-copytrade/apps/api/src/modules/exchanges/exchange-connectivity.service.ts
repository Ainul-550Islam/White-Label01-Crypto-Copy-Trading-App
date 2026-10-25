// # Responsibility: perform read-only authenticated, environment-bound provider checks; required durable health writes must succeed and registry metadata never replaces failed discovery.
import { Injectable, Logger } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeConnectionState, type ExchangeConnectivityResult, type ExchangeCapabilityDiscovery } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeProviderError, ExchangeProviderErrorCode, type ExchangeProviderContext, type ExchangeProvider } from './exchange-provider.interface';
import { ExchangeAuditService } from './exchange-audit.service';

interface ConnectivityInput { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }
type ProviderCredentials = Awaited<ReturnType<ExchangeCredentialService['getDecryptedCredentialsForProvider']>>;

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

  async checkConnectivity(input: ConnectivityInput): Promise<ExchangeConnectivityResult> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    try { this.providerFactory.validateEnvironmentBinding(input.venue, input.environment, isSandbox); }
    catch { return this.failed(input, start, ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH, 'Invalid provider environment binding', false); }
    let provider: ExchangeProvider;
    try { provider = this.providerFactory.getProvider(input.venue, input.environment); }
    catch (error) { return this.failed(input, start, this.code(error, ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE), 'Provider unavailable', false); }
    let credentials: ProviderCredentials;
    try { credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment); }
    catch (error) {
      // The credential service wraps recognized SecretStore errors with sanitized cause/status diagnostics.
      if (error instanceof ExchangeProviderError && error.code === ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE && error.message.includes('SECRET_MANAGER')) {
        return this.failed(input, start, ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, `Secret manager unavailable: ${error.message}`, true, ExchangeConnectionState.FAILED);
      }
      return this.failed(input, start, ExchangeProviderErrorCode.AUTH_FAILED,
        error instanceof ExchangeProviderError ? error.message : 'Credential retrieval failed', false);
    }
    try {
      await this.assertAccountBinding(input);
      const result = await provider.testConnectivity(this.context(input, credentials));
      if (result.environment !== input.environment || result.isSimulated !== isSandbox
        || (result.connected && (result.state !== ExchangeConnectionState.CONNECTED || result.failureCode !== null || result.degraded))) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH, 'Provider connectivity evidence identity/state mismatch', input.venue, input.environment);
      }
      if (result.connected) {
        const updated = await this.accountRepo.updateHealth(input.accountId, input.tenantId, {
          lastVerifiedAt: new Date(), consecutiveFailures: 0, lastFailureCode: null,
        });
        if (!updated) throw new ExchangeProviderError(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, 'Required health persistence unavailable', input.venue, input.environment);
      } else {
        const persisted = await this.accountRepo.recordConnectivityFailure(input.accountId, input.tenantId, result.failureCode ?? ExchangeProviderErrorCode.UNKNOWN);
        if (!persisted) throw new ExchangeProviderError(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, 'Required failure persistence unavailable', input.venue, input.environment);
      }
      return { ...result, latencyMs: Date.now() - start, isSimulated: isSandbox, environment: input.environment };
    } catch (error) {
      const code = this.code(error, ExchangeProviderErrorCode.UNKNOWN);
      const authFailed = code === ExchangeProviderErrorCode.AUTH_FAILED || code === ExchangeProviderErrorCode.INVALID_CREDENTIALS;
      try { await this.accountRepo.recordConnectivityFailure(input.accountId, input.tenantId, code); }
      catch { this.logger.warn(`Required connectivity failure persistence unavailable tenant=${input.tenantId} account=${input.accountId}`); }
      this.logger.warn(`Connectivity check failed tenant=${input.tenantId} account=${input.accountId} code=${code}`);
      await this.auditService.record({ tenantId: input.tenantId, accountId: input.accountId, venue: input.venue,
        environment: input.environment, event: 'EXCHANGE_HEALTH_CHANGED', result: 'FAILURE', safeMetadata: { failureCode: code } });
      return this.failed(input, start, code, 'Authenticated connectivity check or required durable evidence failed', !authFailed,
        authFailed ? ExchangeConnectionState.FAILED : ExchangeConnectionState.DEGRADED);
    }
  }

  async discoverCapabilities(input: ConnectivityInput): Promise<ExchangeCapabilityDiscovery> {
    const registryEntry = this.registry.getVenue(input.venue);
    if (!registryEntry || !registryEntry.supportedEnvironments.includes(input.environment)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.NOT_SUPPORTED, 'Venue/environment unavailable for capability discovery', input.venue, input.environment);
    }
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    this.providerFactory.validateEnvironmentBinding(input.venue, input.environment, isSandbox);
    const provider = this.providerFactory.getProvider(input.venue, input.environment);
    const credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    await this.assertAccountBinding(input);
    const discovery = await provider.getCapabilities(this.context(input, credentials));
    if (discovery.venue !== input.venue || discovery.environment !== input.environment
      || !discovery.supportedEnvironments.includes(input.environment) || !Number.isFinite(new Date(discovery.timestamp).getTime())) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH, 'Provider capability evidence identity mismatch', input.venue, input.environment);
    }
    // Static supported capabilities remain available through the registry endpoint, not disguised as this account's authenticated discovery.
    return discovery;
  }

  async checkServerTime(input: ConnectivityInput): Promise<{ driftMs: number; serverTimeMicros: string; localTimeMicros: string }> {
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    this.providerFactory.validateEnvironmentBinding(input.venue, input.environment, isSandbox);
    const provider = this.providerFactory.getProvider(input.venue, input.environment);
    const credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    await this.assertAccountBinding(input);
    const serverTime = await provider.getServerTime(this.context(input, credentials));
    if (!Number.isFinite(serverTime.driftMs) || !/^\d+$/.test(serverTime.serverTimeMicros) || !/^\d+$/.test(serverTime.localTimeMicros)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.CLOCK_DRIFT, 'Invalid provider time observation', input.venue, input.environment);
    }
    return serverTime;
  }

  private async assertAccountBinding(input: ConnectivityInput): Promise<void> {
    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!account || account.tenantId !== input.tenantId || account.venue !== input.venue || account.environment !== input.environment
      || account.isSandbox !== (input.environment !== ExchangeEnvironment.LIVE)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH, 'Account/tenant/venue/environment binding unavailable', input.venue, input.environment);
    }
  }

  private context(input: ConnectivityInput, credentials: ProviderCredentials): ExchangeProviderContext {
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;
    return { ...input, isSandbox, credentials: { ...credentials, environment: input.environment, isSandbox }, credentialRef: null };
  }

  private code(error: unknown, fallback: ExchangeProviderErrorCode): ExchangeProviderErrorCode {
    return error instanceof ExchangeProviderError ? error.code : fallback;
  }

  private failed(input: ConnectivityInput, start: number, failureCode: ExchangeProviderErrorCode, failureReason: string,
    degraded: boolean, state: ExchangeConnectionState = ExchangeConnectionState.FAILED): ExchangeConnectivityResult {
    return { connected: false, degraded, state, latencyMs: Date.now() - start, serverTimeMicros: null, clockDriftMs: null,
      capabilities: [], failureCode, failureReason, isSimulated: input.environment !== ExchangeEnvironment.LIVE, environment: input.environment };
  }
}
