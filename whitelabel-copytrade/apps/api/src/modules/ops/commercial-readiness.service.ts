// # Responsibility: runs bounded live control-plane checks and reports explicit buyer-facing readiness limits.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class CommercialReadinessService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly queues: QueueService) {}

  async evaluate() {
    const generatedAt = new Date().toISOString();
    const checks = await Promise.all([
      (async () => { const started = Date.now(); try { await this.prisma.$queryRaw`SELECT 1`; return { id: 'postgres', status: 'PASS' as const, observedAt: new Date().toISOString(), durationMs: Date.now()-started }; } catch { return { id: 'postgres', status: 'FAIL' as const, observedAt: new Date().toISOString(), durationMs: Date.now()-started, detail: 'database probe failed' }; } })(),
      (async () => { const started = Date.now(); try { const r = await this.redis.healthCheck(); return { id: 'redis', status: r.ok ? 'PASS' as const : 'FAIL' as const, observedAt: new Date().toISOString(), durationMs: r.latencyMs }; } catch { return { id: 'redis', status: 'FAIL' as const, observedAt: new Date().toISOString(), durationMs: Date.now()-started, detail: 'redis probe failed' }; } })(),
      (async () => { const started = Date.now(); try { const depths = await this.queues.getDepths(); return { id: 'background-queues', status: 'PASS' as const, observedAt: new Date().toISOString(), durationMs: Date.now()-started, queueCount: depths.length, waiting: depths.reduce((n,q)=>n+q.waiting,0), failed: depths.reduce((n,q)=>n+q.failed,0) }; } catch { return { id: 'background-queues', status: 'FAIL' as const, observedAt: new Date().toISOString(), durationMs: Date.now()-started, detail: 'queue probe failed' }; } })(),
    ]);
    const blockers = checks.filter(c => c.status !== 'PASS').map(c => c.id);
    return {
      generatedAt,
      status: blockers.length ? 'BLOCKED' : 'CONTROL_PLANE_RESPONDING',
      checks,
      evidenceScope: 'Live control-plane evidence observed during this request only.',
      blockers,
      buyerScope: 'Live checks are limited to PostgreSQL, Redis, and BullMQ observability at request time.',
      exclusions: ['No certification of exchange connectivity, real-money execution, legal or regulatory compliance, security audit, disaster recovery, backup restore, or production SLA.', 'A passing response is not a launch approval or due-diligence substitute.'],
      prerequisites: ['Run release CI on the exact release commit.', 'Verify migrations, backups, restore, RLS and tenant isolation in staging.', 'Complete legal, licensing, privacy and security review.', 'Keep live trading disabled until venue-by-venue enablement approval.'],
    };
  }
}
