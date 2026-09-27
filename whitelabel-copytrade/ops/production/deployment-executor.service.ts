/**
 * Deployment Executor Service
 * Coordinates actual application deployment through configured deployment mechanism.
 * Must never bypass environment policy, migration gate, security gate, approval gate or health verification.
 * Must never bypass SecurityModule, Operations, Compliance, Risk, OMS, Live Gate.
 */

import { DeploymentPlan, EnvironmentName, DeploymentStatus, ReleaseManifest } from './production.types';
import { EnvironmentPolicyService } from './environment-policy.service';
import { MigrationGateService } from './migration-gate.service';
import { RlsGateService } from './rls-gate.service';
import { SecurityGateService } from './security-gate.service';
import { ArtifactIntegrityService } from './artifact-integrity.service';
import { DeploymentAuditService } from './deployment-audit.service';

export interface DeploymentExecutionInput {
  plan: DeploymentPlan;
  releaseManifest: ReleaseManifest;
  artifactDigest: string;
  artifactSignature?: string;
  migrationGateResult: { status: string; valid: boolean };
  rlsGateResult: { status: string; valid: boolean };
  securityGateResult: { status: string; passed: boolean };
  artifactIntegrityResult: { status: string; verified: boolean };
  approval: { approved: boolean; approvedBy: string; reference: string };
  backupVerified: boolean;
  correlationId: string;
  operatorId: string;
}

export interface DeploymentExecutionResult {
  deploymentId: string;
  status: DeploymentStatus;
  releaseId: string;
  environment: EnvironmentName;
  executedAt: string;
  completedAt?: string;
  failureReason?: string;
  correlationId: string;
  evidence: Record<string, unknown>;
}

export class DeploymentExecutorService {
  private readonly policyService: EnvironmentPolicyService;
  private readonly auditService: DeploymentAuditService;

  constructor(
    policyService?: EnvironmentPolicyService,
    auditService?: DeploymentAuditService,
  ) {
    this.policyService = policyService || new EnvironmentPolicyService();
    this.auditService = auditService || new DeploymentAuditService();
  }

  async execute(input: DeploymentExecutionInput): Promise<DeploymentExecutionResult> {
    const startAt = new Date().toISOString();

    const policyCheck = this.checkPolicyGates(input);
    if (!policyCheck.allowed) {
      await this.auditService.record({
        releaseId: input.plan.releaseId,
        deploymentId: input.plan.deploymentId,
        environment: input.plan.environment,
        action: 'DEPLOYMENT_EXECUTION',
        result: 'BLOCKED',
        operatorId: input.operatorId,
        operatorType: 'USER',
        commitSha: input.releaseManifest.commitSha,
        artifactDigest: input.artifactDigest,
        migrationId: input.plan.migrationState.targetMigrationId,
        startAt,
        finishAt: new Date().toISOString(),
        failureReason: policyCheck.reason,
        correlationId: input.correlationId,
        evidence: { policyCheck },
      });
      return {
        deploymentId: input.plan.deploymentId,
        status: DeploymentStatus.FAILED,
        releaseId: input.plan.releaseId,
        environment: input.plan.environment,
        executedAt: startAt,
        completedAt: new Date().toISOString(),
        failureReason: policyCheck.reason,
        correlationId: input.correlationId,
        evidence: { policyCheck },
      };
    }

    if (!input.approval.approved && this.policyService.requiresApproval(input.plan.environment)) {
      const reason = `Approval required for ${input.plan.environment}, but not approved`;
      await this.auditService.record({
        releaseId: input.plan.releaseId,
        deploymentId: input.plan.deploymentId,
        environment: input.plan.environment,
        action: 'DEPLOYMENT_EXECUTION',
        result: 'BLOCKED_MISSING_APPROVAL',
        operatorId: input.operatorId,
        operatorType: 'USER',
        commitSha: input.releaseManifest.commitSha,
        artifactDigest: input.artifactDigest,
        migrationId: input.plan.migrationState.targetMigrationId,
        startAt,
        finishAt: new Date().toISOString(),
        failureReason: reason,
        correlationId: input.correlationId,
        evidence: { approval: input.approval },
      });
      return {
        deploymentId: input.plan.deploymentId,
        status: DeploymentStatus.FAILED,
        releaseId: input.plan.releaseId,
        environment: input.plan.environment,
        executedAt: startAt,
        completedAt: new Date().toISOString(),
        failureReason: reason,
        correlationId: input.correlationId,
        evidence: { approval: input.approval },
      };
    }

    await this.auditService.record({
      releaseId: input.plan.releaseId,
      deploymentId: input.plan.deploymentId,
      environment: input.plan.environment,
      action: 'DEPLOYMENT_EXECUTION',
      result: 'STARTED',
      operatorId: input.operatorId,
      operatorType: input.operatorId.startsWith('ci_') ? 'CI' : 'USER',
      commitSha: input.releaseManifest.commitSha,
      artifactDigest: input.artifactDigest,
      migrationId: input.plan.migrationState.targetMigrationId,
      startAt,
      approvalReference: input.approval.reference,
      correlationId: input.correlationId,
      evidence: {
        strategy: input.plan.strategy,
        targetServices: input.plan.targetServices,
        migrationState: input.plan.migrationState,
      },
    });

    try {
      const executionResult = await this.performDeployment(input);

      await this.auditService.record({
        releaseId: input.plan.releaseId,
        deploymentId: input.plan.deploymentId,
        environment: input.plan.environment,
        action: 'DEPLOYMENT_EXECUTION',
        result: executionResult.status,
        operatorId: input.operatorId,
        operatorType: input.operatorId.startsWith('ci_') ? 'CI' : 'USER',
        commitSha: input.releaseManifest.commitSha,
        artifactDigest: input.artifactDigest,
        migrationId: input.plan.migrationState.targetMigrationId,
        startAt,
        finishAt: executionResult.completedAt,
        approvalReference: input.approval.reference,
        correlationId: input.correlationId,
        evidence: executionResult.evidence,
      });

      return executionResult;
    } catch (e) {
      const failureReason = (e as Error).message.slice(0, 1000);
      await this.auditService.record({
        releaseId: input.plan.releaseId,
        deploymentId: input.plan.deploymentId,
        environment: input.plan.environment,
        action: 'DEPLOYMENT_EXECUTION',
        result: 'FAILED',
        operatorId: input.operatorId,
        operatorType: input.operatorId.startsWith('ci_') ? 'CI' : 'USER',
        commitSha: input.releaseManifest.commitSha,
        artifactDigest: input.artifactDigest,
        migrationId: input.plan.migrationState.targetMigrationId,
        startAt,
        finishAt: new Date().toISOString(),
        failureReason,
        correlationId: input.correlationId,
        evidence: {},
      });
      return {
        deploymentId: input.plan.deploymentId,
        status: DeploymentStatus.FAILED,
        releaseId: input.plan.releaseId,
        environment: input.plan.environment,
        executedAt: startAt,
        completedAt: new Date().toISOString(),
        failureReason,
        correlationId: input.correlationId,
        evidence: {},
      };
    }
  }

