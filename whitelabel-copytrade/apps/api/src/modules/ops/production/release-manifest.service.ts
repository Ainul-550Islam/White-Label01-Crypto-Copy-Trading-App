// # Serves verified release manifest metadata to admin ops console
import {
  ReleaseManifestService,
  type BuildInputs,
} from '../../../../../ops/production/release-manifest.service';
import {
  EnvironmentName,
  type ReleaseManifest,
} from '../../../../../ops/production/production.types';

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
