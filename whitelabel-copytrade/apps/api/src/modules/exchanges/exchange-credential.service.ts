import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import { ExchangeVenue, ExchangeEnvironment, maskApiKey, sanitizeExchangeMetadata } from './exchange.types';
import { ErrorCode } from '@wlct/shared-types';
import { AppException } from '../../common/errors/app.exception';
import { ExchangeProviderError, ExchangeProviderErrorCode } from './exchange-provider.interface';
import { EXCHANGE_SECRET_STORE, SecretStore, SecretStoreError, createSecretStoreFromEnv } from './secret-store';

export interface CreateCredentialInput {
  tenantId: string;
  userId: string | null;
  accountId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  credentialSource: 'ENVELOPE_DB' | 'SECRET_MANAGER' | 'ENVIRONMENT';
  credentialRef?: string | null;
}

export interface CredentialReference {
  accountId: string;
  tenantId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  credentialSource: string;
  credentialRef: string | null;
  apiKeyLastFour: string;
  apiKeyBlindIndex: string;
  createdAt: string;
  rotatedAt: string | null;
}

export interface RotatedCredential {
  accountId: string;
  tenantId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  credentialSource: string;
  credentialRef: string | null;
  apiKeyLastFour: string;
  apiKeyBlindIndex: string;
  rotatedAt: string;
}

/**
 * Secure credential-reference lifecycle: create/link, rotate, revoke, validate, environment binding, and access through existing secret-manager/vault abstraction.
 * Critical: passes secret material only to secure provider/vault boundary when necessary.
 * Do not persist plaintext secret, return secret after creation, log secret, or send secret to frontend/mobile.
 * If no secure credential provider is configured, return explicit configuration error.
 */
@Injectable()
export class ExchangeCredentialService {
  private readonly logger = new Logger(ExchangeCredentialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
    // Phase 3: optional override (tests, or a DI-managed store). When absent
    // the store is built from the environment on first use.
    @Optional() @Inject(EXCHANGE_SECRET_STORE) private readonly secretStoreOverride?: SecretStore | null,
  ) {}

  private cachedSecretStore: SecretStore | null | undefined;

  private getAad(tenantId: string, accountId: string): string {
    return `trading_account:${tenantId}:${accountId}`;
  }

