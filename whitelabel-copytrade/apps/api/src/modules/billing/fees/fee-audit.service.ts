import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Structured audit events for fee pipeline.
 * Never logs secrets: payout secrets, bank credentials, wallet private keys,
 * exchange API keys, payment provider secrets, access tokens.
 */

export enum FeeAuditOperation {
  FEE_POLICY_RESOLVED = 'FEE_POLICY_RESOLVED',
  FEE_CALCULATED = 'FEE_CALCULATED',
  FEE_ACCRUED = 'FEE_ACCRUED',
  FEE_ACCRUAL_REJECTED = 'FEE_ACCRUAL_REJECTED',
  FEE_LEDGER_POSTED = 'FEE_LEDGER_POSTED',
  FEE_LEDGER_POST_FAILED = 'FEE_LEDGER_POST_FAILED',
  SETTLEMENT_CREATED = 'SETTLEMENT_CREATED',
  SETTLEMENT_APPROVED = 'SETTLEMENT_APPROVED',
  SETTLEMENT_FINALIZED = 'SETTLEMENT_FINALIZED',
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  PAYOUT_CREATED = 'PAYOUT_CREATED',
  PAYOUT_PROCESSING = 'PAYOUT_PROCESSING',
  PAYOUT_SUCCEEDED = 'PAYOUT_SUCCEEDED',
  PAYOUT_FAILED = 'PAYOUT_FAILED',
  PAYOUT_REVERSED = 'PAYOUT_REVERSED',
  PAYOUT_CANCELLED = 'PAYOUT_CANCELLED',
  FEE_RECONCILIATION_DETECTED = 'FEE_RECONCILIATION_DETECTED',
  FEE_RECONCILIATION_RESOLVED = 'FEE_RECONCILIATION_RESOLVED',
}

export interface FeeAuditRecord {
  id: string;
  tenantId: string;
  operation: FeeAuditOperation;
  referenceId: string;
  referenceType: string;
  status: string;
  amount: string | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  timestamp: Date;
}

