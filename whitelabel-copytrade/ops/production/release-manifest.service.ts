/**
 * Release Manifest Service
 * Builds deterministic release manifests containing git commit, package versions,
 * container image digest, schema version, migration identifier, frontend build identifier,
 * backend build identifier and calculation/build metadata.
 */

import * as crypto from 'crypto';
import { ReleaseManifest, EnvironmentName } from './production.types';

export interface BuildInputs {
  commitSha: string;
  branch: string;
  tag?: string;
  backendPackageVersion: string;
  frontendWebVersion: string;
  adminWebVersion: string;
  imageName: string;
  imageDigest: string;
  imageTag: string;
  prismaVersion: string;
  migrationId: string;
  migrationHistory: string[];
  schemaHash: string;
  backendBuildId: string;
  frontendWebBuildId: string;
  adminBuildId: string;
  nodeVersion: string;
  npmVersion: string;
  builtBy: string;
  environment: EnvironmentName;
  correlationId: string;
  buildDurationMs: number;
}

export class ReleaseManifestService {
  buildManifest(inputs: BuildInputs): ReleaseManifest {
    const releaseId = this.generateReleaseId(inputs.commitSha, inputs.environment, inputs.migrationId);
    const commitShort = inputs.commitSha.slice(0, 8);
    const builtAt = new Date().toISOString();

    const artifactChecksum = this.calculateArtifactChecksum(inputs);

    const manifest: ReleaseManifest = {
      releaseId,
      version: this.calculateVersion(inputs.backendPackageVersion, inputs.commitSha, inputs.environment),
      commitSha: inputs.commitSha,
      commitShort,
      branch: inputs.branch,
      tag: inputs.tag,
      builtAt,
      builtBy: inputs.builtBy,
      environment: inputs.environment,
      backend: {
        packageVersion: inputs.backendPackageVersion,
        buildId: inputs.backendBuildId,
        imageName: inputs.imageName,
        imageDigest: inputs.imageDigest,
        imageTag: inputs.imageTag,
      },
      frontend: {
        webVersion: inputs.frontendWebVersion,
        buildId: inputs.frontendWebBuildId,
        adminWebVersion: inputs.adminWebVersion,
        adminBuildId: inputs.adminBuildId,
      },
      schema: {
        prismaVersion: inputs.prismaVersion,
        migrationId: inputs.migrationId,
        migrationHistory: [...inputs.migrationHistory].sort(),
        schemaHash: inputs.schemaHash,
      },
      artifacts: {
        artifactChecksum,
      },
      metadata: {
        nodeVersion: inputs.nodeVersion,
        npmVersion: inputs.npmVersion,
        buildCorrelationId: inputs.correlationId,
        buildDurationMs: inputs.buildDurationMs,
        reproducible: true,
      },
    };

    return this.sortManifestDeterministically(manifest);
  }

  private generateReleaseId(commitSha: string, environment: EnvironmentName, migrationId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${commitSha}-${environment}-${migrationId}`)
      .digest('hex')
      .slice(0, 16);
    return `rel_${environment}_${hash}`;
  }

  private calculateVersion(packageVersion: string, commitSha: string, environment: EnvironmentName): string {
    const short = commitSha.slice(0, 8);
    if (environment === EnvironmentName.PRODUCTION) {
      return `${packageVersion}+${short}`;
    }
    return `${packageVersion}-${environment}+${short}`;
  }

  private calculateArtifactChecksum(inputs: BuildInputs): string {
    const payload = JSON.stringify({
      commitSha: inputs.commitSha,
      backendPackageVersion: inputs.backendPackageVersion,
      frontendWebVersion: inputs.frontendWebVersion,
      adminWebVersion: inputs.adminWebVersion,
      imageDigest: inputs.imageDigest,
      migrationId: inputs.migrationId,
      schemaHash: inputs.schemaHash,
      backendBuildId: inputs.backendBuildId,
      frontendWebBuildId: inputs.frontendWebBuildId,
      adminBuildId: inputs.adminBuildId,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  private sortManifestDeterministically(manifest: ReleaseManifest): ReleaseManifest {
    return {
      ...manifest,
      schema: {
        ...manifest.schema,
        migrationHistory: [...manifest.schema.migrationHistory].sort(),
      },
    };
  }

  isDeterministic(manifestA: ReleaseManifest, manifestB: ReleaseManifest): boolean {
    if (manifestA.commitSha !== manifestB.commitSha) return false;
    if (manifestA.schema.migrationId !== manifestB.schema.migrationId) return false;
    if (manifestA.backend.imageDigest !== manifestB.backend.imageDigest) return false;
    if (manifestA.schema.schemaHash !== manifestB.schema.schemaHash) return false;
    if (manifestA.artifacts.artifactChecksum !== manifestB.artifacts.artifactChecksum) return false;
    return true;
  }

  validateManifest(manifest: ReleaseManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.releaseId) errors.push('releaseId missing');
    if (!manifest.commitSha || manifest.commitSha.length < 7) errors.push('commitSha invalid');
    if (!manifest.backend.imageDigest) errors.push('imageDigest missing');
    if (!manifest.schema.migrationId) errors.push('migrationId missing');
    if (!manifest.schema.schemaHash) errors.push('schemaHash missing');
    if (!manifest.artifacts.artifactChecksum) errors.push('artifactChecksum missing');
    if (!manifest.backend.packageVersion) errors.push('backend package version missing');
    if (manifest.schema.migrationHistory.length === 0) errors.push('migrationHistory empty');
    if (!manifest.metadata.buildCorrelationId) errors.push('buildCorrelationId missing');
    return { valid: errors.length === 0, errors };
  }

  calculateSchemaHash(schemaContent: string): string {
    return crypto.createHash('sha256').update(schemaContent).digest('hex');
  }

  getReleaseIdFromManifest(manifest: ReleaseManifest): string {
    return manifest.releaseId;
  }
}
