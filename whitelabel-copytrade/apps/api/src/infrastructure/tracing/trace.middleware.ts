/**
 * Part 10: the API's server-span middleware - the Nest twin of the
 * correlation middleware both Python services run.
 *
 * It does exactly four things, none of them in the way of a request:
 * extract-or-create the trace context, echo x-trace-id on the response,
 * run the rest of the pipeline inside the AsyncLocalStorage span store (so
 * the queue service can attach a sidecar to anything published in-request),
 * and finish the span once the response is done. Route template, status and
 * error-ness come from the SAME signals the metrics interceptor reads - one
 * event source, two consumers, no drift between what the histogram says and
 * what the span says.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { TRACE_ID_RESPONSE_HEADER } from '@wlct/config';

import type { AppRequest } from '../../common/types/request.types';

import { TracingService, type SpanHandle } from './tracing.service';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly tracing: TracingService) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    if (!this.tracing.enabled) {
      next();
      return;
    }
    const handle = this.tracing.startRequestSpan(req.headers);
    if (handle === null) {
      next();
      return;
    }
    const traceId = this.tracing.responseTraceId(handle);
    if (traceId !== null) {
      res.setHeader(TRACE_ID_RESPONSE_HEADER, traceId);
    }
    const started = performance.now();
    res.once('finish', () => {
      this.tracing.finishRequestSpan(handle as SpanHandle, {
        method: req.method ?? 'GET',
        route: routeTemplate(req),
        status: res.statusCode,
        durationMs: Math.max(0, performance.now() - started),
      });
    });
    void this.tracing.spanStore.run(handle, () => {
      next();
    });
  }
}

/** The interceptor's template rule, shared honestly: matched route path or
 *  the sentinel. If this and HttpMetricsInterceptor's copy ever disagree,
 *  spans and histograms describe different routes - the parity spec pins
 *  both against the same helper semantics. */
const routeTemplate = (request: AppRequest): string => {
  const route = (request as { route?: { path?: unknown } }).route;
  const path = typeof route?.path === 'string' ? route.path : null;
  if (path === null) {
    return 'unmatched';
  }
  const trimmed = path.replace(/^\//, '').slice(0, 96);
  return trimmed.length > 0 ? trimmed : 'root';
};
