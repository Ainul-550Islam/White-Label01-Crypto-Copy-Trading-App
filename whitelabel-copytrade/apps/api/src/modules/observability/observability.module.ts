import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AlertsService } from './alerts.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { SloController } from './slo.controller';
import { SloService } from './slo.service';
import { SloSamplesService } from './slo-samples';
import { IncidentsService } from './incidents.service';
import { MetricsController } from './metrics.controller';
import { createMetricsRegistry } from './metrics.registry.provider';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { TELEMETRY_ALERT_SINK, TracingService } from '../../infrastructure/tracing/tracing.service';
import { HealthModule } from '../health/health.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { WorkerCoordinationReadService } from './worker-coordination-read.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  EngineInternalClient,
  engineInternalClientConfigured,
} from '../worker/engine-internal.client';
import { ENGINE_POSTURE_CLIENT, EnginePostureService } from './engine-posture.service';

/** The binding rule, as a named function rather than an inline lambda so the spec can
 * exercise the decision itself instead of describing it. */
export const createEnginePostureClient = (
  config: AppConfigService,
): EngineInternalClient | null =>
  engineInternalClientConfigured(config) ? new EngineInternalClient(config) : null;

/**
 * The Part 9 operations module: metric registry, panels, alert fold,
 * incidents, and the two controllers (v1 operations plane + the versionless
 * Prometheus endpoint).
 *
 * The registry is a per-module singleton created in a factory - one process,
 * one registry, families registered at boot so the label policy is fixed
 * before any request can record into it (registration errors at boot are
 * cheap; refusals at record time are counted and silent, by the same split
 * as the Python registry: programmer errors loud, operational errors safe).
 *
 * This module IMPORTS health (for the readiness service and build info) and
 * is imported by the queue module (for the maintenance sync) - and nothing
 * else imports it. Part 10 adds the tracer (infra/tracing, provided here for
 * want of a home that BOTH the HTTP pipeline and the queue plane can reach)
 * and the SLO module, whose ONLY write paths are its own tables, the burn
 * alert fold, and audit. No middleware joins the pipeline from here: metrics-path
 * request logging is already silenced by the pino autoLogging ignore list. The read-only guarantee the spec demands of the panel is
 * structural: there is no service here that the execution path depends on,
 * in either direction. The dependency arrows point AT the trading plane's
 * published state, never through it.
 */
@Module({
  imports: [HealthModule, RedisModule],
  controllers: [ObservabilityController, MetricsController, SloController],
  providers: [
    // Part 11: read-only worker-plane visibility. Redis comes along because
    // the claims it surfaces are WRITTEN by the worker and merely READ here
    // - the direction that keeps this module's "no execution dependency"
    // guarantee intact.
    WorkerCoordinationReadService,
    // Part 20: the execution engine's posture, read from the engine itself. The client is
    // built here rather than imported from WorkerModule on purpose - that module also
    // provides the queue processor, and this module's guarantee is that no execution
    // dependency points back at the trading plane. A null client is a legal binding, not
    // a fallback: it means this deployment was never configured to reach an engine, and
    // the service renders that as a row instead of assuming health.
    {
      provide: ENGINE_POSTURE_CLIENT,
      useFactory: createEnginePostureClient,
      inject: [AppConfigService],
    },
    EnginePostureService,
    {
      provide: MetricsRegistry,
      useFactory: (): MetricsRegistry => createMetricsRegistry(),
    },
    ObservabilityService,
    AlertsService,
    IncidentsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
    // --- Part 10 ------------------------------------------------------------
    TracingService,
    SloSamplesService,
    SloService,
    {
      // The sink is constructor-injected into AlertsService by THIS factory
      // rather than by TracingService importing AlertsService: the
      // dependency arrow points from telemetry INTO the durable plane, never
      // back, mirroring (in reverse) the one-way mirror rule the engines
      // follow. A process without the sink still traces; it just cannot
      // page anyone - which is what a missing DB connection looks like
      // anyway, and the exporter already survives both.
      provide: TELEMETRY_ALERT_SINK,
      useFactory: (alerts: AlertsService) => ({
        telemetryExportFailing: (service: string, failing: boolean, consecutive: number) =>
          alerts.telemetryExportFailing(service, failing, consecutive),
      }),
      inject: [AlertsService],
    },
  ],
  exports: [
    ObservabilityService,
    WorkerCoordinationReadService,
    EnginePostureService,
    AlertsService,
    IncidentsService,
    MetricsRegistry,
    TracingService,
    SloService,
    SloSamplesService,
  ],
})
export class ObservabilityModule {}
