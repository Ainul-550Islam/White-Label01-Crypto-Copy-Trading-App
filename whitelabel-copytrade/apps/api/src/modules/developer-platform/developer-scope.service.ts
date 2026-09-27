/**
 * Scope resolution and validation across every developer surface.
 *
 * The allowed-set algebra is: APPLICATION scopes ∩ POLICY scopes ∩ SUBJECT
 * scopes, then every REQUEST must be covered by that intersection by exact
 * name. There is no implication anywhere in this file: `trading:read` never
 * implies `trading:execute`, no category implies `developer:manage`, and
 * cross-tenant access is structurally out of scope because subjects are
 * resolved server-side upstream of this module.
 */

import { Injectable } from '@nestjs/common';

import {
  assertScopesCovered,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  parseScopeList,
  scopesIntersect,
  validateScopes,
} from './developer.types';

export interface ScopeResolutionInput {
  applicationScopes: string[];
  policyAllowedScopes: string[];
  /** Scopes the authenticated subject (user/service) holds upstream. */
  subjectScopes: string[];
}

export interface ScopeResolution {
  effective: string[];
  applicationContribution: string[];
  policyContribution: string[];
  subjectContribution: string[];
}

@Injectable()
export class DeveloperScopeService {
  /** Pure intersection; empty result is a VALID outcome, not an error. */
  resolve(input: ScopeResolutionInput): ScopeResolution {
    const applicationContribution = parseScopeList(input.applicationScopes);
    const policyContribution = parseScopeList(input.policyAllowedScopes);
    const subjectContribution = parseScopeList(input.subjectScopes);
    const effective = scopesIntersect(
      scopesIntersect(applicationContribution, policyContribution),
      subjectContribution,
    ).sort();
    return {
      effective,
      applicationContribution: [...applicationContribution].sort(),
      policyContribution: [...policyContribution].sort(),
      subjectContribution: [...subjectContribution].sort(),
    };
  }

  /** Throws when a requested scope set contains unknown names (CHECK 11). */
  validateRequestable(requested: string[]): string[] {
    return validateScopes(requested);
  }

  /** Throws SCOPE_ESCALATION unless `effective` covers `requested` (CHECK 12). */
  authorizeRequest(requested: string[], effective: string[]): string[] {
    const normalized = validateScopes(requested);
    assertScopesCovered(normalized, effective);
    return normalized;
  }

  /**
   * Application-scope changes: the new set must itself be valid and inside
   * the tenant policy ceiling. Privilege escalation through an app update
   * is impossible because policy ∩ subject is enforced at every use, but the
   * declared set is still bounded here for defense in depth.
   */
  assertApplicationScopeChange(requested: string[], policyAllowedScopes: string[]): string[] {
    const normalized = validateScopes(requested);
    const ceiling = new Set(parseScopeList(policyAllowedScopes));
    const outside = normalized.filter((scope) => !ceiling.has(scope));
    if (outside.length > 0) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        `tenant policy does not grant scope(s): ${outside.join(', ')}`,
        { outside: outside.sort() },
      );
    }
    return normalized;
  }

  /**
   * Token issuance bound (CHECK 20): token scopes must be a SUBSET of the
   * consented grant scopes, which are themselves a subset of the effective
   * intersection. Reduction by the user at consent time is ALLOWED (that is
   * the point of consent); expansion never is.
   */
  assertTokenScopesBounded(requested: string[], effective: string[]): string[] {
    const normalized = parseScopeList(requested);
    const effectiveSet = new Set(parseScopeList(effective));
    const expanded = normalized.filter((scope) => !effectiveSet.has(scope));
    if (expanded.length > 0) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_ESCALATION,
        'token scopes exceed the consented grant',
        { expanded: expanded.sort() },
      );
    }
    return [...new Set(normalized)].sort();
  }
}