@Injectable()
export class FeeAuditService {
  private readonly logger = new Logger(FeeAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async log(input: {
    tenantId: string;
    operation: FeeAuditOperation;
    referenceId: string;
    referenceType: string;
    status: string;
    amount?: string;
    currency?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<void> {
    const sanitized = this.sanitizeMetadata(input.metadata);

    try {
      await (this.prisma as any).feeAuditLog?.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          operation: input.operation,
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          status: input.status,
          amount: input.amount || null,
          currency: input.currency || null,
          metadata: sanitized,
          actorId: input.actorId || null,
          timestamp: new Date(),
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        // Fallback to general audit log and console
        this.logger.log(`[FEE_AUDIT] ${input.operation} tenant=${input.tenantId} ref=${input.referenceId} status=${input.status} amount=${input.amount || ''} ${input.currency || ''}`);

        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              action: input.operation,
              resource: input.referenceType,
              resourceId: input.referenceId,
              metadata: sanitized,
              createdAt: new Date(),
            },
          });
        } catch {}
        return;
      }
      this.logger.warn(`Failed to create fee audit log: ${error.message}`);
    }
  }

  async logPolicyResolved(tenantId: string, feeType: string, platformBps: number, performanceBps: number, source: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_POLICY_RESOLVED,
      referenceId: `${tenantId}_${feeType}`,
      referenceType: 'FeePolicy',
      status: 'RESOLVED',
      metadata: { feeType, platformFeeBps: platformBps, performanceFeeBps: performanceBps, source },
    });
  }

  async logFeeCalculated(tenantId: string, sourceId: string, feeType: string, feeAmount: string, currency: string, rateBps: number): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_CALCULATED,
      referenceId: sourceId,
      referenceType: 'FeeCalculation',
      status: 'CALCULATED',
      amount: feeAmount,
      currency,
      metadata: { feeType, rateBps },
    });
  }

  async logFeeAccrued(tenantId: string, accrualId: string, feeType: string, feeAmount: string, currency: string, sourceId: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_ACCRUED,
      referenceId: accrualId,
      referenceType: 'FeeAccrual',
      status: 'ACCRUED',
      amount: feeAmount,
      currency,
      metadata: { feeType, sourceId },
    });
  }

  async logAccrualRejected(tenantId: string, sourceId: string, sourceType: string, feeType: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_ACCRUAL_REJECTED,
      referenceId: sourceId,
      referenceType: 'FeeAccrual',
      status: 'REJECTED',
      metadata: { sourceType, feeType, reason },
    });
  }

  async logLedgerPosted(tenantId: string, accrualId: string, feeType: string, feeAmount: string, currency: string, idempotencyKey: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_LEDGER_POSTED,
      referenceId: accrualId,
      referenceType: 'FeeLedger',
      status: 'POSTED',
      amount: feeAmount,
      currency,
      metadata: { feeType, idempotencyKey },
    });
  }

  async logLedgerPostingFailed(tenantId: string, accrualId: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_LEDGER_POST_FAILED,
      referenceId: accrualId,
      referenceType: 'FeeLedger',
      status: 'FAILED',
      metadata: { reason },
    });
  }

  async logSettlementCreated(tenantId: string, settlementId: string, amount: string, currency: string, accrualCount: number): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.SETTLEMENT_CREATED,
      referenceId: settlementId,
      referenceType: 'FeeSettlement',
      status: 'CREATED',
      amount,
      currency,
      metadata: { accrualCount },
    });
  }

  async logSettlementApproved(tenantId: string, settlementId: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.SETTLEMENT_APPROVED,
      referenceId: settlementId,
      referenceType: 'FeeSettlement',
      status: 'APPROVED',
      amount,
      currency,
    });
  }

  async logSettlementFinalized(tenantId: string, settlementId: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.SETTLEMENT_FINALIZED,
      referenceId: settlementId,
      referenceType: 'FeeSettlement',
      status: 'FINALIZED',
      amount,
      currency,
    });
  }

  async logPayoutCreated(tenantId: string, payoutId: string, settlementId: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.PAYOUT_CREATED,
      referenceId: payoutId,
      referenceType: 'Payout',
      status: 'CREATED',
      amount,
      currency,
      metadata: { settlementId },
    });
  }

  async logPayoutProcessing(tenantId: string, payoutId: string, settlementId: string, providerPayoutId: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.PAYOUT_PROCESSING,
      referenceId: payoutId,
      referenceType: 'Payout',
      status: 'PROCESSING',
      metadata: { settlementId, providerPayoutId },
    });
  }

  async logPayoutSucceeded(tenantId: string, payoutId: string, settlementId: string, amount: string, currency: string, providerPayoutId: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.PAYOUT_SUCCEEDED,
      referenceId: payoutId,
      referenceType: 'Payout',
      status: 'SUCCEEDED',
      amount,
      currency,
      metadata: { settlementId, providerPayoutId },
    });
  }

  async logPayoutFailed(tenantId: string, payoutId: string, settlementId: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.PAYOUT_FAILED,
      referenceId: payoutId,
      referenceType: 'Payout',
      status: 'FAILED',
      metadata: { settlementId, reason },
    });
  }

  async logReconciliationDetected(tenantId: string, category: string, sourceId: string, description: string, severity: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_RECONCILIATION_DETECTED,
      referenceId: sourceId,
      referenceType: 'Reconciliation',
      status: severity,
      metadata: { category, description },
    });
  }

  async logReconciliationResolved(tenantId: string, category: string, sourceId: string, resolution: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FeeAuditOperation.FEE_RECONCILIATION_RESOLVED,
      referenceId: sourceId,
      referenceType: 'Reconciliation',
      status: 'RESOLVED',
      metadata: { category, resolution },
    });
  }

  private sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbidden = [
      'secret',
      'apiKey',
      'privateKey',
      'accessToken',
      'password',
      'exchangeSecret',
      'providerSecret',
      'bankAccount',
      'walletKey',
      'private_key',
      'credentials',
      'seed',
      'mnemonic',
      'stripeSecret',
      'webhookSecret',
      'bankCredentials',
      'signingSecret',
    ];
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        // Also check nested objects shallow
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          const sanitizedNested: Record<string, unknown> = {};
          for (const [nk, nv] of Object.entries(nested)) {
            if (forbidden.some((f) => nk.toLowerCase().includes(f.toLowerCase()))) {
              sanitizedNested[nk] = '[REDACTED]';
            } else {
              sanitizedNested[nk] = nv;
            }
          }
          safe[key] = sanitizedNested;
        } else {
          safe[key] = value;
        }
      }
    }
    return safe;
  }
}
