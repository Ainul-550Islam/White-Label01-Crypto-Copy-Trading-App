import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';
import { ServiceHealthIndicator } from './indicators/service.health';
import { TradingReadinessService } from './trading-readiness.service';

/**
 * Liveness and readiness.
 *
 * Three distinct probes, because conflating them causes outages:
 *   /health        - cheap liveness; is the process alive?
 *   /health/ready  - readiness; can it serve traffic (DB + Redis reachable)?
 *   /health/deep   - operator view; includes downstream services and queues.
 *   /health/trading - trading-readiness verdict: the merged gate table the
 *                    operations panel shows, fail-closed on missing evidence.
 *                    Reporting only - the risk gate decides, not this probe.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    PrismaHealthIndicator,
    RedisHealthIndicator,
    QueueHealthIndicator,
    ServiceHealthIndicator,
    TradingReadinessService,
  ],
  exports: [HealthService, TradingReadinessService],
})
export class HealthModule {}
