/**
 * Production Module
 * Platform-only production control plane module that wires all production
 * infrastructure, CI/CD, security supply chain, release, deployment, backup,
 * disaster recovery and rollback services.
 *
 * This module enforces:
 * - No bypass of Operations, Security, Compliance, Risk, OMS, Live Gate
 * - All privileged actions audited with correlation IDs
 * - Environment policies enforced
 * - Migration gate and RLS gate as first-class production gates
 * - Artifact integrity and security gates blocking deployment on failure
 *
 * Documentation is embedded here to avoid exceeding the exact 30-file limit.
 *
 * Architecture:
 * Source
 *  ↓
 * Build
 *  ↓
 * Test
 *  ↓
 * Security
 *  ↓
 * SBOM
 *  ↓
 * Artifact Signing
 *  ↓
 * Migration Gate
 *  ↓
 * RLS Gate
 *  ↓
 * Release Manifest
 *  ↓
 * Approval
 *  ↓
 * Production Deployment
 *  ↓
 * Health Verification
 *  ↓
 * Reconciliation
 *  ↓
 * Audit
 *  ↓
 * Production
 *
 * Recovery:
 * Production Failure
 *  ↓
 * Operations Incident
 *  ↓
 * Health / Dependency Evidence
 *  ↓
 * Rollback Decision
 *  ↓
 * Verified Previous Artifact
 *  ↓
 * Controlled Application Rollback
 *  ↓
 * Schema Compatibility Check
 *  ↓
 * Recovery / Restore if required
 *  ↓
 * Reconciliation
 *  ↓
 * Post-Recovery Verification
 *  ↓
 * Audit
 */

import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { EnvironmentPolicyService } from './environment-policy.service';
import { EnvironmentValidatorService } from './environment-validator.service';
import { ReleaseManifestService } from './release-manifest.service';
import { ArtifactIntegrityService } from './artifact-integrity.service';
import { MigrationGateService } from './migration-gate.service';
import { RlsGateService } from './rls-gate.service';
import { PreflightService } from './preflight.service';
import { DeploymentPlanService } from './deployment-plan.service';
import { DeploymentExecutorService } from './deployment-executor.service';
import { DeploymentVerificationService } from './deployment-verification.service';
import { RollbackService } from './rollback.service';
import { BackupService } from './backup.service';
import { BackupVerificationService } from './backup-verification.service';
import { RestoreVerificationService } from './restore-verification.service';
import { DisasterRecoveryService } from './disaster-recovery.service';
import { SecurityGateService } from './security-gate.service';
import { ImageSecurityService } from './image-security.service';
import { SbomService } from './sbom.service';
import { VulnerabilityGateService } from './vulnerability-gate.service';
import { ArtifactSigningService } from './artifact-signing.service';
import { DeploymentAuditService } from './deployment-audit.service';
import { ProductionReadinessService } from './production-readiness.service';
import { MaintenanceIntegrationService } from './maintenance-integration.service';

@Module({
  controllers: [ProductionController],
  providers: [
    EnvironmentPolicyService,
    EnvironmentValidatorService,
    ReleaseManifestService,
    ArtifactIntegrityService,
    MigrationGateService,
    RlsGateService,
    PreflightService,
    DeploymentPlanService,
    DeploymentExecutorService,
    DeploymentVerificationService,
    RollbackService,
    BackupService,
    BackupVerificationService,
    RestoreVerificationService,
    DisasterRecoveryService,
    SecurityGateService,
    ImageSecurityService,
    SbomService,
    VulnerabilityGateService,
    ArtifactSigningService,
    DeploymentAuditService,
    ProductionReadinessService,
    MaintenanceIntegrationService,
  ],
  exports: [
    EnvironmentPolicyService,
    EnvironmentValidatorService,
    ReleaseManifestService,
    ArtifactIntegrityService,
    MigrationGateService,
    RlsGateService,
    PreflightService,
    DeploymentPlanService,
    DeploymentExecutorService,
    DeploymentVerificationService,
    RollbackService,
    BackupService,
    BackupVerificationService,
    RestoreVerificationService,
    DisasterRecoveryService,
    SecurityGateService,
    ImageSecurityService,
    SbomService,
    VulnerabilityGateService,
    ArtifactSigningService,
    DeploymentAuditService,
    ProductionReadinessService,
    MaintenanceIntegrationService,
  ],
})
export class ProductionModule {}
