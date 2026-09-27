import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { QueueService } from '../queue/queue.service';
import { ReconciliationOrchestratorService } from './reconciliation-orchestrator.service';
import { OperationalAuditService } from './operational-audit.service';
import {
  OperationalReconciliationType,
  OperationalTriggerType,
  deterministicIdempotencyKey,
  redactSecrets,
} from './operations.types';

/**
 * Defines and executes reconciliation schedules using existing scheduler/queue infrastructure.
 * Must support tenant-scoped and platform-scoped runs, idempotency, lock protection, retry policy,
 * and safe failure handling.
 */

@Injectable()
export class ReconciliationScheduleService {
  private readonly logger = new Logger(ReconciliationScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queueService: QueueService,
    private readonly orchestrator: ReconciliationOrchestratorService,
    private readonly auditService: OperationalAuditService,
  ) {}

  // Schedule definitions — reuse existing scheduler/queue infrastructure
  private readonly SCHEDULES: Array<{
    type: OperationalReconciliationType;
    cron: string;
    scope: 'PLATFORM' | 'TENANT';
    description: string;
  }> = [
    { type: OperationalReconciliationType.OMS_ORDER, cron: '*/15 * * * *', scope: 'TENANT', description: 'OMS order reconciliation every 15m per tenant' },
    { type: OperationalReconciliationType.OMS_FILL, cron: '*/15 * * * *', scope: 'TENANT', description: 'OMS fill reconciliation every 15m per tenant' },
    { type: OperationalReconciliationType.OMS_POSITION, cron: '*/30 * * * *', scope: 'TENANT', description: 'OMS position reconciliation every 30m' },
    { type: OperationalReconciliationType.EXCHANGE_ACCOUNT, cron: '0 * * * *', scope: 'TENANT', description: 'Exchange account reconciliation hourly' },
    { type: OperationalReconciliationType.RISK, cron: '*/30 * * * *', scope: 'TENANT', description: 'Risk reconciliation every 30m' },
    { type: OperationalReconciliationType.COMPLIANCE, cron: '0 */6 * * *', scope: 'TENANT', description: 'Compliance reconciliation every 6h' },
    { type: OperationalReconciliationType.COPY_TRADING, cron: '*/30 * * * *', scope: 'TENANT', description: 'Copy trading reconciliation every 30m' },
    { type: OperationalReconciliationType.PAYMENT, cron: '0 */2 * * *', scope: 'PLATFORM', description: 'Payment reconciliation every 2h platform' },
    { type: OperationalReconciliationType.BILLING_FINANCE, cron: '0 2 * * *', scope: 'PLATFORM', description: 'Billing finance reconciliation daily 2am' },
    { type: OperationalReconciliationType.FEE, cron: '0 */4 * * *', scope: 'TENANT', description: 'Fee reconciliation every 4h' },
    { type: OperationalReconciliationType.USAGE, cron: '0 * * * *', scope: 'TENANT', description: 'Usage reconciliation hourly' },
    { type: OperationalReconciliationType.NOTIFICATION, cron: '*/30 * * * *', scope: 'PLATFORM', description: 'Notification reconciliation every 30m platform' },
    { type: OperationalReconciliationType.SUBSCRIPTION, cron: '0 */6 * * *', scope: 'PLATFORM', description: 'Subscription reconciliation every 6h platform' },
  ];

  getSchedules() {
    return this.SCHEDULES;
  }

  async scheduleAll(): Promise<void> {
    // Use existing queue scheduler — do not create second queue implementation
    for (const sched of this.SCHEDULES) {
      try {
        await this.queueService.schedule(
          'MAINTENANCE' as any,
          `reconciliation-${sched.type.toLowerCase()}`,
          {
            type: sched.type,
            scope: sched.scope,
            triggerType: OperationalTriggerType.SCHEDULED,
            correlationId: `sched-${sched.type}-${Date.now()}`,
          },
          sched.cron,
        );
        this.logger.log({
          event: 'operations.reconciliation.scheduled',
          type: sched.type,
          cron: sched.cron,
          scope: sched.scope,
        });
      } catch (e) {
        this.logger.warn(`Failed to schedule ${sched.type}: ${(e as Error).message}`);
      }
    }
  }

