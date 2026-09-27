/**
 * Environment Validator Service
 * Validates required production configuration, secret references, URLs,
 * provider configuration, database settings, Redis, queue, security settings
 * without exposing secret values.
 */

import { EnvironmentName } from './production.types';
import { EnvironmentPolicyService } from './environment-policy.service';

export interface ValidationResult {
  valid: boolean;
  environment: EnvironmentName;
  missingVariables: string[];
  forbiddenVariablesPresent: string[];
  forbiddenSettingsViolations: Array<{ key: string; value: string; reason: string }>;
  urlValidation: Array<{ key: string; valid: boolean; reason?: string }>;
  providerValidation: Array<{ provider: string; configured: boolean; reason?: string }>;
  errors: string[];
  warnings: string[];
  checkedAt: string;
  correlationId: string;
}

export class EnvironmentValidatorService {
  private readonly policyService: EnvironmentPolicyService;

  constructor(policyService?: EnvironmentPolicyService) {
    this.policyService = policyService || new EnvironmentPolicyService();
  }

  validate(
    environment: EnvironmentName,
    envVars: Record<string, string | undefined>,
    correlationId: string,
  ): ValidationResult {
    const policy = this.policyService.getPolicy(environment);
    const missingVariables: string[] = [];
    const forbiddenVariablesPresent: string[] = [];
    const forbiddenSettingsViolations: Array<{ key: string; value: string; reason: string }> = [];
    const urlValidation: Array<{ key: string; valid: boolean; reason?: string }> = [];
    const providerValidation: Array<{ provider: string; configured: boolean; reason?: string }> = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const required of policy.requiredVariables) {
      const value = envVars[required];
      if (!value || value.trim().length === 0) {
        missingVariables.push(required);
        errors.push(`Missing required variable: ${required}`);
      }
    }

    for (const forbidden of policy.forbiddenVariables) {
      if (envVars[forbidden] !== undefined && envVars[forbidden] !== '') {
        forbiddenVariablesPresent.push(forbidden);
        errors.push(`Forbidden variable present in ${environment}: ${forbidden}`);
      }
    }

    for (const forbiddenSetting of policy.forbiddenSettings) {
      const currentValue = envVars[forbiddenSetting.key];
      if (currentValue && forbiddenSetting.forbiddenValues.includes(currentValue)) {
        forbiddenSettingsViolations.push({
          key: forbiddenSetting.key,
          value: '***REDACTED***',
          reason: `Value '${currentValue}' is forbidden in ${environment}`,
        });
        errors.push(`Forbidden setting ${forbiddenSetting.key}=${currentValue} in ${environment}`);
      }
    }

    const urlKeys = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'TRADING_ENGINE_URL'];
    for (const urlKey of urlKeys) {
      const urlValue = envVars[urlKey];
      if (urlValue) {
        const validation = this.validateUrl(urlKey, urlValue);
        urlValidation.push(validation);
        if (!validation.valid) {
          errors.push(`Invalid URL for ${urlKey}: ${validation.reason}`);
        }
      }
    }

    const providers = [
      { key: 'S3_ACCESS_KEY_ID', provider: 'object-storage' },
      { key: 'SMTP_HOST', provider: 'email' },
      { key: 'JWT_ACCESS_SECRET', provider: 'auth' },
    ];
    for (const provider of providers) {
      const configured = !!envVars[provider.key];
      providerValidation.push({
        provider: provider.provider,
        configured,
        reason: configured ? undefined : `Missing ${provider.key}`,
      });
    }

    if (environment === EnvironmentName.PRODUCTION) {
      const jwtAccess = envVars['JWT_ACCESS_SECRET'];
      if (jwtAccess && jwtAccess.length < 32) {
        errors.push('JWT_ACCESS_SECRET must be at least 32 characters in production');
      }
      const jwtRefresh = envVars['JWT_REFRESH_SECRET'];
      if (jwtRefresh && jwtRefresh.length < 32) {
        errors.push('JWT_REFRESH_SECRET must be at least 32 characters in production');
      }
      const encKey = envVars['ENCRYPTION_KEY'];
      if (encKey && encKey.length < 16) {
        errors.push('ENCRYPTION_KEY must be at least 16 characters in production');
      }
      const dbUrl = envVars['DATABASE_URL'];
      if (dbUrl && dbUrl.includes('localhost') && environment === EnvironmentName.PRODUCTION) {
        errors.push('DATABASE_URL must not point to localhost in production');
      }
      const redisUrl = envVars['REDIS_URL'];
      if (redisUrl && redisUrl.includes('localhost') && environment === EnvironmentName.PRODUCTION) {
        warnings.push('REDIS_URL points to localhost, expected managed Redis in production');
      }
    }

    const valid = errors.length === 0 && missingVariables.length === 0 && forbiddenVariablesPresent.length === 0;

    return {
      valid,
      environment,
      missingVariables,
      forbiddenVariablesPresent,
      forbiddenSettingsViolations,
      urlValidation,
      providerValidation,
      errors,
      warnings,
      checkedAt: new Date().toISOString(),
      correlationId,
    };
  }

  private validateUrl(key: string, value: string): { key: string; valid: boolean; reason?: string } {
    try {
      if (key.includes('DATABASE_URL') || key.includes('REDIS_URL') || key.includes('REDIS')) {
        if (!value.includes('://')) {
          return { key, valid: false, reason: 'URL must include protocol' };
        }
        if (value.includes(' ') || value.includes('\n')) {
          return { key, valid: false, reason: 'URL contains whitespace' };
        }
        return { key, valid: true };
      }
      const url = new URL(value);
      if (!url.protocol || !url.host) {
        return { key, valid: false, reason: 'Invalid URL format' };
      }
      return { key, valid: true };
    } catch (e) {
      return { key, valid: false, reason: (e as Error).message.slice(0, 200) };
    }
  }

  redactValue(value: string): string {
    if (!value) return '***EMPTY***';
    if (value.length <= 4) return '***REDACTED***';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  validateSecretReferences(
    environment: EnvironmentName,
    secretRefs: Record<string, string>,
    correlationId: string,
  ): { valid: boolean; missing: string[]; errors: string[] } {
    const errors: string[] = [];
    const missing: string[] = [];
    const policy = this.policyService.getPolicy(environment);

    if (policy.securityRequirements.requireSecretManager) {
      for (const required of policy.requiredVariables) {
        const ref = secretRefs[required];
        if (!ref) {
          missing.push(required);
          errors.push(`Secret reference missing for ${required} in ${environment}, must use secret manager`);
        } else if (ref.startsWith('hardcoded:') || ref.startsWith('plaintext:')) {
          errors.push(`Secret ${required} must not be hardcoded or plaintext in ${environment}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      missing,
      errors,
    };
  }
}
