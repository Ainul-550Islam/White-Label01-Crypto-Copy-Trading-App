import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

/**
 * HTTP probe for downstream services (trading engine, market data, notification
 * worker). Uses the platform `fetch` with an abort timeout so a hung dependency
 * can never hang the health endpoint itself.
 */
@Injectable()
export class ServiceHealthIndicator extends HealthIndicator {
  async check(key: string, url: string, timeoutMs = 2_000): Promise<HealthIndicatorResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Unhealthy status ${response.status}`);
      }

      return this.getStatus(key, true, { latencyMs: Date.now() - startedAt, url });
    } catch (error) {
      const result = this.getStatus(key, false, {
        latencyMs: Date.now() - startedAt,
        url,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HealthCheckError(`${key} is not available`, result);
    } finally {
      clearTimeout(timer);
    }
  }
}