  private validateNoWithdrawalPermission(permissions: string[]): void {
    const hasWithdrawal = permissions.some((p) => p.toLowerCase().includes('withdraw'));
    if (hasWithdrawal) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.WITHDRAWAL_NOT_ALLOWED,
        'Withdrawal permission detected - rejected per security policy',
        ExchangeVenue.BINANCE,
        ExchangeEnvironment.LIVE,
        false,
      );
    }
  }

  /**
   * The configured secret manager, or an explicit PROVIDER_UNAVAILABLE error.
   * The message keeps the literal "SECRET_MANAGER" because
   * ExchangeConnectivityService keys its degraded (never fake-success) path
   * on it.
   */
  private resolveSecretStore(venue: ExchangeVenue, environment: ExchangeEnvironment): SecretStore {
    if (this.cachedSecretStore === undefined) {
      if (this.secretStoreOverride !== undefined && this.secretStoreOverride !== null) {
        this.cachedSecretStore = this.secretStoreOverride;
      } else {
        try {
          this.cachedSecretStore = createSecretStoreFromEnv(process.env);
        } catch (error) {
          throw new ExchangeProviderError(
            ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
            `SECRET_MANAGER misconfigured: ${(error as Error).message}`,
            venue,
            environment,
            false,
          );
        }
      }
    }
    if (!this.cachedSecretStore) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        'Secure credential provider (vault/secret manager) is not configured. Set VAULT_ADDR + VAULT_TOKEN (SECRET_MANAGER_PROVIDER=vault) or AWS_SECRETS_MANAGER_ENABLED=true + AWS credentials (SECRET_MANAGER_PROVIDER=aws) to use the SECRET_MANAGER source. Use ENVELOPE_DB for envelope-encrypted storage.',
        venue,
        environment,
        false,
      );
    }
    return this.cachedSecretStore;
  }

  /** Map a store failure onto the provider error vocabulary without ever
   * including secret material (SecretStoreError messages never carry it). */
  private secretStoreFailure(error: unknown, venue: ExchangeVenue, environment: ExchangeEnvironment, what: string): ExchangeProviderError {
    if (error instanceof ExchangeProviderError) return error;
    if (error instanceof SecretStoreError) {
      const code =
        error.code === 'NOT_FOUND' || error.code === 'DENIED' || error.code === 'MALFORMED'
          ? ExchangeProviderErrorCode.AUTH_FAILED
          : ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE;
      return new ExchangeProviderError(code, `SECRET_MANAGER ${what} failed: ${error.message}`, venue, environment, error.retryable);
    }
    return new ExchangeProviderError(
      ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
      `SECRET_MANAGER ${what} failed: ${(error as Error)?.name ?? 'Error'}`,
      venue,
      environment,
      true,
    );
  }

  async createCredentialReference(input: CreateCredentialInput): Promise<CredentialReference> {
    // Validate inputs - never log secrets
    if (!input.apiKey || !input.apiSecret) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.INVALID_CREDENTIALS,
        'API key and secret are required',
        input.venue,
        input.environment,
        false,
      );
    }

    if (input.apiKey.length < 8 || input.apiSecret.length < 8) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.INVALID_CREDENTIALS,
        'API key and secret must be at least 8 characters',
        input.venue,
        input.environment,
        false,
      );
    }

    // Environment binding validation - LIVE credential must never be used against testnet URL
    if (input.environment === ExchangeEnvironment.LIVE && input.credentialRef?.toLowerCase().includes('testnet')) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        'LIVE credential reference must not contain testnet URL/path',
        input.venue,
        input.environment,
        false,
      );
    }

    const apiKeyLastFour = input.apiKey.slice(-4);
    const apiKeyBlindIndex = this.crypto.blindIndex(input.apiKey);
    const aad = this.getAad(input.tenantId, input.accountId);

    let credentialRef = input.credentialRef || null;
    let apiKeyCiphertext: string | null = null;
    let apiSecretCiphertext: string | null = null;
    let passphraseCiphertext: string | null = null;
    let encryptedDataKey: string | null = null;
    let encryptionKeyId: string | null = null;

    if (input.credentialSource === 'SECRET_MANAGER') {
      const store = this.resolveSecretStore(input.venue, input.environment);

      // The reference is always the store's deterministic path for THIS
      // tenant/account (Vault's default matches the execution engine's
      // EXECUTION_VAULT_PATH_TEMPLATE). It is never taken from the request: a
      // caller-chosen path would let one customer overwrite - and, on revoke,
      // destroy - the secret of an account in another tenant.
      let expectedRef: string;
      try {
        expectedRef = store.referenceFor({
          tenantId: input.tenantId,
          accountId: input.accountId,
          venue: input.venue,
          environment: input.environment,
        });
      } catch (error) {
        throw this.secretStoreFailure(error, input.venue, input.environment, 'reference');
      }
      if (credentialRef && credentialRef !== expectedRef) {
        throw new AppException({
          code: ErrorCode.BAD_REQUEST,
          message: 'credentialRef cannot be chosen by the client; omit it and the platform assigns the secret path.',
        });
      }
      credentialRef = expectedRef;

      // The secret material goes to the secret manager and nowhere else: the
      // database keeps only the reference, last four and blind index. If the
      // write fails, nothing is persisted - a reference to a secret that was
      // never stored would be a credential that fails at first use.
      try {
        await store.write(credentialRef, {
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          ...(input.passphrase ? { passphrase: input.passphrase } : {}),
          environment: input.environment,
          venue: input.venue,
        });
      } catch (error) {
        this.logger.error(`SECRET_MANAGER write failed tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} env=${input.environment} store=${store.kind} error=${(error as Error)?.name}`);
        throw this.secretStoreFailure(error, input.venue, input.environment, 'write');
      }
      this.logger.log(`Credential stored via SECRET_MANAGER (${store.kind}) tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} env=${input.environment} ref=${credentialRef}`);
      // Ciphertext columns remain null for SECRET_MANAGER per schema comment
    } else if (input.credentialSource === 'ENVELOPE_DB') {
      // Envelope encryption - secret never in plaintext in DB
      try {
        const sealedKey = this.crypto.encrypt(input.apiKey, aad);
        const sealedSecret = this.crypto.encrypt(input.apiSecret, aad);
        apiKeyCiphertext = JSON.stringify(sealedKey);
        apiSecretCiphertext = JSON.stringify(sealedSecret);
        encryptedDataKey = (sealedKey as any).wrappedKey || (sealedSecret as any).wrappedKey || 'envelope';
        encryptionKeyId = (sealedKey as any).keyId || 'active';

        if (input.passphrase) {
          const sealedPassphrase = this.crypto.encrypt(input.passphrase, aad);
          passphraseCiphertext = JSON.stringify(sealedPassphrase);
        }

        this.logger.log(`Credential sealed via ENVELOPE_DB tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} env=${input.environment}`);
      } catch (e: any) {
        this.logger.error(`Failed to encrypt credential tenant=${input.tenantId} account=${input.accountId} error=${e.name}`);
        throw new ExchangeProviderError(
          ExchangeProviderErrorCode.SERVER_ERROR,
          'Failed to encrypt credential material',
          input.venue,
          input.environment,
          false,
        );
      }
    } else if (input.credentialSource === 'ENVIRONMENT') {
      // Development only - does not scale past one tenant and cannot be rotated per customer
      if (process.env.NODE_ENV === 'production') {
        throw new AppException({
          code: ErrorCode.BAD_REQUEST,
          message: 'The ENVIRONMENT credential source is not available in production.',
        });
      }
      this.logger.warn(`Using ENVIRONMENT credential source - development only tenant=${input.tenantId} account=${input.accountId}`);
      credentialRef = `env:${input.venue}_${input.environment}_CREDENTIALS`;
      // No DB ciphertext for ENVIRONMENT
    } else {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        `Unsupported credential source ${input.credentialSource}`,
        input.venue,
        input.environment,
        false,
      );
    }

    // Persist to TradingAccount - never log secrets
    try {
      const now = new Date();
      await this.prisma.tradingAccount.update({
        where: { id: input.accountId },
        data: {
          apiKeyCiphertext,
          apiSecretCiphertext,
          passphraseCiphertext,
          encryptedDataKey,
          encryptionKeyId,
          apiKeyBlindIndex,
          apiKeyLastFour,
          credentialSource: input.credentialSource as any,
          credentialRef,
          credentialRotatedAt: now,
          updatedAt: now,
        },
      });
    } catch (e: any) {
      // The blind index is unique per tenant: the same API key is already
      // connected here. That is the caller's input, not a venue failure.
      if (e?.code === 'P2002') {
        throw new AppException({
          code: ErrorCode.CONFLICT,
          message: 'This API key is already connected in this organisation.',
        });
      }
      this.logger.error(`Failed to persist credential reference tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.SERVER_ERROR,
        'Failed to persist credential reference',
        input.venue,
        input.environment,
        false,
      );
    }

    return {
      accountId: input.accountId,
      tenantId: input.tenantId,
      venue: input.venue,
      environment: input.environment,
      credentialSource: input.credentialSource,
      credentialRef,
      apiKeyLastFour,
      apiKeyBlindIndex,
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
  }

  async rotateCredential(input: CreateCredentialInput & { oldApiKeyBlindIndex?: string }): Promise<RotatedCredential> {
    // Rotation invalidates old reference according to policy
    // Validate old reference exists and belongs to same tenant/account
    const existing = await this.prisma.tradingAccount.findFirst({
      where: { id: input.accountId, tenantId: input.tenantId },
      select: { id: true, apiKeyBlindIndex: true, credentialRef: true, credentialSource: true },
    });

    if (!existing) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        'Account not found for rotation',
        input.venue,
        input.environment,
        false,
      );
    }

    // Create new reference (this will overwrite old ciphertext)
    const newRef = await this.createCredentialReference(input);

    // Old blind index is now invalid - log rotation without secrets
    this.logger.log(`Credential rotated tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} oldBlindIndex=${existing.apiKeyBlindIndex?.substring(0, 8)}... newBlindIndex=${newRef.apiKeyBlindIndex.substring(0, 8)}...`);

    return {
      accountId: newRef.accountId,
      tenantId: newRef.tenantId,
      venue: newRef.venue,
      environment: newRef.environment,
      credentialSource: newRef.credentialSource,
      credentialRef: newRef.credentialRef,
      apiKeyLastFour: newRef.apiKeyLastFour,
      apiKeyBlindIndex: newRef.apiKeyBlindIndex,
      rotatedAt: new Date().toISOString(),
    };
  }

  async revokeCredential(tenantId: string, accountId: string, venue: ExchangeVenue, environment: ExchangeEnvironment): Promise<void> {
    // SECRET_MANAGER: destroy the stored secret too (best effort, logged). The
    // account is disabled and its reference cleared either way, so a failed
    // destroy leaves an orphaned secret, never a usable credential.
    try {
      const current = await this.prisma.tradingAccount.findFirst({
        where: { id: accountId, tenantId },
        select: { credentialSource: true, credentialRef: true },
      });
      if (current?.credentialSource === 'SECRET_MANAGER' && current.credentialRef) {
        const store = this.resolveSecretStore(venue, environment);
        await store.destroy(current.credentialRef);
      }
    } catch (e: any) {
      this.logger.warn(`SECRET_MANAGER destroy skipped tenant=${tenantId} account=${accountId} error=${e?.name ?? 'Error'}: ${e?.message ?? ''}`);
    }
    try {
      await this.prisma.tradingAccount.update({
        where: { id: accountId },
        data: {
          apiKeyCiphertext: null,
          apiSecretCiphertext: null,
          passphraseCiphertext: null,
          encryptedDataKey: null,
          credentialRef: null,
          status: 'DISABLED' as any,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`Credential revoked tenant=${tenantId} account=${accountId} venue=${venue} env=${environment}`);
    } catch (e: any) {
      this.logger.error(`Failed to revoke credential tenant=${tenantId} account=${accountId} error=${e.message}`);
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.SERVER_ERROR,
        'Failed to revoke credential',
        venue,
        environment,
        false,
      );
    }
  }

  async validateCredentialReference(tenantId: string, accountId: string): Promise<{ valid: boolean; source: string; ref: string | null; lastFour: string | null }> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { credentialSource: true, credentialRef: true, apiKeyLastFour: true, apiKeyCiphertext: true, apiSecretCiphertext: true },
    });

    if (!account) {
      return { valid: false, source: 'UNKNOWN', ref: null, lastFour: null };
    }

    if (account.credentialSource === 'SECRET_MANAGER') {
      if (!account.credentialRef) {
        return { valid: false, source: account.credentialSource, ref: null, lastFour: account.apiKeyLastFour };
      }
      // Existence check against the secret manager (metadata only - the secret
      // itself is not fetched). Unconfigured or unreachable store = not valid.
      try {
        const store = this.resolveSecretStore(ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE);
        const exists = await store.exists(account.credentialRef);
        return { valid: exists, source: account.credentialSource, ref: account.credentialRef, lastFour: account.apiKeyLastFour };
      } catch (e: any) {
        this.logger.warn(`SECRET_MANAGER existence check failed tenant=${tenantId} account=${accountId} error=${e?.name ?? 'Error'}`);
        return { valid: false, source: account.credentialSource, ref: account.credentialRef, lastFour: account.apiKeyLastFour };
      }
    }

    if (account.credentialSource === 'ENVELOPE_DB') {
      if (!account.apiKeyCiphertext || !account.apiSecretCiphertext) {
        return { valid: false, source: account.credentialSource, ref: account.credentialRef, lastFour: account.apiKeyLastFour };
      }
      return { valid: true, source: account.credentialSource, ref: account.credentialRef, lastFour: account.apiKeyLastFour };
    }

    return { valid: !!account.credentialRef, source: account.credentialSource, ref: account.credentialRef, lastFour: account.apiKeyLastFour };
  }

  async getDecryptedCredentialsForProvider(
    tenantId: string,
    accountId: string,
    venue: ExchangeVenue,
    environment: ExchangeEnvironment,
  ): Promise<{ apiKey: string; apiSecret: string; passphrase?: string }> {
    // This method is backend-only, never exposed via API
    // Used only by provider adapters to authenticate with exchange
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { apiKeyCiphertext: true, apiSecretCiphertext: true, passphraseCiphertext: true, credentialSource: true, credentialRef: true },
    });

    if (!account) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, 'Account not found', venue, environment, false);
    }

    if (account.credentialSource === 'SECRET_MANAGER') {
      if (!account.credentialRef) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, 'SECRET_MANAGER credential has no reference', venue, environment, false);
      }
      const store = this.resolveSecretStore(venue, environment);
      let secret;
      try {
        secret = await store.read(account.credentialRef);
      } catch (error) {
        this.logger.error(`SECRET_MANAGER read failed tenant=${tenantId} account=${accountId} store=${store.kind} error=${(error as Error)?.name}`);
        throw this.secretStoreFailure(error, venue, environment, 'read');
      }
      // Environment binding: a secret written for TESTNET must never
      // authenticate a LIVE call (and vice versa). Secrets written before the
      // binding existed report UNKNOWN and are refused for LIVE.
      if (secret.environment !== environment && !(secret.environment === 'UNKNOWN' && environment !== ExchangeEnvironment.LIVE)) {
        throw new ExchangeProviderError(
          ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
          `SECRET_MANAGER secret is bound to ${secret.environment}, requested ${environment}`,
          venue,
          environment,
          false,
        );
      }
      return {
        apiKey: secret.apiKey,
        apiSecret: secret.apiSecret,
        ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
      };
    }

    if (account.credentialSource === 'ENVELOPE_DB') {
      if (!account.apiKeyCiphertext || !account.apiSecretCiphertext) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, 'Missing encrypted credentials', venue, environment, false);
      }
      try {
        const aad = this.getAad(tenantId, accountId);
        const keyPayload = JSON.parse(account.apiKeyCiphertext);
        const secretPayload = JSON.parse(account.apiSecretCiphertext);
        const apiKey = this.crypto.decrypt(keyPayload, aad);
        const apiSecret = this.crypto.decrypt(secretPayload, aad);
        let passphrase: string | undefined;
        if (account.passphraseCiphertext) {
          const passPayload = JSON.parse(account.passphraseCiphertext);
          passphrase = this.crypto.decrypt(passPayload, aad);
        }
        return { apiKey, apiSecret, passphrase };
      } catch (e: any) {
        this.logger.error(`Failed to decrypt credentials tenant=${tenantId} account=${accountId} error=${e.name}`);
        throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, 'Failed to decrypt credentials', venue, environment, false);
      }
    }

    throw new ExchangeProviderError(
      ExchangeProviderErrorCode.NOT_SUPPORTED,
      `Unsupported credential source ${account.credentialSource}`,
      venue,
      environment,
      false,
    );
  }

  maskApiKey(apiKey: string): string {
    return maskApiKey(apiKey);
  }
}
