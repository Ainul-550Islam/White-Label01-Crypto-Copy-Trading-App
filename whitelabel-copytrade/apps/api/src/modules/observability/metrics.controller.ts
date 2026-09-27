import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
  Optional,
} from '@nestjs/common';
import {
  FAULT_METRICS_EXPORT,
  TracingService,
} from '../../infrastructure/tracing/tracing.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PROMETHEUS_CONTENT_TYPE } from '@wlct/config';

import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';

import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { ObservabilityService } from './observability.service';

/**
 * The Prometheus scrape endpoint.
 *
 * Auth posture follows the deployment rules of the spec exactly: metrics are
 * served UNAUTHENTICATED only where the architecture isolates the surface -
 * here that means the compose file publishes NO metrics port (the API port
 * serves /api and /health only when you deploy as shipped, and /metrics is
 * reachable on the internal listener). Where a deployment must share a
 * listener, set METRICS_TOKEN and every scrape needs the matching
 * `x-metrics-token` header, compared in constant time. In PRODUCTION the
 * environment validation requires METRICS_TOKEN to exist at all, so the
 * unauthenticated shape is a development-only convenience that cannot be
 * shipped by accident.
 *
 * The payload itself is guaranteed boring: only allow-listed label sets
 * ever reach the registry (see MetricsRegistry), and the safety spec greps
 * the rendered text for order ids, request ids and credential shapes in
 * every test run, because "the policy says so" deserves a test that the
 * policy is actually what the bytes look like.
 */
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
@Public()
export class MetricsController {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly observability: ObservabilityService,
    private readonly config: AppConfigService,
    @Optional() private readonly tracing?: TracingService,
  ) {}

  @Get()
  @Header('content-type', PROMETHEUS_CONTENT_TYPE)
  @ApiExcludeEndpoint()
  async metrics(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('format') format: string | undefined,
  ): Promise<string> {
    if (!this.config.metricsEnabled || !this.config.prometheusEnabled) {
      throw new ServiceUnavailableException({
        code: 'METRICS_DISABLED',
        message:
          'Metrics exposition is disabled in this configuration. It cannot be disabled in production; ' +
          'if you are seeing this there, the deployment is misconfigured and the panel says so.',
      });
    }
    this.assertToken(request);
    // Part 10: the metrics-side fault point refuses the SCRAPE while armed -
    // the exporter keeps counting into its registry, and a collector that
    // cannot scrape sees a scrape failure, which is exactly the outage the
    // metric for this fault exists to prove. Config-armed only; there is no
    // way to reach this branch from any API write.
    if (this.tracing?.consumeFault(FAULT_METRICS_EXPORT) === true) {
      throw new ServiceUnavailableException({
        code: 'METRICS_EXPORT_UNAVAILABLE',
        message: 'Fault injection armed for metrics export (test deployments only).',
      });
    }
    response.setHeader('Cache-Control', 'no-store');

    await this.observability.sampleDerivedGauges(this.registry);
    this.registry.sampleProcess();
    const text = this.registry.render();
    if (format === 'compact') {
      // Debug aid for humans curling the endpoint; scrapers never send it.
      return text.replace(/# HELP[^\n]*\n/g, '');
    }
    return text;
  }

  private assertToken(request: Request): void {
    const expected = this.config.metricsToken;
    if (expected === undefined) {
      if (this.config.isProduction) {
        // Unreachable while env validation holds; kept as defence in depth
        // for configs assembled outside the standard bootstrap.
        throw new ServiceUnavailableException({
          code: 'METRICS_TOKEN_MISSING',
          message: 'METRICS_TOKEN is required in production; refusing an unauthenticated exposition.',
        });
      }
      return;
    }
    const presented = request.headers['x-metrics-token'];
    const value = Array.isArray(presented) ? presented[0] : presented;
    if (typeof value !== 'string' || !constantTimeEquals(value, expected)) {
      throw new ServiceUnavailableException({
        code: 'METRICS_UNAUTHORIZED',
        message: 'A valid x-metrics-token header is required for the metrics exposition.',
      });
    }
  }
}

/** The token comparison is constant-time on purpose; a metrics endpoint is
 *  not exempt from basic auth hygiene just because its payload is aggregate.
 *  Length mismatches short-circuit timingSafeEqual, so compare lengths
 *  explicitly first (that leaks only the length, which is fine here). */
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
};
