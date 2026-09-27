export { EnforcementScope, EnforcementType, EnforcementDecisionCode } from './enforcement.types';
export type {
  TenantBillingContext,
  EnforcementActor,
  EnforcementResource,
  EnforcementContext,
  FeatureCheckResult,
  QuotaCheckResult,
  UsageSnapshot,
  EnforcementDecision,
} from './enforcement.types';

export { EnforcementContextBuilder } from './enforcement.context';
export {
  FeatureNotIncludedError,
  PlanLimitExceededError,
  UsageUnavailableError,
  SubscriptionInactiveError,
  TenantBillingContextError,
  RateLimitExceededError,
} from './enforcement.errors';
export { EnforcementService } from './enforcement.service';
export { EnforcementResolver } from './enforcement.resolver';
export { EnforcementAuditService, EnforcementAuditAction } from './enforcement.audit';
export { EnforcementFeatureGuard } from './enforcement.feature-guard';
export { EnforcementLimitGuard } from './enforcement.limit-guard';

export { UsageScope } from './usage.types';
export type {
  UserUsage,
  TraderUsage,
  FollowerUsage,
  ExchangeAccountUsage,
  CopySubscriptionUsage,
  ApiRequestUsage,
  WebsocketUsage,
  UsageRecord,
  IncrementUsageInput,
  DecrementUsageInput,
  ReserveUsageInput,
  ReserveUsageResult,
} from './usage.types';
export { UsageRepository } from './usage.repository';
export { UsageService } from './usage.service';
export { UsageCounter } from './usage.counter';

export { RateLimitService } from './rate-limit.service';
export { ApiRateLimitGuard } from './api-rate-limit.guard';
export { WebsocketLimitGuard } from './websocket-limit.guard';
export { PlanLimitUsersGuard } from './plan-limit-users.guard';
export { PlanLimitTradersGuard } from './plan-limit-traders.guard';
export { PlanLimitFollowersGuard } from './plan-limit-followers.guard';
export { PlanLimitExchangeAccountsGuard } from './plan-limit-exchange-accounts.guard';
export { PlanLimitCopySubscriptionsGuard } from './plan-limit-copy-subscriptions.guard';

export { EnforcementModule } from './enforcement.module';
