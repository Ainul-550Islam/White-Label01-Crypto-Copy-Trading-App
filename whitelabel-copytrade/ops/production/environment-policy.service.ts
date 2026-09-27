/**
 * Environment Policy Service
 * Resolves environment-specific policy for development/staging/production
 * without hardcoding secrets. All secrets come from secure secret management.
 */

import { EnvironmentName, EnvironmentPolicy, DeploymentStrategy } from './production.types';

export class EnvironmentPolicyService {
  private readonly policies: Record<EnvironmentName, EnvironmentPolicy> = {
    [EnvironmentName.DEVELOPMENT]: {
      environment: EnvironmentName.DEVELOPMENT,
      requiredVariables: [
        'DATABASE_URL',
        'REDIS_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
      ],
      forbiddenVariables: [
        'PROD_DATABASE_URL',
        'PRODUCTION_SECRET',
      ],
      forbiddenSettings: [
        { key: 'NODE_ENV', forbiddenValues: ['production'] },
      ],
      securityRequirements: {
        requireSecretManager: false,
        requireArtifactSigning: false,
        requireSbom: false,
        requireImageScan: false,
        requireMfaForApproval: false,
        minApprovalCount: 0,
      },
      deployment: {
        allowedStrategies: [DeploymentStrategy.RECREATE, DeploymentStrategy.ROLLING],
        requiresMaintenanceWindow: false,
        requiresBackupBeforeMigration: false,
        allowDestructiveMigrations: true,
        maxParallelDeployments: 3,
      },
      vulnerabilityPolicy: {
        blockOnCritical: false,
        blockOnHigh: false,
        allowedHighCount: 100,
        allowedMediumCount: 1000,
        ignoreUnfixed: true,
      },
      backupPolicy: {
        requireRecentBackupHours: 168,
        requireVerifiedBackup: false,
        retentionDays: 7,
      },
    },
    [EnvironmentName.STAGING]: {
      environment: EnvironmentName.STAGING,
      requiredVariables: [
        'DATABASE_URL',
        'DIRECT_DATABASE_URL',
        'REDIS_URL',
        'REDIS_PASSWORD',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'ENCRYPTION_KEY',
        'SESSION_COOKIE_SECRET',
      ],
      forbiddenVariables: [
        'ALLOW_DESTRUCTIVE_MIGRATION_IN_PROD',
      ],
      forbiddenSettings: [
        { key: 'EXECUTION_ENABLED', forbiddenValues: ['true'] },
        { key: 'EXECUTION_MODE', forbiddenValues: ['live'] },
      ],
      securityRequirements: {
        requireSecretManager: false,
        requireArtifactSigning: true,
        requireSbom: true,
        requireImageScan: true,
        requireMfaForApproval: false,
        minApprovalCount: 1,
      },
      deployment: {
        allowedStrategies: [DeploymentStrategy.ROLLING, DeploymentStrategy.BLUE_GREEN, DeploymentStrategy.CANARY],
        requiresMaintenanceWindow: false,
        requiresBackupBeforeMigration: true,
        allowDestructiveMigrations: false,
        maxParallelDeployments: 1,
      },
      vulnerabilityPolicy: {
        blockOnCritical: true,
        blockOnHigh: false,
        allowedHighCount: 5,
        allowedMediumCount: 50,
        ignoreUnfixed: false,
      },
      backupPolicy: {
        requireRecentBackupHours: 24,
        requireVerifiedBackup: true,
        retentionDays: 14,
      },
    },
    [EnvironmentName.PRODUCTION]: {
      environment: EnvironmentName.PRODUCTION,
      requiredVariables: [
        'DATABASE_URL',
        'DIRECT_DATABASE_URL',
        'REDIS_URL',
        'REDIS_PASSWORD',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'ENCRYPTION_KEY',
        'SESSION_COOKIE_SECRET',
        'POSTGRES_PASSWORD',
        'POSTGRES_APP_PASSWORD',
        'EXECUTION_INTERNAL_TOKEN',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_BUCKET',
      ],
      forbiddenVariables: [
        'ALLOW_DESTRUCTIVE_MIGRATION_IN_PROD',
        'SKIP_SECURITY_GATES',
        'SKIP_MIGRATION_GATE',
        'SKIP_RLS_GATE',
        'DISABLE_AUTH',
      ],
      forbiddenSettings: [
        { key: 'NODE_ENV', forbiddenValues: ['development', 'test'] },
        { key: 'EXECUTION_DRY_RUN', forbiddenValues: ['true'] },
        { key: 'EXECUTION_ENABLED', forbiddenValues: ['false'] },
        { key: 'BYPASS_SECURITY', forbiddenValues: ['true', '1'] },
        { key: 'BYPASS_COMPLIANCE', forbiddenValues: ['true', '1'] },
        { key: 'BYPASS_RISK', forbiddenValues: ['true', '1'] },
        { key: 'BYPASS_OPERATIONS', forbiddenValues: ['true', '1'] },
        { key: 'ENABLE_LIVE_TRADING_WITHOUT_APPROVAL', forbiddenValues: ['true', '1'] },
      ],
      securityRequirements: {
        requireSecretManager: true,
        requireArtifactSigning: true,
        requireSbom: true,
        requireImageScan: true,
        requireMfaForApproval: true,
        minApprovalCount: 2,
      },
      deployment: {
        allowedStrategies: [DeploymentStrategy.BLUE_GREEN, DeploymentStrategy.CANARY, DeploymentStrategy.ROLLING],
        requiresMaintenanceWindow: true,
        requiresBackupBeforeMigration: true,
        allowDestructiveMigrations: false,
        maxParallelDeployments: 1,
      },
      vulnerabilityPolicy: {
        blockOnCritical: true,
        blockOnHigh: true,
        allowedHighCount: 0,
        allowedMediumCount: 10,
        ignoreUnfixed: false,
      },
      backupPolicy: {
        requireRecentBackupHours: 6,
        requireVerifiedBackup: true,
        retentionDays: 30,
      },
    },
  };

