import { Module, Global, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { EnforcementModule } from '../billing/enforcement/enforcement.module';
import { ExecutionModule } from '../execution/execution.module';
// OmsModule exports TradeLifecycleService, which the fill sync applies each created fill to inside
// the same transaction as the fill insert. OmsModule already imports this module through a
// forwardRef, so the cycle needs the forwardRef on this side too.
import { OmsModule } from '../oms/oms.module';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAccountService } from './exchange-account.service';
import { ExchangeConnectivityService } from './exchange-connectivity.service';
import { ExchangeBalanceSyncService } from './exchange-balance-sync.service';
import { ExchangePositionSyncService } from './exchange-position-sync.service';
import { ExchangeOrderSyncService } from './exchange-order-sync.service';
import { ExchangeHealthService } from './exchange-health.service';
import { AccountCapabilityHealthService } from './account-capability-health.service';
import { ExchangeRateLimitService } from './exchange-rate-limit.service';
import { ExchangeSymbolService } from './exchange-symbol.service';
import { ExchangeRoutingService } from './exchange-routing.service';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangesController } from './exchanges.controller';
import { ExchangeUserStreamService } from './exchange-user-stream.service';
import { ExchangeUserStreamController } from './exchange-user-stream.controller';
import { VenueClockService } from './venue-clock.service';
import { VenueStatusService } from './venue-status.service';
import { VenueStatusController } from './venue-status.controller';
import { VenueStatusAdminController } from './venue-status-admin.controller';
import { ExchangeUserStreamAdminController } from './exchange-user-stream-admin.controller';

/**
 * NestJS module wiring for registry, providers, credential service, account repository/service, sync services, health, rate limits, symbols, routing, audit, DTOs, and integrations.
 * Integrates with BillingModule, EnforcementModule, ComplianceModule, SecurityModule, ExecutionEngine, distributed locks, live enablement, audit, secret manager.
 * Use forwardRef only where actual dependency graph requires it.
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule, CryptoModule, EnforcementModule, forwardRef(() => ExecutionModule), forwardRef(() => OmsModule)],
  providers: [
    // GAP-73: the capability matrix is computed on read, so it is a provider and not
    // a cached row. Built by a factory rather than reflected: its only constructor
    // argument is an options object with defaults (evidence age, failure
    // threshold, clock), which Nest cannot resolve as a dependency.
    {
      provide: AccountCapabilityHealthService,
      useFactory: () => new AccountCapabilityHealthService(),
    },
    ExchangeRegistryService,
    ExchangeProviderFactory,
    ExchangeCredentialService,
    ExchangeAccountRepository,
    ExchangeAccountService,
    ExchangeConnectivityService,
    ExchangeBalanceSyncService,
    ExchangePositionSyncService,
    ExchangeOrderSyncService,
    ExchangeHealthService,
    ExchangeRateLimitService,
    ExchangeSymbolService,
    ExchangeRoutingService,
    ExchangeAuditService,
    // GAP-69: the private user-data stream's health, and GAP-70: the venue clock estimate that
    // decides whether a signed request may be built at all.
    ExchangeUserStreamService,
    VenueClockService,
    // GAP-72: normalised venue status (feed + engine health + manual override).
    VenueStatusService,
  ],
  controllers: [
    ExchangesController,
    ExchangeUserStreamController,
    VenueStatusController,
    VenueStatusAdminController,
    ExchangeUserStreamAdminController,
  ],
  exports: [
    ExchangeRegistryService,
    ExchangeProviderFactory,
    ExchangeCredentialService,
    ExchangeAccountRepository,
    ExchangeAccountService,
    ExchangeConnectivityService,
    ExchangeBalanceSyncService,
    ExchangePositionSyncService,
    ExchangeOrderSyncService,
    ExchangeHealthService,
    ExchangeRateLimitService,
    ExchangeSymbolService,
    ExchangeRoutingService,
    ExchangeAuditService,
    ExchangeUserStreamService,
    VenueClockService,
    VenueStatusService,
  ],
})
export class ExchangesModule {}
