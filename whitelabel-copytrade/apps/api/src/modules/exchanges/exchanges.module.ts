import { Module, Global, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { EnforcementModule } from '../billing/enforcement/enforcement.module';
import { ExecutionModule } from '../execution/execution.module';
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
import { ExchangeRateLimitService } from './exchange-rate-limit.service';
import { ExchangeSymbolService } from './exchange-symbol.service';
import { ExchangeRoutingService } from './exchange-routing.service';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangesController } from './exchanges.controller';

/**
 * NestJS module wiring for registry, providers, credential service, account repository/service, sync services, health, rate limits, symbols, routing, audit, DTOs, and integrations.
 * Integrates with BillingModule, EnforcementModule, ComplianceModule, SecurityModule, ExecutionEngine, distributed locks, live enablement, audit, secret manager.
 * Use forwardRef only where actual dependency graph requires it.
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule, CryptoModule, EnforcementModule, forwardRef(() => ExecutionModule)],
  providers: [
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
  ],
  controllers: [ExchangesController],
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
  ],
})
export class ExchangesModule {}
