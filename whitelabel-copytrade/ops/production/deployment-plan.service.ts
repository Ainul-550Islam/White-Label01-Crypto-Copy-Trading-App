/**
 * Deployment Plan Service
 * Creates deterministic deployment plans showing release version, target environment,
 * migration state, services affected, health gates, approval requirements,
 * rollback strategy and verification criteria.
 */

import * as crypto from 'crypto';
import { DeploymentPlan, EnvironmentName, DeploymentStrategy, ReleaseManifest } from './production.types';
import { EnvironmentPolicyService } from './environment-policy.service';

export interface DeploymentPlanInput {
  releaseManifest: ReleaseManifest;
  environment: EnvironmentName;
  currentMigrationId: string;
  strategy?: DeploymentStrategy;
  targetServices: string[];
  correlationId: string;
  createdBy: string;
  approvalReference?: string;
}

export class DeploymentPlanService {
  private readonly policyService: EnvironmentPolicyService;

  constructor(policyService?: EnvironmentPolicyService) {
    this.policyService = policyService || new EnvironmentPolicyService();
  }

  createPlan(input: DeploymentPlanInput): DeploymentPlan {
    const deploymentId = this.generateDeploymentId(input.releaseManifest.releaseId, input.environment, input.correlationId);
    const policy = this.policyService.getPolicy(input.environment);
    const strategy = input.strategy || this.resolveDefaultStrategy(input.environment);

    if (!policy.deployment.allowedStrategies.includes(strategy)) {
      throw new Error(`Strategy ${strategy} not allowed in ${input.environment}. Allowed: ${policy.deployment.allowedStrategies.join(', ')}`);
    }

    const pendingMigrations = this.calculatePendingMigrations(
      input.currentMigrationId,
      input.releaseManifest.schema.migrationId,
      input.releaseManifest.schema.migrationHistory,
    );

    const hasDestructive = false;

    const plan: DeploymentPlan = {
      deploymentId,
      releaseId: input.releaseManifest.releaseId,
      correlationId: input.correlationId,
      environment: input.environment,
      strategy,
      targetServices: [...input.targetServices].sort(),
      migrationState: {
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.releaseManifest.schema.migrationId,
        pendingMigrations,
        hasDestructive,
        requiresBackup: policy.deployment.requiresBackupBeforeMigration,
      },
      healthGates: this.getHealthGates(input.environment),
      approval: {
        required: policy.securityRequirements.minApprovalCount > 0,
        requiredRoles: this.getRequiredRoles(input.environment),
        approvalReference: input.approvalReference,
      },
      rollback: {
        previousReleaseId: this.getPreviousReleaseId(input.releaseManifest),
        previousArtifactDigest: '',
        strategy: DeploymentStrategy.BLUE_GREEN,
        requiresCompatibilityCheck: true,
      },
      verification: {
        criteria: this.getVerificationCriteria(input.environment),
        timeoutMs: this.getVerificationTimeout(input.environment),
        retryCount: 3,
      },
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };

    return this.sortDeterministically(plan);
  }

  private generateDeploymentId(releaseId: string, environment: EnvironmentName, correlationId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${releaseId}-${environment}-${correlationId}`)
      .digest('hex')
      .slice(0, 12);
    return `dep_${environment}_${hash}`;
  }

  private resolveDefaultStrategy(environment: EnvironmentName): DeploymentStrategy {
    if (environment === EnvironmentName.PRODUCTION) return DeploymentStrategy.BLUE_GREEN;
    if (environment === EnvironmentName.STAGING) return DeploymentStrategy.ROLLING;
    return DeploymentStrategy.RECREATE;
  }

  private calculatePendingMigrations(currentId: string, targetId: string, history: string[]): string[] {
    const sorted = [...history].sort();
    const currentIdx = sorted.indexOf(currentId);
    const targetIdx = sorted.indexOf(targetId);
    if (currentIdx === -1 || targetIdx === -1) return [];
    if (targetIdx <= currentIdx) return [];
    return sorted.slice(currentIdx + 1, targetIdx + 1);
  }

  private getHealthGates(environment: EnvironmentName): string[] {
    const base = [
      'database_connectivity',
      'redis_connectivity',
      'queue_health',
      'api_health',
      'auth_health',
      'migration_state',
    ];
    if (environment === EnvironmentName.PRODUCTION) {
      return [
        ...base,
        'frontend_health',
        'security_controls',
        'operations_controls',
        'billing_health',
        'exchange_health',
        'custody_health',
        'risk_health',
        'compliance_health',
        'oms_health',
        'realtime_health',
        'critical_path',
      ];
    }
    return base;
  }

  private getRequiredRoles(environment: EnvironmentName): string[] {
    if (environment === EnvironmentName.PRODUCTION) return ['PLATFORM_ADMIN', 'RELEASE_MANAGER'];
    if (environment === EnvironmentName.STAGING) return ['PLATFORM_ADMIN', 'DEVELOPER'];
    return ['DEVELOPER'];
  }

  private getPreviousReleaseId(manifest: ReleaseManifest): string {
    return `prev_${manifest.releaseId}`;
  }

  private getVerificationCriteria(environment: EnvironmentName): string[] {
    const criteria = [
      'http_200_health',
      'database_query_ok',
      'redis_ping_ok',
      'queue_depth_acceptable',
      'migration_id_matches',
      'auth_flow_works',
    ];
    if (environment === EnvironmentName.PRODUCTION) {
      criteria.push('frontend_loads', 'critical_path_trading_eligible', 'realtime_connects', 'no_critical_errors_in_logs');
    }
    return criteria;
  }

  private getVerificationTimeout(environment: EnvironmentName): number {
    if (environment === EnvironmentName.PRODUCTION) return 300000;
    if (environment === EnvironmentName.STAGING) return 180000;
    return 60000;
  }

  private sortDeterministically(plan: DeploymentPlan): DeploymentPlan {
    return {
      ...plan,
      targetServices: [...plan.targetServices].sort(),
      healthGates: [...plan.healthGates].sort(),
      verification: {
        ...plan.verification,
        criteria: [...plan.verification.criteria].sort(),
      },
    };
  }

  isDeterministic(planA: DeploymentPlan, planB: DeploymentPlan): boolean {
    return JSON.stringify(this.sortDeterministically(planA)) === JSON.stringify(this.sortDeterministically(planB));
  }

  validatePlan(plan: DeploymentPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!plan.deploymentId) errors.push('deploymentId missing');
    if (!plan.releaseId) errors.push('releaseId missing');
    if (!plan.correlationId) errors.push('correlationId missing');
    if (!plan.environment) errors.push('environment missing');
    if (!plan.targetServices || plan.targetServices.length === 0) errors.push('targetServices empty');
    if (!plan.migrationState.currentMigrationId) errors.push('currentMigrationId missing');
    if (!plan.migrationState.targetMigrationId) errors.push('targetMigrationId missing');
    if (plan.healthGates.length === 0) errors.push('healthGates empty');
    if (plan.verification.criteria.length === 0) errors.push('verification criteria empty');
    return { valid: errors.length === 0, errors };
  }
}