  async executeScheduledRun(params: {
    type: OperationalReconciliationType;
    scope: 'PLATFORM' | 'TENANT';
    tenantId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { type, scope, tenantId = null, correlationId = null } = params;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `scheduled-reconciliation:${type}`,
      tenantId: scope === 'PLATFORM' ? null : tenantId ?? null,
      scope,
      correlationId: correlationId ?? null,
      timestampBucket: new Date().toISOString().slice(0, 13), // hourly bucket
    });

    // Lock protection
    const lockKey = `ops:scheduled-reconciliation:${type}:${scope === 'PLATFORM' ? 'platform' : tenantId ?? 'all'}`;
    const token = `sched-${Date.now()}`;
    const release = await this.redis.acquireLock(lockKey, 10 * 60 * 1000, token).catch(() => null);
    if (!release) {
      this.logger.log({ event: 'operations.reconciliation.scheduled_skipped_lock', type, scope });
      return null;
    }

    try {
      if (scope === 'PLATFORM') {
        return await this.orchestrator.runReconciliation({
          tenantId: null,
          type,
          requestedBy: null,
          triggerType: OperationalTriggerType.SCHEDULED,
          correlationId: correlationId ?? null,
        });
      } else {
        // TENANT scope — if tenantId provided, run for that tenant, else run for all tenants with recent activity
        if (tenantId) {
          return await this.orchestrator.runReconciliation({
            tenantId,
            type,
            requestedBy: null,
            triggerType: OperationalTriggerType.SCHEDULED,
            correlationId: correlationId ?? null,
          });
        } else {
          // Find active tenants
          const tenants = await this.prisma.tenant.findMany({
            where: { status: 'ACTIVE' as any },
            select: { id: true },
            take: 100,
          }).catch(() => []);
          const results = [];
          for (const t of tenants) {
            const res = await this.orchestrator.runReconciliation({
              tenantId: t.id,
              type,
              requestedBy: null,
              triggerType: OperationalTriggerType.SCHEDULED,
              correlationId: correlationId ?? null,
            }).catch((e) => {
              this.logger.warn(`Scheduled reconciliation failed for tenant ${t.id} type ${type}: ${(e as Error).message}`);
              return null;
            });
            if (res) results.push(res);
          }
          return results;
        }
      }
    } finally {
      try {
        await release();
      } catch {}
    }
  }

  async triggerManualRun(params: {
    tenantId?: string | null;
    type: OperationalReconciliationType;
    requestedBy?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    if (!Object.values(OperationalReconciliationType).includes(params.type)) {
      throw new BadRequestException(`Invalid reconciliation type ${params.type}`);
    }

    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: 'RECONCILIATION_RUN_STARTED' as any,
      actorId: params.requestedBy ?? null,
      actorType: params.requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'RECONCILIATION_RUN',
      targetId: params.type,
      evidence: redactSecrets({
        type: params.type,
        triggerType: 'MANUAL',
        correlationId: params.correlationId,
      }),
      correlationId: params.correlationId ?? null,
    });

    return this.orchestrator.runReconciliation({
      tenantId: params.tenantId ?? null,
      type: params.type,
      requestedBy: params.requestedBy ?? null,
      triggerType: OperationalTriggerType.MANUAL,
      correlationId: params.correlationId ?? null,
    });
  }

  async handleJob(jobData: { type: OperationalReconciliationType; scope: string; tenantId?: string; correlationId?: string }): Promise<void> {
    try {
      await this.executeScheduledRun({
        type: jobData.type,
        scope: jobData.scope as any,
        tenantId: jobData.tenantId ?? null,
        correlationId: jobData.correlationId ?? null,
      });
    } catch (e) {
      this.logger.error(`Reconciliation scheduled job failed: ${(e as Error).message}`);
      // Safe failure handling — do not crash worker, record audit
      await this.auditService.record({
        tenantId: jobData.tenantId ?? null,
        eventType: 'RECONCILIATION_RUN_FAILED' as any,
        actorId: null,
        actorType: 'SYSTEM',
        targetType: 'RECONCILIATION_RUN',
        targetId: jobData.type,
        evidence: redactSecrets({ error: (e as Error).message, type: jobData.type }),
        correlationId: jobData.correlationId ?? null,
      });
    }
  }
}
