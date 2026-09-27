/**
 * Provider Policy Service
 * Resolves provider policy, allowed providers, environment restrictions,
 * timeout/retry policy, supported operations, fail-closed rules,
 * webhook requirements, and production-only restrictions from existing configuration.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderState,
  PRODUCTION_REQUIRED_CAPABILITIES,
} from './provider.types';

export interface ProviderPolicy {
  domain: ProviderDomain;
  provider: ProviderName;
  enabled: boolean;
  environment: string;
  allowedEnvironments: string[];
  baseUrl?: string;
  timeoutMs: number;
  retryPolicy: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableErrors: string[];
  };
  rateLimitPolicy: {
    maxRequestsPerSecond: number;
    burstLimit: number;
    respectProviderHeaders: boolean;
  };
  webhookPolicy: {
    requiresSignature: boolean;
    requiresTimestamp: boolean;
    maxAgeSeconds: number;
    replayProtectionEnabled: boolean;
  };
  capabilities: ProviderCapability[];
  healthPolicy: {
    checkIntervalMs: number;
    timeoutMs: number;
    failureThreshold: number;
  };
  failClosed: boolean;
  productionOnly: boolean;
}

export interface EnvironmentProviderPolicy {
  environment: string;
  allowedProviders: ProviderName[];
  blockedProviders: ProviderName[];
  requireSecretManager: boolean;
  requireWebhookSignature: boolean;
  allowSandboxInProduction: boolean;
}

@Injectable()
export class ProviderPolicyService {
  private readonly logger = new Logger(ProviderPolicyService.name);

  private readonly policies: Record<string, ProviderPolicy> = {
    [`${ProviderDomain.PAYMENT}_${ProviderName.STRIPE}`]: {
      domain: ProviderDomain.PAYMENT,
      provider: ProviderName.STRIPE,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.stripe.com',
      timeoutMs: 30000,
      retryPolicy: {
        maxRetries: 2,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 10,
        burstLimit: 20,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: true,
        requiresTimestamp: true,
        maxAgeSeconds: 300,
        replayProtectionEnabled: true,
      },
      capabilities: [ProviderCapability.PAYMENT_CREATE, ProviderCapability.PAYMENT_READ, ProviderCapability.REFUND, ProviderCapability.WEBHOOK],
      healthPolicy: {
        checkIntervalMs: 60000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.PAYMENT}_${ProviderName.NOWPAYMENTS}`]: {
      domain: ProviderDomain.PAYMENT,
      provider: ProviderName.NOWPAYMENTS,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.nowpayments.io',
      timeoutMs: 30000,
      retryPolicy: {
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 5,
        burstLimit: 10,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: true,
        requiresTimestamp: true,
        maxAgeSeconds: 600,
        replayProtectionEnabled: true,
      },
      capabilities: [ProviderCapability.PAYMENT_CREATE, ProviderCapability.PAYMENT_READ, ProviderCapability.WEBHOOK],
      healthPolicy: {
        checkIntervalMs: 60000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.EXCHANGE}_${ProviderName.BINANCE}`]: {
      domain: ProviderDomain.EXCHANGE,
      provider: ProviderName.BINANCE,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.binance.com',
      timeoutMs: 15000,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 10,
        burstLimit: 20,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: false,
        requiresTimestamp: false,
        maxAgeSeconds: 0,
        replayProtectionEnabled: false,
      },
      capabilities: [
        ProviderCapability.BALANCE_READ,
        ProviderCapability.POSITION_READ,
        ProviderCapability.ORDER_CREATE,
        ProviderCapability.ORDER_CANCEL,
        ProviderCapability.ORDER_READ,
        ProviderCapability.FILL_READ,
        ProviderCapability.SYMBOL_READ,
        ProviderCapability.ACCOUNT_HEALTH,
      ],
      healthPolicy: {
        checkIntervalMs: 30000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.EXCHANGE}_${ProviderName.BYBIT}`]: {
      domain: ProviderDomain.EXCHANGE,
      provider: ProviderName.BYBIT,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.bybit.com',
      timeoutMs: 15000,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 10,
        burstLimit: 20,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: false,
        requiresTimestamp: false,
        maxAgeSeconds: 0,
        replayProtectionEnabled: false,
      },
      capabilities: [
        ProviderCapability.BALANCE_READ,
        ProviderCapability.POSITION_READ,
        ProviderCapability.ORDER_CREATE,
        ProviderCapability.ORDER_CANCEL,
        ProviderCapability.ORDER_READ,
        ProviderCapability.FILL_READ,
        ProviderCapability.SYMBOL_READ,
        ProviderCapability.ACCOUNT_HEALTH,
      ],
      healthPolicy: {
        checkIntervalMs: 30000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.EXCHANGE}_${ProviderName.OKX}`]: {
      domain: ProviderDomain.EXCHANGE,
      provider: ProviderName.OKX,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://www.okx.com',
      timeoutMs: 15000,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 10,
        burstLimit: 20,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: false,
        requiresTimestamp: false,
        maxAgeSeconds: 0,
        replayProtectionEnabled: false,
      },
      capabilities: [
        ProviderCapability.BALANCE_READ,
        ProviderCapability.POSITION_READ,
        ProviderCapability.ORDER_CREATE,
        ProviderCapability.ORDER_CANCEL,
        ProviderCapability.ORDER_READ,
        ProviderCapability.FILL_READ,
        ProviderCapability.SYMBOL_READ,
        ProviderCapability.ACCOUNT_HEALTH,
      ],
      healthPolicy: {
        checkIntervalMs: 30000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.EXCHANGE}_${ProviderName.KRAKEN}`]: {
      domain: ProviderDomain.EXCHANGE,
      provider: ProviderName.KRAKEN,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.kraken.com',
      timeoutMs: 15000,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 5,
        burstLimit: 10,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: false,
        requiresTimestamp: false,
        maxAgeSeconds: 0,
        replayProtectionEnabled: false,
      },
      capabilities: [
        ProviderCapability.BALANCE_READ,
        ProviderCapability.ORDER_CREATE,
        ProviderCapability.ORDER_CANCEL,
        ProviderCapability.ORDER_READ,
        ProviderCapability.FILL_READ,
        ProviderCapability.SYMBOL_READ,
        ProviderCapability.ACCOUNT_HEALTH,
      ],
      healthPolicy: {
        checkIntervalMs: 30000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
    [`${ProviderDomain.EXCHANGE}_${ProviderName.COINBASE}`]: {
      domain: ProviderDomain.EXCHANGE,
      provider: ProviderName.COINBASE,
      enabled: true,
      environment: process.env.NODE_ENV || 'development',
      allowedEnvironments: ['development', 'staging', 'production'],
      baseUrl: 'https://api.coinbase.com',
      timeoutMs: 15000,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'],
      },
      rateLimitPolicy: {
        maxRequestsPerSecond: 5,
        burstLimit: 10,
        respectProviderHeaders: true,
      },
      webhookPolicy: {
        requiresSignature: false,
        requiresTimestamp: false,
        maxAgeSeconds: 0,
        replayProtectionEnabled: false,
      },
      capabilities: [ProviderCapability.BALANCE_READ, ProviderCapability.ORDER_READ, ProviderCapability.SYMBOL_READ, ProviderCapability.ACCOUNT_HEALTH],
      healthPolicy: {
        checkIntervalMs: 30000,
        timeoutMs: 5000,
        failureThreshold: 3,
      },
      failClosed: true,
      productionOnly: false,
    },
  };

  private readonly environmentPolicies: Record<string, EnvironmentProviderPolicy> = {
    development: {
      environment: 'development',
      allowedProviders: Object.values(ProviderName),
      blockedProviders: [],
      requireSecretManager: false,
      requireWebhookSignature: false,
      allowSandboxInProduction: true,
    },
    staging: {
      environment: 'staging',
      allowedProviders: Object.values(ProviderName),
      blockedProviders: [],
      requireSecretManager: false,
      requireWebhookSignature: true,
      allowSandboxInProduction: true,
    },
    production: {
      environment: 'production',
      allowedProviders: Object.values(ProviderName),
      blockedProviders: [],
      requireSecretManager: true,
      requireWebhookSignature: true,
      allowSandboxInProduction: false,
    },
  };

  getPolicy(domain: ProviderDomain, provider: ProviderName): ProviderPolicy | null {
    const key = `${domain}_${provider}`;
    return this.policies[key] || null;
  }

  getPolicyForProvider(provider: ProviderName): ProviderPolicy | null {
    for (const policy of Object.values(this.policies)) {
      if (policy.provider === provider) return policy;
    }
    return null;
  }

  getAllowedProviders(environment: string, domain: ProviderDomain): ProviderName[] {
    const envPolicy = this.environmentPolicies[environment] || this.environmentPolicies['development'];
    return Object.values(this.policies)
      .filter((p) => p.domain === domain && p.enabled && envPolicy.allowedProviders.includes(p.provider))
      .map((p) => p.provider);
  }

  isProviderAllowed(provider: ProviderName, environment: string): boolean {
    const envPolicy = this.environmentPolicies[environment] || this.environmentPolicies['development'];
    return !envPolicy.blockedProviders.includes(provider) && envPolicy.allowedProviders.includes(provider);
  }

  getTimeout(domain: ProviderDomain, provider: ProviderName): number {
    const policy = this.getPolicy(domain, provider);
    return policy?.timeoutMs || 15000;
  }

  getRetryPolicy(domain: ProviderDomain, provider: ProviderName) {
    const policy = this.getPolicy(domain, provider);
    return (
      policy?.retryPolicy || {
        maxRetries: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT'],
      }
    );
  }

  isProduction(environment: string): boolean {
    return environment === 'production';
  }

  getRequiredCapabilities(domain: ProviderDomain): ProviderCapability[] {
    return PRODUCTION_REQUIRED_CAPABILITIES[domain] || [];
  }

  validateEnvironmentBinding(environment: string, isSandbox: boolean, provider: ProviderName): { valid: boolean; reason?: string } {
    const envPolicy = this.environmentPolicies[environment];
    if (!envPolicy) return { valid: true };
    if (environment === 'production' && isSandbox && !envPolicy.allowSandboxInProduction) {
      return { valid: false, reason: `Sandbox provider ${provider} not allowed in production` };
    }
    return { valid: true };
  }

  getProviderState(provider: ProviderName, isConfigured: boolean, isEnabled: boolean): ProviderState {
    if (!isConfigured) return ProviderState.NOT_CONFIGURED;
    if (!isEnabled) return ProviderState.DISABLED;
    return ProviderState.ENABLED;
  }
}