  getPolicy(environment: EnvironmentName): EnvironmentPolicy {
    const policy = this.policies[environment];
    if (!policy) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    return policy;
  }

  resolveEnvironment(envName?: string): EnvironmentName {
    const normalized = (envName || process.env['NODE_ENV'] || 'development').toLowerCase();
    if (normalized === 'production' || normalized === 'prod') return EnvironmentName.PRODUCTION;
    if (normalized === 'staging' || normalized === 'stage') return EnvironmentName.STAGING;
    return EnvironmentName.DEVELOPMENT;
  }

  isProduction(environment: EnvironmentName): boolean {
    return environment === EnvironmentName.PRODUCTION;
  }

  validateEnvironmentBoundaries(
    source: EnvironmentName,
    target: EnvironmentName,
  ): { allowed: boolean; reason?: string } {
    if (source === EnvironmentName.PRODUCTION && target !== EnvironmentName.PRODUCTION) {
      return { allowed: false, reason: 'Production data must not flow to lower environments' };
    }
    if (source === EnvironmentName.DEVELOPMENT && target === EnvironmentName.PRODUCTION) {
      return { allowed: false, reason: 'Development builds must not deploy directly to production, must pass through staging' };
    }
    return { allowed: true };
  }

  getRequiredVariables(environment: EnvironmentName): string[] {
    return this.getPolicy(environment).requiredVariables;
  }

  getForbiddenVariables(environment: EnvironmentName): string[] {
    return this.getPolicy(environment).forbiddenVariables;
  }

  requiresApproval(environment: EnvironmentName): boolean {
    return this.getPolicy(environment).securityRequirements.minApprovalCount > 0;
  }

  getDeploymentStrategies(environment: EnvironmentName): DeploymentStrategy[] {
    return this.getPolicy(environment).deployment.allowedStrategies;
  }

  getVulnerabilityPolicy(environment: EnvironmentName) {
    return this.getPolicy(environment).vulnerabilityPolicy;
  }

  getBackupPolicy(environment: EnvironmentName) {
    return this.getPolicy(environment).backupPolicy;
  }
}
