import { Injectable, Logger } from '@nestjs/common';
import { BillingLedgerService } from '../finance/billing-ledger.service';
import { BillingLedgerRepository } from '../finance/billing-ledger.repository';
import { LedgerAccountCategory, LedgerEntryType, LedgerSourceType } from '../finance/billing-ledger.types';
import { createMoney } from '../finance/money.types';
import { FeeAccrual, FeeType } from './fee.types';
import { FeeAuditService } from './fee-audit.service';

/**
 * Converts fee accruals into existing BillingLedger using balanced transactions.
 * Reuses BillingLedgerService - does NOT create another ledger implementation.
 * Every operation idempotent.
 */
@Injectable()
export class FeeLedgerService {
  private readonly logger = new Logger(FeeLedgerService.name);

  constructor(
    private readonly ledgerService: BillingLedgerService,
    private readonly ledgerRepository: BillingLedgerRepository,
    private readonly auditService: FeeAuditService,
  ) {}

  async postAccrualToLedger(accrual: FeeAccrual): Promise<any[]> {
    const idempotencyKey = `fee_ledger_${accrual.id}_${accrual.feeType}`;

    // Idempotency check
    try {
      const existing = await this.ledgerRepository.findBySource(LedgerSourceType.FEE, accrual.id);
      if (existing && existing.length > 0) {
        this.logger.log(`Idempotent ledger return for accrual ${accrual.id}`);
        return existing;
      }
      const byIdempotency = await this.ledgerRepository.findByIdempotencyKey(idempotencyKey);
      if (byIdempotency) {
        this.logger.log(`Idempotent ledger return by idempotencyKey ${idempotencyKey}`);
        const bySource = await this.ledgerRepository.findBySource(LedgerSourceType.FEE, accrual.id);
        return bySource.length > 0 ? bySource : [byIdempotency];
      }
    } catch (e) {
      this.logger.warn(`Ledger idempotency check failed: ${(e as Error).message}`);
    }

    const feeMoney = createMoney(accrual.feeAmount, accrual.currency);
    const grossMoney = createMoney(accrual.grossAmount, accrual.currency);

    // Determine ledger account category based on fee type
    const feeAccountCategory =
      accrual.feeType === FeeType.PLATFORM_FEE ? LedgerAccountCategory.PLATFORM_FEE_REVENUE : LedgerAccountCategory.PERFORMANCE_FEE_REVENUE;

    // Balanced transaction:
    // Debit CUSTOMER_RECEIVABLE for fee amount
    // Credit FEE_REVENUE (PLATFORM or PERFORMANCE) for fee amount
    // This mirrors existing fee recording pattern in BillingLedgerService.recordFee

    try {
      const result = await this.ledgerService.recordFee({
        tenantId: accrual.tenantId,
        sourceId: accrual.id,
        sourceType: LedgerSourceType.FEE,
        amount: feeMoney,
        currency: accrual.currency,
        feeType: feeAccountCategory,
        idempotencyKey,
        metadata: {
          feeAccrualId: accrual.id,
          sourceType: accrual.sourceType,
          sourceId: accrual.sourceId,
          feeType: accrual.feeType,
          feeRateBps: accrual.feeRateBps,
          grossAmount: accrual.grossAmount,
          currency: accrual.currency,
          policySnapshot: accrual.policySnapshot,
          safeMetadata: accrual.safeMetadata,
        },
      });

      await this.auditService.logLedgerPosted(accrual.tenantId, accrual.id, accrual.feeType, accrual.feeAmount, accrual.currency, idempotencyKey);

      this.logger.log(`Fee ledger posted accrual=${accrual.id} feeType=${accrual.feeType} amount=${accrual.feeAmount} ${accrual.currency} tx=${idempotencyKey}`);

      return result;
    } catch (error: any) {
      this.logger.error(`Failed to post fee accrual ${accrual.id} to ledger: ${error.message}`, error.stack);
      await this.auditService.logLedgerPostingFailed(accrual.tenantId, accrual.id, error.message);
      throw error;
    }
  }

  async postAccrualsBatch(accruals: FeeAccrual[]): Promise<{ success: number; failed: number; results: any[] }> {
    let success = 0;
    let failed = 0;
    const results: any[] = [];

    for (const accrual of accruals) {
      try {
        const res = await this.postAccrualToLedger(accrual);
        success++;
        results.push({ accrualId: accrual.id, success: true, result: res });
      } catch (e) {
        failed++;
        results.push({ accrualId: accrual.id, success: false, error: (e as Error).message });
      }
    }

    return { success, failed, results };
  }

  async reverseAccrualInLedger(accrual: FeeAccrual, reason: string): Promise<any[]> {
    const idempotencyKey = `fee_reverse_${accrual.id}_${Date.now()}`;

    const feeMoney = createMoney(accrual.feeAmount, accrual.currency);
    const feeAccountCategory =
      accrual.feeType === FeeType.PLATFORM_FEE ? LedgerAccountCategory.PLATFORM_FEE_REVENUE : LedgerAccountCategory.PERFORMANCE_FEE_REVENUE;

    // Reversal: Debit fee revenue, Credit receivable (opposite of original)
    try {
      // Use recordCredit or custom transaction for reversal
      // For simplicity, we create a transaction with reversed entries
      const entries = [
        {
          tenantId: accrual.tenantId,
          accountCategory: feeAccountCategory,
          entryType: LedgerEntryType.DEBIT,
          amount: feeMoney,
          sourceType: LedgerSourceType.FEE,
          sourceId: accrual.id,
          idempotencyKey: `${idempotencyKey}_debit`,
          description: `Fee reversal: ${accrual.feeType} accrual ${accrual.id} reason: ${reason}`,
          metadata: {
            reversal: true,
            originalAccrualId: accrual.id,
            reason,
            feeType: accrual.feeType,
          },
        },
        {
          tenantId: accrual.tenantId,
          accountCategory: LedgerAccountCategory.CUSTOMER_RECEIVABLE,
          entryType: LedgerEntryType.CREDIT,
          amount: feeMoney,
          sourceType: LedgerSourceType.FEE,
          sourceId: accrual.id,
          idempotencyKey: `${idempotencyKey}_credit`,
          description: `Fee reversal receivable: ${accrual.id}`,
          metadata: {
            reversal: true,
            originalAccrualId: accrual.id,
            reason,
          },
        },
      ];

      const result = await this.ledgerRepository.createTransaction({
        tenantId: accrual.tenantId,
        description: `Fee reversal: ${accrual.id} reason: ${reason}`,
        entries,
        sourceType: LedgerSourceType.FEE,
        sourceId: accrual.id,
        idempotencyKey,
        metadata: { reversal: true, reason, originalAccrualId: accrual.id },
      });

      this.logger.log(`Fee reversal posted accrual=${accrual.id} reason=${reason}`);

      return result;
    } catch (e) {
      this.logger.error(`Failed to reverse accrual ${accrual.id}: ${(e as Error).message}`);
      throw e;
    }
  }

  async getLedgerEntriesForAccrual(accrualId: string, tenantId?: string): Promise<any[]> {
    try {
      const entries = await this.ledgerRepository.findBySource(LedgerSourceType.FEE, accrualId);
      if (tenantId) {
        return entries.filter((e: any) => e.tenantId === tenantId);
      }
      return entries;
    } catch {
      return [];
    }
  }
}
