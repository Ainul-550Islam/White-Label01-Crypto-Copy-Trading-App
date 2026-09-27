import { Injectable, Logger } from '@nestjs/common';
import { ResearchRepository } from './research-repository';

/**
 * Audit events for dataset use, strategy versioning, backtest runs, parameter sweeps, walk-forward, Monte Carlo, paper sessions, signals, and promotions.
 * Never log credentials, private keys, raw exchange API data containing secrets, user authentication tokens
 */
@Injectable()
export class ResearchAuditService {
  private readonly logger = new Logger(ResearchAuditService.name);

  constructor(private readonly researchRepo: ResearchRepository) {}

  async logDatasetRequested(tenantId: string, actorId: string | null, datasetId: string | null, metadata: Record<string, any>, requestId?: string | null): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'DATASET_REQUESTED',
      actorId,
      datasetId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
      requestId: requestId || null,
    });
  }

  async logDatasetValidated(tenantId: string, actorId: string | null, datasetId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'DATASET_VALIDATED',
      actorId,
      datasetId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logDatasetRejected(tenantId: string, actorId: string | null, datasetId: string | null, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'DATASET_REJECTED',
      actorId,
      datasetId,
      result: 'FAILURE',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logStrategyVersionCreated(tenantId: string, actorId: string | null, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_CREATED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logStrategyVersionFrozen(tenantId: string, actorId: string | null, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_FROZEN',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logStrategyVersionPublished(tenantId: string, actorId: string | null, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_PUBLISHED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logBacktestStarted(tenantId: string, actorId: string | null, runId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'BACKTEST_STARTED',
      actorId,
      backtestRunId: runId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logBacktestCompleted(tenantId: string, actorId: string | null, runId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'BACKTEST_COMPLETED',
      actorId,
      backtestRunId: runId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logBacktestFailed(tenantId: string, actorId: string | null, runId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'BACKTEST_FAILED',
      actorId,
      backtestRunId: runId,
      strategyVersionId: versionId,
      result: 'FAILURE',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logWalkForwardCompleted(tenantId: string, actorId: string | null, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'WALK_FORWARD_COMPLETED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logMonteCarloCompleted(tenantId: string, actorId: string | null, runId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'MONTE_CARLO_COMPLETED',
      actorId,
      backtestRunId: runId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logParameterSweepCompleted(tenantId: string, actorId: string | null, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PARAMETER_SWEEP_COMPLETED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logPaperSessionStarted(tenantId: string, actorId: string | null, sessionId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_STARTED',
      actorId,
      paperSessionId: sessionId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logPaperSessionStopped(tenantId: string, actorId: string | null, sessionId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_STOPPED',
      actorId,
      paperSessionId: sessionId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logSignalCreated(tenantId: string, actorId: string | null, signalId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'SIGNAL_CREATED',
      actorId,
      signalId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logSignalRejected(tenantId: string, actorId: string | null, signalId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'SIGNAL_REJECTED',
      actorId,
      signalId,
      result: 'REJECTED',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logPromotionRequested(tenantId: string, actorId: string | null, promotionId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_REQUESTED',
      actorId,
      promotionId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logPromotionApproved(tenantId: string, actorId: string | null, promotionId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_APPROVED',
      actorId,
      promotionId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  async logPromotionRejected(tenantId: string, actorId: string | null, promotionId: string, versionId: string, metadata: Record<string, any>): Promise<void> {
    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_REJECTED',
      actorId,
      promotionId,
      strategyVersionId: versionId,
      result: 'REJECTED',
      safeMetadata: this.sanitizeMetadata(metadata),
    });
  }

  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const forbidden = ['secret','apiKey','apiSecret','passphrase','privateKey','token','password','credential'];
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lower = key.toLowerCase();
      if (forbidden.some(f => lower.includes(f.toLowerCase()))) continue;
      if (typeof value === 'string' && value.length > 1000) sanitized[key] = value.substring(0,1000);
      else if (typeof value === 'object' && value !== null && !Array.isArray(value)) sanitized[key] = this.sanitizeMetadata(value);
      else sanitized[key] = value;
    }
    return sanitized;
  }
}