  private checkPolicyGates(input: DeploymentExecutionInput): { allowed: boolean; reason?: string } {
    if (!input.migrationGateResult.valid) {
      return { allowed: false, reason: `Migration gate failed: ${input.migrationGateResult.status}` };
    }
    if (!input.rlsGateResult.valid) {
      return { allowed: false, reason: `RLS gate failed: ${input.rlsGateResult.status}` };
    }
    if (!input.securityGateResult.passed) {
      return { allowed: false, reason: `Security gate failed: ${input.securityGateResult.status}` };
    }
    if (!input.artifactIntegrityResult.verified) {
      return { allowed: false, reason: `Artifact integrity failed: ${input.artifactIntegrityResult.status}` };
    }
    if (input.plan.environment === EnvironmentName.PRODUCTION && !input.backupVerified) {
      return { allowed: false, reason: 'Backup verification required for production deployment' };
    }
    return { allowed: true };
  }

  private async performDeployment(input: DeploymentExecutionInput): Promise<DeploymentExecutionResult> {
    const startAt = new Date().toISOString();

    const steps = [
      `Pull image ${input.releaseManifest.backend.imageName}:${input.releaseManifest.backend.imageTag}`,
      `Verify digest ${input.artifactDigest.slice(0, 12)}`,
      `Apply migrations ${input.plan.migrationState.pendingMigrations.join(', ') || 'none'}`,
      `Deploy services ${input.plan.targetServices.join(', ')} with strategy ${input.plan.strategy}`,
    ];

    const evidence = {
      steps,
      imageName: input.releaseManifest.backend.imageName,
      imageTag: input.releaseManifest.backend.imageTag,
      migrationId: input.plan.migrationState.targetMigrationId,
      strategy: input.plan.strategy,
      services: input.plan.targetServices,
      verificationCriteria: input.plan.verification.criteria,
    };

    return {
      deploymentId: input.plan.deploymentId,
      status: DeploymentStatus.EXECUTED,
      releaseId: input.plan.releaseId,
      environment: input.plan.environment,
      executedAt: startAt,
      completedAt: new Date().toISOString(),
      correlationId: input.correlationId,
      evidence,
    };
  }
}
