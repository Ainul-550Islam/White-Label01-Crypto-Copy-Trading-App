import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { RedisService } from '../../../infrastructure/redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async check(key: string, timeoutMs = 2_000): Promise<HealthIndicatorResult> {
    try {
      const outcome = await Promise.race([
        this.redis.healthCheck(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Redis health check timed out')), timeoutMs),
        ),
      ]);

      if (!outcome.ok) {
        throw new Error('Unexpected PING response');
      }

      return this.getStatus(key, true, { latencyMs: outcome.latencyMs });
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HealthCheckError('Redis is not available', result);
    }
  }
}
