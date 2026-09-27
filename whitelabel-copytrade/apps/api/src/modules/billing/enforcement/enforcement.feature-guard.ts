import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EnforcementService } from './enforcement.service';
import { EnforcementContextBuilder } from './enforcement.context';
import {
  type EnforcementActor,
  type EnforcementContext,
  type EnforcementResource,
  type FeatureCheckResult,
} from './enforcement.types';

/**
 * Generic feature-level enforcement guard.
 *
 * Works with any feature key defined in the plan's `features` array or the
 * `PlanLimits` boolean fields.  No plan names are hardcoded; the guard
 * resolves entitlement dynamically from the tenant's current subscription.
 *
 * Usage from an application service:
 *
 *   const result = await this.featureGuard.check(actor, 'customDomain');
 *   if (!result.allowed) { … }
 *
 *   // or strict mode:
 *   await this.featureGuard.require(actor, 'customDomain'); // throws on deny
 */
@Injectable()
export class EnforcementFeatureGuard {
  constructor(
    private readonly enforcement: EnforcementService,
    private readonly contextBuilder: EnforcementContextBuilder,
    @InjectPinoLogger(EnforcementFeatureGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Check whether the tenant's current plan includes the given feature.
   * Returns a machine-readable allow/deny result.
   */
  async check(
    actor: EnforcementActor,
    featureKey: string,
    resource?: EnforcementResource,
  ): Promise<FeatureCheckResult> {
    const ctx = await this.contextBuilder.build(actor, resource);
    return this.enforcement.checkFeature(ctx, featureKey, { actorId: actor.userId });
  }

  /**
   * Require the feature or throw `FeatureNotIncludedError`.
   *
   * Use this in code paths where the caller cannot proceed without the feature.
   */
  async require(
    actor: EnforcementActor,
    featureKey: string,
    resource?: EnforcementResource,
  ): Promise<void> {
    const ctx = await this.contextBuilder.build(actor, resource);
    await this.enforcement.checkFeature(ctx, featureKey, {
      strict: true,
      actorId: actor.userId,
    });
  }

  /**
   * Check multiple features; returns a map of feature key → result.
   * Useful for UI feature-flag hydration.
   */
  async checkMany(
    actor: EnforcementActor,
    featureKeys: string[],
  ): Promise<Map<string, FeatureCheckResult>> {
    const ctx = await this.contextBuilder.build(actor);
    const results = new Map<string, FeatureCheckResult>();

    for (const key of featureKeys) {
      const result = await this.enforcement.checkFeature(ctx, key, { actorId: actor.userId });
      results.set(key, result);
    }

    return results;
  }

  /**
   * Check that the tenant has ALL of the listed features.
   * Returns the first denied feature, or null if all are allowed.
   */
  async requireAll(
    actor: EnforcementActor,
    featureKeys: string[],
  ): Promise<FeatureCheckResult | null> {
    const ctx = await this.contextBuilder.build(actor);

    for (const key of featureKeys) {
      const result = await this.enforcement.checkFeature(ctx, key, {
        strict: true,
        actorId: actor.userId,
      });
      if (!result.allowed) {
        return result;
      }
    }

    return null;
  }
}
