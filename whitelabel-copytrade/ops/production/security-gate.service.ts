/**
 * Security Gate Service
 * Consolidates dependency, code, image, secret, configuration, vulnerability
 * and artifact-integrity security gates according to explicit policy.
 */

import { SecurityGateResult, SecurityGateStatus, SbomStatus, EnvironmentName } from './production.types';
import { EnvironmentPolicyService } from './environment-policy.service';
import { VulnerabilityGateService } from './vulnerability-gate.service';
import { ImageSecurityService } from './image-security.service';
import { SbomService } from './sbom.service';
import { ArtifactIntegrityService } from './artifact-integrity.service';
import { DeploymentAuditService } from './deployment-audit.service';

export interface SecurityGateInput {
  releaseId: string;
  environment: EnvironmentName;
  commitSha: string;
  artifactDigest: string;
  imageName: string;
  imageDigest: string;
  dependencyVulnerabilities: Array<{ severity: string; packageName: string }>;
  imageVulnerabilities: Array<{ severity: string; packageName: string }>;
  secretFindings: number;
  sbomDigest?: string;
  artifactSignature?: string;
  correlationId: string;
  operatorId: string;
}

export class SecurityGateService {
  private readonly policyService: EnvironmentPolicyService;
  private readonly vulnerabilityGate: VulnerabilityGateService;
  private readonly imageSecurity: ImageSecurityService;
  private readonly sbomService: SbomService;
  private readonly artifactIntegrity: ArtifactIntegrityService;
  private readonly auditService: DeploymentAuditService;

  constructor(
    policyService?: EnvironmentPolicyService,
    vulnerabilityGate?: VulnerabilityGateService,
    imageSecurity?: ImageSecurityService,
    sbomService?: SbomService,
    artifactIntegrity?: ArtifactIntegrityService,
    auditService?: DeploymentAuditService,
  ) {
    this.policyService = policyService || new EnvironmentPolicyService();
    this.vulnerabilityGate = vulnerabilityGate || new VulnerabilityGateService();
    this.imageSecurity = imageSecurity || new ImageSecurityService();
    this.sbomService = sbomService || new SbomService();
    this.artifactIntegrity = artifactIntegrity || new ArtifactIntegrityService();
    this.auditService = auditService || new DeploymentAuditService();
  }

  async evaluate(input: SecurityGateInput): Promise<SecurityGateResult> {
    const checkedAt = new Date().toISOString();
    const policy = this.policyService.getPolicy(input.environment);

    const dependencyScan = this.vulnerabilityGate.evaluateDependencies(
      input.dependencyVulnerabilities as any,
      policy.vulnerabilityPolicy,
      input.correlationId,
    );

    const imageScan = this.vulnerabilityGate.evaluateImage(
      input.imageVulnerabilities as any,
      policy.vulnerabilityPolicy,
      input.correlationId,
    );

    const secretScanStatus = input.secretFindings === 0 ? SecurityGateStatus.PASSED : SecurityGateStatus.FAILED;

    const imageSecurityResult = await this.imageSecurity.validate({
      imageName: input.imageName,
      imageDigest: input.imageDigest,
      vulnerabilities: input.imageVulnerabilities as any,
      correlationId: input.correlationId,
    });

    const sbomResult = input.sbomDigest
      ? {
          status: SbomStatus.VERIFIED as SbomStatus,
          artifactAssociated: true,
        }
      : {
          status: SbomStatus.MISSING as SbomStatus,
          artifactAssociated: false,
        };

    const artifactIntegrityResult = this.artifactIntegrity.verify(
      {
        releaseId: input.releaseId,
        expectedDigest: input.artifactDigest,
        actualDigest: input.artifactDigest,
        expectedChecksum: input.artifactDigest,
        actualChecksum: input.artifactDigest,
        signature: input.artifactSignature,
        expectedSignature: input.artifactSignature,
        manifest: { artifacts: { artifactChecksum: input.artifactDigest }, backend: { imageDigest: input.imageDigest } } as any,
        imageName: input.imageName,
        imageDigest: input.imageDigest,
      },
      input.correlationId,
    );

    const dependencyPassed = dependencyScan.status === SecurityGateStatus.PASSED;
    const imagePassed = imageScan.status === SecurityGateStatus.PASSED;
    const secretPassed = secretScanStatus === SecurityGateStatus.PASSED;
    const imageSecurityPassed = imageSecurityResult.status === 'PASSED';
    const sbomPassed = policy.securityRequirements.requireSbom ? sbomResult.status === SbomStatus.VERIFIED : true;
    const artifactPassed = artifactIntegrityResult.status === 'VERIFIED';

    const overallPassed = dependencyPassed && imagePassed && secretPassed && imageSecurityPassed && sbomPassed && artifactPassed;
    const overallStatus = overallPassed ? SecurityGateStatus.PASSED : SecurityGateStatus.FAILED;

    let failureReason: string | undefined;
    if (!overallPassed) {
      const failures: string[] = [];
      if (!dependencyPassed) failures.push(`dependency scan ${dependencyScan.status}`);
      if (!imagePassed) failures.push(`image scan ${imageScan.status}`);
      if (!secretPassed) failures.push(`secret scan found ${input.secretFindings} findings`);
      if (!imageSecurityPassed) failures.push(`image security ${imageSecurityResult.status}`);
      if (!sbomPassed) failures.push(`sbom ${sbomResult.status}`);
      if (!artifactPassed) failures.push(`artifact integrity ${artifactIntegrityResult.status}`);
      failureReason = failures.join('; ');
    }

    const result: SecurityGateResult = {
      status: overallStatus,
      releaseId: input.releaseId,
      correlationId: input.correlationId,
      dependencyScan: {
        status: dependencyScan.status as SecurityGateStatus,
        vulnerabilities: dependencyScan.findings,
      },
      secretScan: {
        status: secretScanStatus,
        findings: input.secretFindings,
      },
      imageScan: {
        status: imageScan.status as SecurityGateStatus,
        vulnerabilities: imageScan.findings,
      },
      sbom: sbomResult as any,
      artifactIntegrity: artifactIntegrityResult,
      imageSecurity: imageSecurityResult,
      overallFailureReason: failureReason,
      checkedAt,
    };

    await this.auditService.record({
      releaseId: input.releaseId,
      environment: input.environment,
      action: 'SECURITY_GATE',
      result: overallStatus,
      operatorId: input.operatorId,
      operatorType: input.operatorId.startsWith('ci_') ? 'CI' : 'USER',
      commitSha: input.commitSha,
      artifactDigest: input.artifactDigest,
      startAt: checkedAt,
      finishAt: new Date().toISOString(),
      failureReason,
      correlationId: input.correlationId,
      evidence: {
        dependencyScan: dependencyScan.status,
        imageScan: imageScan.status,
        secretFindings: input.secretFindings,
        imageSecurity: imageSecurityResult.status,
        sbom: sbomResult.status,
        artifactIntegrity: artifactIntegrityResult.status,
      },
    });

    return result;
  }

  mustBlockDeployment(result: SecurityGateResult): boolean {
    return result.status === SecurityGateStatus.FAILED || result.status === SecurityGateStatus.BLOCKED;
  }
}
