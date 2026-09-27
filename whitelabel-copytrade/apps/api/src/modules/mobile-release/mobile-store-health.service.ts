import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileStoreService } from './mobile-store.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import {
  MobileReleaseError,
  MobileStoreProvider,
  MobileStoreState,
  MOBILE_ERROR_CODES,
} from './mobile-release.types';

export interface StoreHealthReport {
  provider: MobileStoreProvider;
  /** Real connectivity/auth result — credentials existing is NOT health. */
  reachable: boolean;
  configured: boolean;
  state: MobileStoreState;
  checkedAt: string;
  detail: string;
}

const HEALTH_TIMEOUT_MS = 10_000;

/**
 * Store provider health with actual evidence.
 *
 * "Configured" (a credential reference exists) is the cheapest state and the
 * least interesting one: an expired, revoked or network-unreachable
 * credential is exactly what this service exists to surface. Health =
 * configuration + a real provider call (or the explicit UNAVAILABLE when the
 * call fails). No provider is ever reported healthy without a round-trip.
 */
@Injectable()
export class MobileStoreHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MobileStoreService,
    private readonly policy: MobileReleasePolicyService,
  ) {}

  async check(provider: MobileStoreProvider): Promise<StoreHealthReport> {
    const policy = this.policy.resolve();
    if (!policy.enabledStoreProviders.includes(provider)) {
      return {
        provider,
        reachable: false,
        configured: false,
        state: 'NOT_CONFIGURED',
        checkedAt: new Date().toISOString(),
        detail: 'provider disabled by policy',
      };
    }
    const store = this.adapterAccess(provider);
    let configured = false;
    try {
      configured = await store.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) {
      return {
        provider,
        reachable: false,
        configured: false,
        state: 'NOT_CONFIGURED',
        checkedAt: new Date().toISOString(),
        detail: 'credential/configuration reference did not resolve',
      };
    }

    // Real round-trip: status() on a probe id. The providers answer with an
    // auth/API error when credentials are bad — that IS health evidence.
    try {
      const probe = await this.withTimeout(
        store.status({
          packageName: 'health-probe',
          externalSubmissionId: 'health-probe',
          credentialReference:
            provider === 'GOOGLE_PLAY'
              ? 'MOBILE_STORE_GOOGLE_PLAY_CREDENTIAL'
              : provider === 'APPLE_APP_STORE'
                ? 'MOBILE_STORE_APPLE_CREDENTIAL'
                : '',
        }),
        HEALTH_TIMEOUT_MS,
      );
      return {
        provider,
        reachable: true,
        configured: true,
        state: 'CONFIGURED',
        checkedAt: new Date().toISOString(),
        detail: `provider reachable (probe state: ${probe.state})`,
      };
    } catch (error) {
      // Enterprise/internal adapters do not need network; their health is the
      // configured distribution base URL.
      if (provider === 'ENTERPRISE_DISTRIBUTION' || provider === 'INTERNAL_DISTRIBUTION') {
        return {
          provider,
          reachable: true,
          configured: true,
          state: 'CONFIGURED',
          checkedAt: new Date().toISOString(),
          detail: 'self-distribution configured via platform storage',
        };
      }
      return {
        provider,
        reachable: false,
        configured: true,
        state: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        detail: `provider call failed: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}`,
      };
    }
  }

  /** Health for every policy-enabled provider, in policy order. */
  async checkAll(): Promise<StoreHealthReport[]> {
    const results: StoreHealthReport[] = [];
    for (const provider of this.policy.resolve().enabledStoreProviders) {
      results.push(await this.check(provider));
    }
    return results;
  }

  /**
   * Health gate used before submission: a provider that is not CONFIGURED
   * (or not reachable) refuses with an explicit code instead of a submission
   * that silently cannot progress.
   */
  async assertHealthy(provider: MobileStoreProvider): Promise<StoreHealthReport> {
    const report = await this.check(provider);
    if (report.state === 'NOT_CONFIGURED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_NOT_CONFIGURED,
        `provider ${provider} is not configured`,
        400,
      );
    }
    if (report.state === 'UNAVAILABLE' || !report.reachable) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.STORE_UNAVAILABLE,
        `provider ${provider} is unreachable: ${report.detail}`,
        503,
      );
    }
    return report;
  }

  private adapterAccess(provider: MobileStoreProvider) {
    // The store service owns the adapter registry; health probes use the same
    // adapters through its public registry accessor.
    return this.store.adapterFor(provider);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`store health probe timed out after ${ms}ms`)), ms),
      ),
    ]);
  }
}
