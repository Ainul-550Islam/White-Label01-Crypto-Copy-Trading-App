// # Periodically retries committed audit-export intents that have not reached the queue.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GovernanceAuditExportService } from './governance-audit-export.service';

/** Runs in both API and worker processes without requiring a global scheduler. */
@Injectable()
export class AuditExportRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditExportRelayService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly exports: GovernanceAuditExportService) {}

  onModuleInit(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.relay().catch((error: unknown) => {
        this.logger.warn(`Audit export relay failed (${error instanceof Error ? error.name : 'unknown'})`);
      });
    }, 10_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async relay(): Promise<void> { await this.exports.relayPendingExports(); }
}
