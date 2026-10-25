// # Responsibility: summarize verified release manifests through the canonical built workspace package.
import {
  ReleaseManifestService,
  EnvironmentName,
  type BuildInputs,
  type ReleaseManifest,
} from '@wlct/utils';

export {
  ReleaseManifestService,
  EnvironmentName,
  type BuildInputs,
  type ReleaseManifest,
};

export interface ReleaseManifestHealthSummary {
  releaseId: string;
  version: string;
  commitShort: string;
  environment: EnvironmentName;
  schemaHash: string;
  valid: boolean;
  validationErrors: string[];
}

export function summarizeReleaseManifestForOpsConsole(
  manifest: ReleaseManifest,
): ReleaseManifestHealthSummary {
  const svc = new ReleaseManifestService();
  const validation = svc.validateManifest(manifest);
  return {
    releaseId: manifest.releaseId,
    version: manifest.version,
    commitShort: manifest.commitShort,
    environment: manifest.environment,
    schemaHash: manifest.schema.schemaHash,
    valid: validation.valid,
    validationErrors: validation.errors,
  };
}

export default ReleaseManifestService;
