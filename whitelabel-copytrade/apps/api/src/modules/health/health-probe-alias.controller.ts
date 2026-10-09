import { Controller, Get, HttpCode, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * Kubernetes-conventional probe aliases.
 *
 * `/health` and `/health/ready` are the platform's canonical probes and stay the
 * documented ones. These aliases exist because a large amount of off-the-shelf
 * infrastructure hard-codes the short names: Helm charts defaulting
 * `livenessProbe.httpGet.path` to `/healthz`, ingress controllers and managed
 * load balancers with `/healthz` and `/readyz` fields, and `kubeadm`-era runbooks.
 * Without them an operator has to discover the non-standard path before a probe
 * passes, and a probe that 404s is treated as a failing probe - it will restart
 * healthy pods.
 *
 * Both routes delegate to exactly the same checks the canonical probes use, so
 * they can never report a different verdict:
 *   GET /healthz -> liveness  (process only, no dependency touched)
 *   GET /readyz  -> readiness (PostgreSQL and Redis, 503 when either is down)
 *
 * Registered VERSION_NEUTRAL and listed in the `setGlobalPrefix` exclude list in
 * `main.ts`, for the same reasons the canonical probes are: an orchestrator must
 * not have to track an API version or the `/api` prefix.
 */
@ApiTags('Health')
@Controller({ path: '', version: VERSION_NEUTRAL })
@Public()
@SkipThrottle()
export class HealthProbeAliasController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe alias',
    description: 'Identical verdict to GET /health. Returns 200 whenever the process is running.',
  })
  @ApiOkResponse({ description: 'The process is alive.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe alias',
    description: 'Identical verdict to GET /health/ready. Returns 503 when PostgreSQL or Redis is unavailable.',
  })
  @ApiOkResponse({ description: 'Aggregated readiness result.' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.check('database'),
      () => this.redisIndicator.check('redis'),
    ]);
  }
}
