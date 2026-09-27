import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';

import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementResolver } from './enforcement.resolver';
import { EnforcementAuditService } from './enforcement.audit';
import { EnforcementService } from './enforcement.service';
import { EnforcementFeatureGuard } from './enforcement.feature-guard';
import { EnforcementLimitGuard } from './enforcement.limit-guard';
import { UsageRepository } from './usage.repository';
import { UsageService } from './usage.service';
import { UsageCounter } from './usage.counter';
import { RateLimitService } from './rate-limit.service';
import { ApiRateLimitGuard } from './api-rate-limit.guard';
import { WebsocketLimitGuard } from './websocket-limit.guard';
import { PlanLimitUsersGuard } from './plan-limit-users.guard';
import { PlanLimitTradersGuard } from './plan-limit-traders.guard';
import { PlanLimitFollowersGuard } from './plan-limit-followers.guard';
import { PlanLimitExchangeAccountsGuard } from './plan-limit-exchange-accounts.guard';
import { PlanLimitCopySubscriptionsGuard } from './plan-limit-copy-subscriptions.guard';

/**
 * Runtime Entitlement & Limit Enforcement Module.
 *
 * Part 2 owns the enforcement layer that enforces existing billing plan data.
 * It does NOT own payment processing (Stripe/NowPayments) — that remains in a
 * later commercial part.
 *
 * This module provides:
 *  - EnforcementContextBuilder: assembles TenantBillingContext from Prisma+Cache with 30s TTL
 *  - EnforcementResolver: resolves plan limits/features with caching
 *  - EnforcementService: core checkFeature() and checkLimit() with deterministic decisions
 *  - EnforcementFeatureGuard: generic feature entitlement (customDomain, whiteLabelMobileApp, prioritySupport)
 *  - EnforcementLimitGuard: generic numeric quota guard
 *  - UsageRepository: Redis-backed counters with atomic Lua scripts
 *  - UsageService: business layer for usage + reservation
 *  - UsageCounter: atomic Lua counters with idempotency support
 *  - RateLimitService: fixed-window API rate limiting (60s)
 *  - ApiRateLimitGuard: NestJS CanActivate guard for API rate limits
 *  - WebsocketLimitGuard: WebSocket connection reservation/release
 *  - PlanLimitUsersGuard: maxUsers (tenant-scoped)
 *  - PlanLimitTradersGuard: maxTraders (tenant-scoped)
 *  - PlanLimitFollowersGuard: maxFollowersPerTrader (per-trader scoped)
 *  - PlanLimitExchangeAccountsGuard: maxExchangeAccountsPerUser (per-user scoped)
 *  - PlanLimitCopySubscriptionsGuard: maxCopySubscriptionsPerFollower (per-follower scoped)
 *
 * Critical constraints enforced:
 *  - No hardcoded plan names or numeric limits — resolves from plan catalog
 *  - Atomic quota operations via Lua scripts (prevent race-condition over-allocation)
 *  - Concurrency-safe reservation pattern with release on failure
 *  - Reuses existing Part 1 billing types and services
 *  - All decisions deterministic and machine-readable
 *  - No secrets/credentials in audit logs or error messages
 */
@Module({
  imports: [PrismaModule],
  providers: [
    EnforcementContextBuilder,
    EnforcementResolver,
    EnforcementAuditService,
    EnforcementService,
    EnforcementFeatureGuard,
    EnforcementLimitGuard,
    UsageRepository,
    UsageService,
    UsageCounter,
    RateLimitService,
    ApiRateLimitGuard,
    WebsocketLimitGuard,
    PlanLimitUsersGuard,
    PlanLimitTradersGuard,
    PlanLimitFollowersGuard,
    PlanLimitExchangeAccountsGuard,
    PlanLimitCopySubscriptionsGuard,
  ],
  exports: [
    EnforcementContextBuilder,
    EnforcementResolver,
    EnforcementAuditService,
    EnforcementService,
    EnforcementFeatureGuard,
    EnforcementLimitGuard,
    UsageRepository,
    UsageService,
    UsageCounter,
    RateLimitService,
    ApiRateLimitGuard,
    WebsocketLimitGuard,
    PlanLimitUsersGuard,
    PlanLimitTradersGuard,
    PlanLimitFollowersGuard,
    PlanLimitExchangeAccountsGuard,
    PlanLimitCopySubscriptionsGuard,
  ],
})
export class EnforcementModule {}
