import { Controller, Get, HttpCode, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { AppConfigService } from '../../config/app-config.service';
import { HealthService, type BuildInfo } from './health.service';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';
import { ServiceHealthIndicator } from './indicators/service.health';
import { TradingReadinessService } from './trading-readiness.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Health endpoints.
 *
 * Registered without an API version prefix and without the global `/api`
 * prefix, so every route is reachable at exactly `/health*`. Orchestrators,
 * load balancers and container HEALTHCHECKs should never have to track an API
 * version, and `docker-compose.yml`, the Dockerfiles and the *_HEALTH_PATH
 * environment defaults all assume that bare path.
 *
 * Two settings are required to achieve it and BOTH must stay in place:
 *   1. `VERSION_NEUTRAL` here - otherwise URI versioning rewrites the routes to
 *      `/v1/health` even though the global prefix was excluded.
 *   2. the matching `exclude` list passed to `setGlobalPrefix()` in main.ts -
 *      Nest matches those entries literally, so every sub-route has to be
 *      listed individually.
 *
 * All routes are public and exempt from rate limiting; they expose no tenant
 * data.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthService: HealthService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly queueIndicator: QueueHealthIndicator,
    private readonly serviceIndicator: ServiceHealthIndicator,
    private readonly readiness: TradingReadinessService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 whenever the process is running. Never touches a dependency.',
  })
  @ApiOkResponse({ description: 'Build and runtime information.' })
  live(): { status: 'ok'; info: BuildInfo; memory: Record<string, number> } {
    return {
      status: 'ok',
      info: this.healthService.getBuildInfo(),
      memory: this.healthService.getMemoryUsage(),
    };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks the dependencies required to serve a request: PostgreSQL and Redis. Returns 503 when either is unavailable.',
  })
  @ApiOkResponse({ description: 'Aggregated readiness result.' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.check('database'),
      () => this.redisIndicator.check('redis'),
    ]);
  }

  @Get('deep')
  @HttpCode(HttpStatus.OK)
  @HealthCheck()
  @ApiOperation({
    summary: 'Operator health check',
    description:
      'Readiness plus queue backlog and the downstream Python services. Intended for dashboards, not for load-balancer probes.',
  })
  @ApiOkResponse({ description: 'Aggregated deep health result.' })
  deep(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.check('database'),
      () => this.redisIndicator.check('redis'),
      () => this.queueIndicator.check('queues'),
      () => this.serviceIndicator.check('trading-engine', this.config.tradingEngineHealthUrl),
      () => this.serviceIndicator.check('market-data', this.config.marketDataHealthUrl),
      () =>
        this.serviceIndicator.check('notification-service', this.config.notificationServiceHealthUrl),
    ]);
  }

  @Get('trading')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trading-readiness verdict (reports; never authorises)',
    description:
      'The merged evaluation of the nine platform trading gates: market data, risk engine, risk ' +
      'snapshot freshness, venue connectivity, execution adapter, reconciliation, queues, kill ' +
      'switches and configuration. Fail-closed by construction - missing or stale evidence reads ' +
      'as NOT ready, never as ready. This endpoint has no influence on the risk gate; an order is ' +
      'refused by checks the engine itself runs, regardless of anything said here. Always 200: the ' +
      'verdict lives in the body, because an endpoint that goes 503 when honestly reporting ' +
      '"not ready" invites the orchestrator to kill the messenger during exactly the outage it ' +
      'is describing.',
  })
  @ApiOkResponse({ description: 'Gate-by-gate readiness document.' })
  async trading(): Promise<Awaited<ReturnType<TradingReadinessService['evaluate']>>> {
    return this.readiness.evaluate();
  }

  @Get('startup')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  startup(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
