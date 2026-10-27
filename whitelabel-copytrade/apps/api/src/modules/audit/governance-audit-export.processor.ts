// # Responsibility: processes the Batch 04 asynchronous audit-export workload.
// # Runs large governance audit exports off the request path using the durable audit BullMQ queue.
import { type OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES } from '@wlct/config';
import { GovernanceAuditExportService, type AuditExport, type AuditExportJobPayload } from '../governance/governance-audit-export.service';

@Processor(QUEUE_NAMES.AUDIT, { concurrency: 2 })
export class GovernanceAuditExportProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(private readonly exports: GovernanceAuditExportService, private readonly config: AppConfigService) { super(); }

  async onApplicationBootstrap(): Promise<void> { if (!this.config.queueRunInlineWorkers) await this.worker.close(); }

  async process(job: Job<AuditExportJobPayload, AuditExport>): Promise<AuditExport> {
    if (job.name !== 'governance-audit-export') throw new UnrecoverableError('Unsupported audit queue job');
    if (!job.id || job.id !== job.data.jobId) throw new UnrecoverableError('Audit export job identity mismatch');
    return this.exports.processQueuedExport(job.data);
  }
}
