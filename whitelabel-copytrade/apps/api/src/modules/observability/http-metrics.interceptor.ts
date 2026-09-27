import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

import type { AppRequest } from '../../common/types/request.types';

import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { TracingService } from '../../infrastructure/tracing/tracing.service';

/**
 * HTTP latency and result metrics, on the ROUTE TEMPLATE - never the raw
 * URL. `/v1/accounts/018f.../orders` becomes `v1/accounts/:accountId/orders`
 * because a URL with an id in it is a series per entity, and a series per
 * entity is how a Prometheus server dies. Requests that matched no route
 * (404s, scanners) collapse to the single label value "unmatched".
 *
 * Timings use `performance.now()` (monotonic in Node, per the platform-wide
 * rule that durations never come from Date.now). The observation is recorded
 * in `finally`-equivalent semantics (rxjs `tap` next/error) so a failing
 * request is measured exactly like a succeeding one - failed requests are the
 * ones an operator wants the latency of.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly tracing: TracingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.getType() === 'http';
    if (!http) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<AppRequest>();
    // startTime is stamped by RequestContextMiddleware with Date.now for
    // LOG lines; for the duration histogram we take our own monotonic sample
    // so the measurement never depends on a wall-clock difference.
    const started = performance.now();

    return next.handle().pipe(
      tap({
        next: () => this.observe(request, undefined, started),
        error: () => this.observe(request, 'error', started),
      }),
    );
  }

  private observe(request: AppRequest, errorFlag: 'error' | undefined, started: number): void {
    const response = request.res as unknown as Response | undefined;
    const status = response?.statusCode ?? (errorFlag === 'error' ? 500 : 200);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const route = routeTemplate(request);
    const method = request.method ?? 'GET';
    const seconds = Math.max(0, performance.now() - started) / 1000;
    // Part 10: the SLO request/latency tally rides the SAME observation as
    // the histogram (one event source, two consumers). The note is an O(1)
    // in-memory increment; the Redis write happens on the tracer's loop,
    // never here.
    this.tracing.noteHttpRequest(status, seconds * 1000);

    this.registry.inc(
      'wlct_http_requests_total',
      { method, route, status_class: statusClass },
      1,
    );
    this.registry.observe(
      'wlct_http_request_duration_seconds',
      { method, route, status_class: statusClass },
      seconds,
    );
  }
}

/** Nest records the matched route on `request.route`; anything else (404,
 *  early middleware rejection) gets the sentinel. This indirection is the
 *  entire cardinality defence for the HTTP families. */
const routeTemplate = (request: AppRequest): string => {
  const route = (request as { route?: { path?: unknown } }).route;
  const path = typeof route?.path === 'string' ? route.path : null;
  if (path === null) {
    return 'unmatched';
  }
  const trimmed = path.replace(/^\//, '').slice(0, 96);
  return trimmed.length > 0 ? trimmed : 'root';
};
