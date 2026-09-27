import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Verifies the database is reachable and responsive.
 *
 * A plain `SELECT 1` is used rather than a model query so the probe never
 * depends on schema state and cannot be affected by row-level data.
 */
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async check(key: string, timeoutMs = 2_000): Promise<HealthIndicatorResult> {
    const startedAt = Date.now();

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Database health check timed out')), timeoutMs),
        ),
      ]);

      return this.getStatus(key, true, { latencyMs: Date.now() - startedAt });
    } catch (error) {
      const result = this.getStatus(key, false, {
        latencyMs: Date.now() - startedAt,
        // Only the error class is exposed; messages can leak connection strings.
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HealthCheckError('Database is not available', result);
    }
  }
}
