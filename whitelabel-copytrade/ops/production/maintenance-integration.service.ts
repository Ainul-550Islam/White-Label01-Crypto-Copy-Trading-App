/**
 * Maintenance Integration Service
 * Integrates releases with existing Operations maintenance/degradation system,
 * enforcing controlled deployment windows and preventing unsafe customer/trading
 * actions during restricted deployments.
 */

import { EnvironmentName, MaintenanceIntegrationStatus } from './production.types';
import { DeploymentAuditService } from './deployment-audit.service';

export interface MaintenanceWindow {
  startAt: string;
  endAt: string;
  allowedEnvironments: EnvironmentName[];
  allowedStrategies: string[];
  requiresApproval: boolean;
  maxDurationMinutes: number;
}

export interface MaintenanceIntegrationInput {
  deploymentId: string;
  releaseId: string;
  environment: EnvironmentName;
  correlationId: string;
  operatorId: string;
  requestedWindow?: MaintenanceWindow;
}

export interface MaintenanceIntegrationResult {
  deploymentId: string;
  status: MaintenanceIntegrationStatus;
  maintenanceEntered: boolean;
  window: MaintenanceWindow;
  blockedActions: string[];
  allowedActions: string[];
  enteredAt?: string;
  exitedAt?: string;
  failureReason?: string;
  correlationId: string;
}

export class MaintenanceIntegrationService {
  private readonly auditService: DeploymentAuditService;

  constructor(auditService?: DeploymentAuditService) {
    this.auditService = auditService || new DeploymentAuditService();
  }

  async enterMaintenance(input: MaintenanceIntegrationInput): Promise<MaintenanceIntegrationResult> {
    const window = input.requestedWindow || this.getDefaultWindow(input.environment);
    const enteredAt = new Date().toISOString();

    const validation = this.validateWindow(window, input.environment);
    if (!validation.valid) {
      await this.auditService.record({
        releaseId: input.releaseId,
        deploymentId: input.deploymentId,
        environment: input.environment,
        action: 'MAINTENANCE_INTEGRATION',
        result: 'FAILED',
        operatorId: input.operatorId,
        operatorType: 'USER',
        commitSha: 'n/a',
        startAt: enteredAt,
        finishAt: new Date().toISOString(),
        failureReason: validation.reason,
        correlationId: input.correlationId,
        evidence: { window },
      });

      return {
        deploymentId: input.deploymentId,
        status: MaintenanceIntegrationStatus.FAILED,
        maintenanceEntered: false,
        window,
        blockedActions: [],
        allowedActions: [],
        failureReason: validation.reason,
        correlationId: input.correlationId,
      };
    }

    await this.auditService.record({
      releaseId: input.releaseId,
      deploymentId: input.deploymentId,
      environment: input.environment,
      action: 'MAINTENANCE_INTEGRATION',
      result: 'ENTERING_MAINTENANCE',
      operatorId: input.operatorId,
      operatorType: 'USER',
      commitSha: 'n/a',
      startAt: enteredAt,
      correlationId: input.correlationId,
      evidence: {
        window,
        blockedActions: this.getBlockedActions(input.environment),
      },
    });

    return {
      deploymentId: input.deploymentId,
      status: MaintenanceIntegrationStatus.MAINTENANCE,
      maintenanceEntered: true,
      window,
      blockedActions: this.getBlockedActions(input.environment),
      allowedActions: this.getAllowedActions(input.environment),
      enteredAt,
      correlationId: input.correlationId,
    };
  }

  async exitMaintenance(input: MaintenanceIntegrationInput): Promise<MaintenanceIntegrationResult> {
    const exitedAt = new Date().toISOString();
    const window = input.requestedWindow || this.getDefaultWindow(input.environment);

    await this.auditService.record({
      releaseId: input.releaseId,
      deploymentId: input.deploymentId,
      environment: input.environment,
      action: 'MAINTENANCE_INTEGRATION',
      result: 'EXITING_MAINTENANCE',
      operatorId: input.operatorId,
      operatorType: 'USER',
      commitSha: 'n/a',
      startAt: exitedAt,
      finishAt: new Date().toISOString(),
      correlationId: input.correlationId,
      evidence: { window },
    });

    return {
      deploymentId: input.deploymentId,
      status: MaintenanceIntegrationStatus.IDLE,
      maintenanceEntered: false,
      window,
      blockedActions: [],
      allowedActions: this.getAllowedActions(input.environment),
      exitedAt,
      correlationId: input.correlationId,
    };
  }

  private getDefaultWindow(environment: EnvironmentName): MaintenanceWindow {
    const now = new Date();
    const startAt = now.toISOString();
    const endAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    return {
      startAt,
      endAt,
      allowedEnvironments: [environment],
      allowedStrategies: ['BLUE_GREEN', 'CANARY', 'ROLLING'],
      requiresApproval: environment === EnvironmentName.PRODUCTION,
      maxDurationMinutes: environment === EnvironmentName.PRODUCTION ? 60 : 120,
    };
  }

  private validateWindow(window: MaintenanceWindow, environment: EnvironmentName): { valid: boolean; reason?: string } {
    const start = new Date(window.startAt).getTime();
    const end = new Date(window.endAt).getTime();
    if (isNaN(start) || isNaN(end)) {
      return { valid: false, reason: 'Invalid maintenance window dates' };
    }
    if (end <= start) {
      return { valid: false, reason: 'Maintenance window end must be after start' };
    }
    const durationMinutes = (end - start) / 60000;
    if (durationMinutes > window.maxDurationMinutes) {
      return { valid: false, reason: `Window duration ${durationMinutes}m exceeds max ${window.maxDurationMinutes}m` };
    }
    if (!window.allowedEnvironments.includes(environment)) {
      return { valid: false, reason: `Environment ${environment} not allowed in this maintenance window` };
    }
    return { valid: true };
  }

  private getBlockedActions(environment: EnvironmentName): string[] {
    if (environment === EnvironmentName.PRODUCTION) {
      return [
        'LIVE_TRADING',
        'COPY_SUBSCRIPTION_CREATE',
        'WITHDRAWAL_REQUEST',
        'EXCHANGE_CONNECT',
        'STRATEGY_PUBLISH',
        'KYC_APPROVAL',
      ];
    }
    return ['LIVE_TRADING'];
  }

  private getAllowedActions(environment: EnvironmentName): string[] {
    return [
      'READ_PORTFOLIO',
      'READ_STATEMENTS',
      'READ_NOTIFICATIONS',
      'HEALTH_CHECK',
      'METRICS_READ',
      'AUDIT_READ',
    ];
  }

  shouldBlockDeploymentAction(action: string, environment: EnvironmentName, isInMaintenance: boolean): boolean {
    if (!isInMaintenance) return false;
    const blocked = this.getBlockedActions(environment);
    return blocked.includes(action);
  }
}
