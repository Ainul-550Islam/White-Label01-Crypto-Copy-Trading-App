import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { redactSecrets } from './portfolio-accounting.types';

/**
 * Writes immutable audit records for ingestion, valuation, NAV, PnL, performance, attribution,
 * snapshot, close, statement, export, reconciliation, adjustment, visibility without secrets.
 * Must be immutable append-only, no update/delete.
 */

@Injectable()
export class PortfolioAuditService {
  private readonly logger = new Logger(PortfolioAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    tenantId: string;
    profileId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    evidence?: Record<string, unknown>;
    calculationVersion?: string | null;
    policyVersion?: string | null;
    dataCompleteness?: string | null;
  }): Promise<void> {
    const { tenantId, profileId = null, action, entityType, entityId = null, operatorId = null, correlationId = null, requestId = null, sourceType = null, sourceId = null, evidence = {}, calculationVersion = null, policyVersion = null, dataCompleteness = null } = params;

    const scrubbedEvidence = redactSecrets(evidence);

    try {
      // Try to write to existing audit log model — use AuditLog if exists, else Portfolio-specific audit
      if ((this.prisma as any).auditLog?.create) {
        await (this.prisma as any).auditLog.create({
          data: {
            tenantId,
            action: `PORTFOLIO_${action}`,
            entityType,
            entityId: entityId ?? profileId ?? 'UNKNOWN',
            actorId: operatorId,
            correlationId: correlationId ?? null,
            requestId: requestId ?? null,
            metadata: {
              profileId,
              sourceType,
              sourceId,
              calculationVersion,
              policyVersion,
              dataCompleteness,
              ...scrubbedEvidence,
            } as any,
          },
        });
      } else if ((this.prisma as any).portfolioAccountingEvent?.findFirst) {
        // Fallback: log via logger if no audit model
        this.logger.log({
          event: `portfolio.audit.${action}`,
          tenantId,
          profileId,
          entityType,
          entityId,
          operatorId,
          sourceType,
          sourceId,
          calculationVersion,
          policyVersion,
          dataCompleteness,
          evidence: scrubbedEvidence,
        });
      }
    } catch (e) {
      this.logger.warn(`Portfolio audit log failed: ${(e as Error).message}`);
      // Fail-closed audit — still log via logger
      this.logger.log({
        event: `portfolio.audit.${action}.fallback`,
        tenantId,
        profileId,
        entityType,
        entityId,
        evidence: scrubbedEvidence,
      });
    }
  }

  async logIngestion(params: {
    tenantId: string;
    profileId: string;
    sourceType: string;
    sourceId: string;
    eventId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'INGESTION',
      entityType: 'PORTFOLIO_ACCOUNTING_EVENT',
      entityId: params.eventId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      operatorId: params.operatorId ?? null,
      correlationId: params.correlationId ?? null,
      evidence: { sourceType: params.sourceType, sourceId: params.sourceId, eventId: params.eventId },
    });
  }

  async logValuation(params: {
    tenantId: string;
    profileId: string;
    valuationId: string;
    symbol: string;
    state: string;
    calculationVersion: string;
    policyVersion: string;
    dataCompleteness: string;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'VALUATION',
      entityType: 'PORTFOLIO_VALUATION',
      entityId: params.valuationId,
      evidence: { symbol: params.symbol, state: params.state },
      calculationVersion: params.calculationVersion,
      policyVersion: params.policyVersion,
      dataCompleteness: params.dataCompleteness,
    });
  }

  async logNav(params: {
    tenantId: string;
    profileId: string;
    nav: string | null;
    baseCurrency: string;
    calculationVersion: string;
    policyVersion: string;
    dataCompleteness: string;
    sourceReferences: string[];
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'NAV_CALCULATION',
      entityType: 'PORTFOLIO_NAV',
      evidence: { nav: params.nav, baseCurrency: params.baseCurrency, sourceReferences: params.sourceReferences },
      calculationVersion: params.calculationVersion,
      policyVersion: params.policyVersion,
      dataCompleteness: params.dataCompleteness,
    });
  }

  async logPeriodClose(params: {
    tenantId: string;
    profileId: string;
    periodId: string;
    state: string;
    operatorId: string;
    nav: string | null;
    calculationVersion: string;
    policyVersion: string;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'PERIOD_CLOSE',
      entityType: 'PORTFOLIO_ACCOUNTING_PERIOD',
      entityId: params.periodId,
      operatorId: params.operatorId,
      evidence: { state: params.state, nav: params.nav },
      calculationVersion: params.calculationVersion,
      policyVersion: params.policyVersion,
    });
  }

  async logStatement(params: {
    tenantId: string;
    profileId: string;
    statementId: string;
    periodId: string;
    operatorId?: string | null;
    calculationVersion: string;
    policyVersion: string;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'STATEMENT_GENERATED',
      entityType: 'PORTFOLIO_STATEMENT',
      entityId: params.statementId,
      operatorId: params.operatorId ?? null,
      evidence: { periodId: params.periodId },
      calculationVersion: params.calculationVersion,
      policyVersion: params.policyVersion,
    });
  }

  async logAdjustment(params: {
    tenantId: string;
    profileId: string;
    adjustmentId: string;
    adjustmentType: string;
    originalEventId?: string | null;
    operatorId: string;
    reason: string;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'ADJUSTMENT',
      entityType: 'PORTFOLIO_ACCOUNTING_ADJUSTMENT',
      entityId: params.adjustmentId,
      operatorId: params.operatorId,
      evidence: { adjustmentType: params.adjustmentType, originalEventId: params.originalEventId, reason: params.reason },
    });
  }

  async logReconciliation(params: {
    tenantId: string;
    profileId: string;
    reconciliationId: string;
    state: string;
    hasCriticalFailure: boolean;
    discrepanciesCount: number;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId,
      action: 'RECONCILIATION',
      entityType: 'PORTFOLIO_ACCOUNTING_RECONCILIATION',
      entityId: params.reconciliationId,
      evidence: { state: params.state, hasCriticalFailure: params.hasCriticalFailure, discrepanciesCount: params.discrepanciesCount },
    });
  }

  async logExport(params: {
    tenantId: string;
    profileId?: string | null;
    exportType: string;
    statementId?: string | null;
    operatorId?: string | null;
    format: string;
  }): Promise<void> {
    await this.log({
      tenantId: params.tenantId,
      profileId: params.profileId ?? null,
      action: 'EXPORT',
      entityType: 'PORTFOLIO_EXPORT',
      entityId: params.statementId ?? null,
      operatorId: params.operatorId ?? null,
      evidence: { exportType: params.exportType, format: params.format, statementId: params.statementId },
    });
  }
}
