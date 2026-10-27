// # Responsibility: processes the Batch 04 asynchronous audit-export workload.
// # Runs large governance audit exports off the request path using the durable audit BullMQ queue.
// Registered as a provider of GovernanceModule (API process). Unlike the
// maintenance/notification workers it does not self-close when
// QUEUE_RUN_INLINE_WORKERS is false: the dedicated worker's module graph has
// no governance providers, so closing here would leave queued exports with
// no consumer at all. Concurrency is bounded at 2, off the request path.
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES } from '@wlct/config';
import { GovernanceAuditExportService, type AuditExport, type AuditExportJobPayload } from '../governance/governance-audit-export.service';

@Processor(QUEUE_NAMES.AUDIT, { concurrency: 2 })
export class GovernanceAuditExportProcessor extends WorkerHost {
  constructor(private readonly exports: GovernanceAuditExportService) { super(); }

  async process(job: Job<AuditExportJobPayload, AuditExport>): Promise<AuditExport> {
    if (job.name !== 'governance-audit-export') throw new UnrecoverableError(`Unsupported audit queue job: ${job.name}`);
    return this.exports.processQueuedExport(job.data);
  }
}
