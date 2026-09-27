import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deterministicIdempotencyKey } from './client-lifecycle.types';

/**
 * Reconciles requested, approved, submitted, confirmed, failed, reversed, and externally settled
 * funding operations against authoritative payment/custody/exchange records. Must never rewrite external truth.
 */

@Injectable()
export class FundingReconciliationService {
  private readonly logger = new Logger(FundingReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcileFundingRequest(params: {
    tenantId: string;
    fundingRequestId?: string | null;
    withdrawalRequestId?: string | null;
  }): Promise<{ discrepancies: Array<{ type: string; severity: string; details: any }>; hasCritical: boolean }> {
    const { tenantId, fundingRequestId = null, withdrawalRequestId = null } = params;

    const discrepancies: Array<{ type: string; severity: string; details: any }> = [];

    let request: any = null;
    let requestType = '';

    if (fundingRequestId) {
      try {
        request = await (this.prisma as any).fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } });
        requestType = 'FUNDING';
      } catch {}
    } else if (withdrawalRequestId) {
      try {
        request = await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });
        requestType = 'WITHDRAWAL';
      } catch {}
    }

    if (!request) {
      discrepancies.push({ type: 'REQUEST_NOT_FOUND', severity: 'CRITICAL', details: { fundingRequestId, withdrawalRequestId } });
      return { discrepancies, hasCritical: true };
    }

    // Detect: REQUEST_WITHOUT_EXTERNAL_RECORD
    if (['SUBMITTED', 'CONFIRMED'].includes(request.state) && !request.externalReference) {
      discrepancies.push({ type: 'REQUEST_WITHOUT_EXTERNAL_RECORD', severity: 'WARNING', details: { requestId: request.id, state: request.state } });
    }

    // Detect: EXTERNAL_RECORD_WITHOUT_REQUEST — would check external payment records
    // For now, check if externalReference exists but no corresponding external record (simulated)
    if (request.externalReference) {
      try {
        // Check if external record exists in payment ledger or similar
        const externalRecord = await (this.prisma as any).payment?.findFirst?.({ where: { tenantId, externalReference: request.externalReference } });
        if (!externalRecord) {
          // Could be missing external record — check if state is CONFIRMED but no external proof
          if (request.state === 'CONFIRMED' && !request.confirmedAmount) {
            discrepancies.push({ type: 'SETTLEMENT_MISSING', severity: 'CRITICAL', details: { requestId: request.id, externalReference: request.externalReference } });
          }
        } else {
          // Check amount mismatch
          const externalAmount = externalRecord.amount?.toString() ?? externalRecord.settledAmount?.toString();
          if (externalAmount && request.requestedAmount && externalAmount !== request.requestedAmount) {
            // Allow approvedAmount to differ, but confirmed should match external
            if (request.confirmedAmount && request.confirmedAmount !== externalAmount) {
              discrepancies.push({ type: 'AMOUNT_MISMATCH', severity: 'CRITICAL', details: { requestId: request.id, requested: request.requestedAmount, confirmed: request.confirmedAmount, external: externalAmount } });
            }
          }
          // Currency mismatch
          if (externalRecord.currency && request.currency && externalRecord.currency !== request.currency) {
            discrepancies.push({ type: 'CURRENCY_MISMATCH', severity: 'CRITICAL', details: { requestId: request.id, requestCurrency: request.currency, externalCurrency: externalRecord.currency } });
          }
          // Status mismatch
          if (externalRecord.status === 'FAILED' && request.state === 'CONFIRMED') {
            discrepancies.push({ type: 'STATUS_MISMATCH', severity: 'CRITICAL', details: { requestId: request.id, requestState: request.state, externalStatus: externalRecord.status } });
          }
        }
      } catch {}
    }

    // Detect: DUPLICATE_EXTERNAL_REFERENCE
    if (request.externalReference) {
      try {
        const dupCount = await (this.prisma as any).fundingRequest.count({ where: { tenantId, externalReference: request.externalReference } });
        const dupWithdrawal = await (this.prisma as any).withdrawalRequest.count({ where: { tenantId, externalReference: request.externalReference } });
        const totalDup = dupCount + dupWithdrawal;
        if (totalDup > 1) {
          discrepancies.push({ type: 'DUPLICATE_EXTERNAL_REFERENCE', severity: 'CRITICAL', details: { externalReference: request.externalReference, count: totalDup } });
        }
      } catch {}
    }

    // Detect: DUPLICATE_REQUEST — same idempotencyKey or same amount/currency/destination in short window
    try {
      const recentRequests = await (this.prisma as any).fundingRequest.findMany({
        where: {
          tenantId,
          accountId: request.accountId,
          requestedAmount: request.requestedAmount,
          currency: request.currency,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 min window
          id: { not: request.id },
        },
      });
      if (recentRequests.length > 0) {
        discrepancies.push({ type: 'DUPLICATE_REQUEST', severity: 'WARNING', details: { requestId: request.id, recentCount: recentRequests.length } });
      }
    } catch {}

    // Detect: UNEXPECTED_REVERSAL
    if (request.state === 'REVERSED' && !request.reversalReason) {
      discrepancies.push({ type: 'UNEXPECTED_REVERSAL', severity: 'WARNING', details: { requestId: request.id, reason: 'Reversal without reason' } });
    }

    // Detect: SETTLEMENT_MISSING — CONFIRMED without confirmedAmount
    if (request.state === 'CONFIRMED' && !request.confirmedAmount) {
      discrepancies.push({ type: 'SETTLEMENT_MISSING', severity: 'CRITICAL', details: { requestId: request.id, state: request.state } });
    }

    const hasCritical = discrepancies.some((d) => d.severity === 'CRITICAL');

    return { discrepancies, hasCritical };
  }

  async runReconciliation(params: {
    tenantId: string;
    fundingRequestId?: string | null;
    withdrawalRequestId?: string | null;
    reconciliationType?: string;
  }): Promise<any> {
    const { tenantId, fundingRequestId = null, withdrawalRequestId = null, reconciliationType = 'FUNDING_SETTLEMENT' } = params;

    const result = await this.reconcileFundingRequest({ tenantId, fundingRequestId, withdrawalRequestId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `funding-reconciliation:${reconciliationType}`,
      tenantId,
      externalRef: fundingRequestId ?? withdrawalRequestId ?? `${Date.now()}`,
    });

    try {
      const existing = await (this.prisma as any).fundingReconciliation.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const request = fundingRequestId
      ? await (this.prisma as any).fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } })
      : await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });

    const reconciliation = await (this.prisma as any).fundingReconciliation.create({
      data: {
        tenantId,
        fundingRequestId: fundingRequestId ?? null,
        withdrawalRequestId: withdrawalRequestId ?? null,
        reconciliationType,
        expected: { requestState: request?.state, requestedAmount: request?.requestedAmount, currency: request?.currency } as any,
        actual: { externalReference: request?.externalReference, confirmedAmount: request?.confirmedAmount } as any,
        discrepancyType: result.discrepancies.length > 0 ? result.discrepancies[0].type : null,
        discrepancyDetails: result.discrepancies as any,
        isCritical: result.hasCritical,
        isResolved: false,
        sourceType: 'FUNDING_RECONCILIATION',
        sourceId: fundingRequestId ?? withdrawalRequestId ?? null,
        externalReference: request?.externalReference ?? null,
        idempotencyKey,
      },
    });

    // Do not silently rewrite funding state from local assumption — only report discrepancies

    return reconciliation;
  }

  async listReconciliations(params: {
    tenantId: string;
    fundingRequestId?: string;
    withdrawalRequestId?: string;
    isCritical?: boolean;
    isResolved?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, fundingRequestId, withdrawalRequestId, isCritical, isResolved, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (fundingRequestId) where.fundingRequestId = fundingRequestId;
    if (withdrawalRequestId) where.withdrawalRequestId = withdrawalRequestId;
    if (isCritical !== undefined) where.isCritical = isCritical;
    if (isResolved !== undefined) where.isResolved = isResolved;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).fundingReconciliation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).fundingReconciliation.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
