/**
 * Explicit API version resolution and deprecation metadata.
 *
 * Only implemented versions exist in the registry; negotiation is explicit
 * per request (path prefix or X-Api-Version / query), unknown versions fail
 * with a deterministic error, deprecated versions answer deterministically
 * with deprecation metadata, and an active version's behavior can never be
 * changed by adding a new one.
 */

import { Injectable } from '@nestjs/common';

import {
  API_VERSION_CONTRACTS,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  findApiVersion,
  isVersionAccepted,
  type ApiVersionContract,
} from './developer.types';

export interface VersionResolution {
  contract: ApiVersionContract;
  /** Deprecation headers to attach when the version is deprecated. */
  headers: Record<string, string>;
}

@Injectable()
export class ApiVersionService {
  /** Registry is read-only and shared; no per-tenant mutation exists. */
  contracts(): readonly ApiVersionContract[] {
    return API_VERSION_CONTRACTS;
  }

  /**
   * Resolves one request's version: explicit path version wins, then the
   * X-Api-Version header, then the `version` query parameter. Absence of
   * all three is an error — there is no implicit "latest" that could shift
   * behavior under a developer.
   */
  resolve(explicit: { pathVersion?: string; headerVersion?: string; queryVersion?: string; nowIso: string }): VersionResolution {
    const requested = explicit.pathVersion ?? explicit.headerVersion ?? explicit.queryVersion;
    if (!requested) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VERSION_UNSUPPORTED,
        'an explicit API version is required (path prefix or X-Api-Version)',
      );
    }
    const contract = findApiVersion(requested);
    if (!contract) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VERSION_UNSUPPORTED,
        `API version '${requested}' does not exist; supported: ${API_VERSION_CONTRACTS.map((c) => c.version).join(', ')}`,
      );
    }
    if (!isVersionAccepted(contract.version, explicit.nowIso)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VERSION_SUNSET,
        `API version '${contract.version}' was sunset${contract.sunsetAt ? ` at ${contract.sunsetAt}` : ''}; use ${contract.replacement ?? 'a supported version'}`,
      );
    }
    const headers: Record<string, string> = {};
    if (contract.state === 'DEPRECATED') {
      headers['Deprecation'] = contract.deprecatedAt ? `@${contract.deprecatedAt}` : 'true';
      if (contract.sunsetAt) headers['Sunset'] = contract.sunsetAt;
      if (contract.replacement) headers['X-Api-Replacement'] = contract.replacement;
      headers['X-Api-Version'] = contract.version;
    } else {
      headers['X-Api-Version'] = contract.version;
    }
    return { contract, headers };
  }

  /** Tenant/client gate: policy decides which versions a caller may use. */
  assertVersionAllowed(version: string, allowedVersions: readonly string[]): void {
    const contract = findApiVersion(version);
    if (!contract) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VERSION_UNSUPPORTED,
        `API version '${version}' does not exist`,
      );
    }
    if (!allowedVersions.includes(contract.version)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VERSION_UNSUPPORTED,
        `API version '${version}' is not enabled for this tenant`,
      );
    }
  }
}
