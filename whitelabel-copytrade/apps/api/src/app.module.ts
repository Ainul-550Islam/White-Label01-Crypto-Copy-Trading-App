import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { I18nModule } from './infrastructure/i18n/i18n.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BillingModule } from './modules/billing/billing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { RiskModule } from './modules/risk/risk.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ExchangesModule } from './modules/exchanges/exchanges.module';
import { CopyTradingModule } from './modules/copy-trading/copy-trading.module';
import { ResearchModule } from './modules/research/research.module';
import { RiskManagementModule } from './modules/risk-management/risk-management.module';
import { OmsModule } from './modules/oms/oms.module';
import { OperationsModule } from './modules/operations/operations.module';
import { PortfolioAccountingModule } from './modules/portfolio-accounting/portfolio-accounting.module';
import { ClientLifecycleModule } from './modules/client-lifecycle/client-lifecycle.module';
import { CustodyModule } from './modules/custody/custody.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { TenantGuard } from './modules/tenants/guards/tenant.guard';
import { FeatureFlagGuard } from './modules/feature-flags/guards/feature-flag.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TraceMiddleware } from './infrastructure/tracing/trace.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * Root module.
 *
 * Cross-cutting behaviour is registered once here as global providers so that
 * feature modules stay focused on their domain:
 *   - validation pipe        -> rejects malformed input before controllers run
 *   - exception filters      -> uniform, stack-trace-free error envelopes
 *   - response interceptor   -> uniform success envelopes
 *   - guards (order matters) -> throttling, then authN, then tenancy, then authZ
 */
@Module({
  imports: [
    AppConfigModule,
    // Dynamic on purpose: see the comment in logger.module.ts. Calling
    // forRoot() here (rather than importing a statically configured module)
    // guarantees every @InjectPinoLogger context has been registered first.
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    I18nModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    QueueModule,
    HealthModule,
    AuditModule,
    SecurityModule,
    RbacModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    FeatureFlagsModule,
    BillingModule,
    ComplianceModule,
    NotificationsModule,
    RealtimeModule,
    ExecutionModule,
    StrategyModule,
    DatasetsModule,
    RiskModule,
    ObservabilityModule,
    ExchangesModule,
    CopyTradingModule,
    ResearchModule,
    RiskManagementModule,
    OmsModule,
    OperationsModule,
    PortfolioAccountingModule,
    ClientLifecycleModule,
    CustodyModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    // Guards execute in registration order.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // TraceMiddleware FIRST: the server span brackets the whole pipeline
      // (correlation and tenant resolution included), so a 401 from the
      // auth guard is still a span with a status - requests that never reach
      // a handler are precisely the ones an incident review asks about.
      .apply(TraceMiddleware, RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
