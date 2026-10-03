import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { forEachTenant, listBillableTenantIds } from '../finance/tenant-iteration';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { PayoutRepository } from './payout.repository';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeAuditService } from './fee-audit.service';
import { ReconciliationIssue, FeeAccrualStatus, SettlementState, FeeSourceType } from './fee.types';
import { PayoutStatus } from './payout.types';
import { parseToMinorUnits } from '../finance/money.types';

/**
 * Reconciles source amount -> fee calculation -> accrual -> ledger -> settlement -> payout
 * Detects mismatches, missing links, duplicates, etc. Does NOT silently repair.
 */
@Injectable()
export class FeeReconciliationService {
  private readonly logger = new Logger(FeeReconciliationService.name);

  constructor(
    private readonly accrualRepository: FeeAccrualRepository,
    private readonly settlementRepository: FeeSettlementRepository,
    private readonly payoutRepository: PayoutRepository,
    private readonly ledgerService: FeeLedgerService,
    private readonly auditService: FeeAuditService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async reconcileTenant(tenantId: string, options?: { fromDate?: Date; toDate?: Date; currency?: string }): Promise<{
    tenantId: string;
    checkedAccruals: number;
    checkedSettlements: number;
    checkedPayouts: number;
    issues: ReconciliationIssue[];
    summary: { critical: number; high: number; medium: number; low: number };
  }> {
    const issues: ReconciliationIssue[] = [];

    // Get all accruals for tenant
    const accruals = await this.accrualRepository.listByTenant(tenantId, {
      fromDate: options?.fromDate,
      toDate: options?.toDate,
      currency: options?.currency,
      limit: 1000,
    });

    const settlements = await this.settlementRepository.listByTenant(tenantId, {
      fromDate: options?.fromDate,
      toDate: options?.toDate,
      currency: options?.currency,
      limit: 1000,
    });

    const payouts = await this.payoutRepository.listByTenant(tenantId, {
      fromDate: options?.fromDate,
      toDate: options?.toDate,
      currency: options?.currency,
      limit: 1000,
    });

    // 1. Check accruals without ledger
    for (const accrual of accruals) {
      if (accrual.status === FeeAccrualStatus.ACCRUED || accrual.status === FeeAccrualStatus.SETTLED) {
        try {
          const ledgerEntries = await this.ledgerService.getLedgerEntriesForAccrual(accrual.id, tenantId);
          if (!ledgerEntries || ledgerEntries.length === 0) {
            const issue: ReconciliationIssue = {
              severity: 'HIGH',
              category: 'MISSING_LEDGER',
              sourceType: accrual.sourceType,
              sourceId: accrual.sourceId,
              accrualId: accrual.id,
              currency: accrual.currency,
              description: `Accrual ${accrual.id} has no ledger entry`,
              detectedAt: new Date().toISOString(),
            };
            issues.push(issue);
            await this.auditService.logReconciliationDetected(tenantId, 'MISSING_LEDGER', accrual.id, issue.description, 'HIGH');
          }
        } catch (e) {
          this.logger.warn(`Ledger check failed for accrual ${accrual.id}: ${(e as Error).message}`);
        }
      }
    }

    // 2. Check settlement without eligible accruals
    for (const settlement of settlements) {
      if (settlement.accrualIds.length === 0) {
        issues.push({
          severity: 'MEDIUM',
          category: 'MISSING_LEDGER',
          sourceType: FeeSourceType.MANUAL,
          sourceId: settlement.id,
          settlementId: settlement.id,
          description: `Settlement ${settlement.id} has no accruals`,
          detectedAt: new Date().toISOString(),
        });
      }

      // Check if settlement references accruals that don't exist or are from different tenant
      for (const accrualId of settlement.accrualIds) {
        const accrual = accruals.find((a) => a.id === accrualId);
        if (!accrual) {
          // Try to fetch
          const fetched = await this.accrualRepository.findById(accrualId);
          if (!fetched) {
            issues.push({
              severity: 'HIGH',
              category: 'MISSING_LEDGER',
              sourceType: FeeSourceType.MANUAL,
              sourceId: settlement.id,
              settlementId: settlement.id,
              accrualId,
              description: `Settlement ${settlement.id} references missing accrual ${accrualId}`,
              detectedAt: new Date().toISOString(),
            });
          } else if (fetched.tenantId !== tenantId) {
            issues.push({
              severity: 'CRITICAL',
              category: 'MISSING_LEDGER',
              sourceType: fetched.sourceType,
              sourceId: fetched.sourceId,
              settlementId: settlement.id,
              accrualId,
              description: `Settlement ${settlement.id} references accrual from different tenant ${fetched.tenantId}`,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Check settlement amount vs sum of accruals
      try {
        const items = await this.settlementRepository.getSettlementItems(settlement.id);
        if (items.length > 0) {
          let sumMinor = 0;
          for (const item of items) {
            try {
              sumMinor += parseToMinorUnits(item.feeAmount, item.currency);
            } catch {}
          }
          const settlementMinor = parseToMinorUnits(settlement.finalSettlementAmount, settlement.currency);
          if (sumMinor !== settlementMinor) {
            issues.push({
              severity: 'HIGH',
              category: 'AMOUNT_MISMATCH',
              sourceType: FeeSourceType.MANUAL,
              sourceId: settlement.id,
              settlementId: settlement.id,
              detectedAmount: settlement.finalSettlementAmount,
              expectedAmount: this.formatMinor(sumMinor, settlement.currency),
              currency: settlement.currency,
              description: `Settlement ${settlement.id} amount ${settlement.finalSettlementAmount} != sum of items ${this.formatMinor(sumMinor, settlement.currency)}`,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      } catch {}
    }

    // 3. Check payouts without finalized settlement
    for (const payout of payouts) {
      const settlement = settlements.find((s) => s.id === payout.settlementId);
      if (!settlement) {
        const fetchedSettlement = await this.settlementRepository.findById(payout.settlementId);
        if (!fetchedSettlement) {
          issues.push({
            severity: 'CRITICAL',
            category: 'MISSING_LEDGER',
            sourceType: FeeSourceType.MANUAL,
            sourceId: payout.id,
            settlementId: payout.settlementId,
            payoutId: payout.id,
            description: `Payout ${payout.id} references missing settlement ${payout.settlementId}`,
            detectedAt: new Date().toISOString(),
          });
          continue;
        }
        if (fetchedSettlement.status !== SettlementState.FINALIZED && fetchedSettlement.status !== SettlementState.PAID) {
          issues.push({
            severity: 'HIGH',
            category: 'MISSING_LEDGER',
            sourceType: FeeSourceType.MANUAL,
            sourceId: payout.id,
            settlementId: payout.settlementId,
            payoutId: payout.id,
            description: `Payout ${payout.id} references non-finalized settlement ${payout.settlementId} status=${fetchedSettlement.status}`,
            detectedAt: new Date().toISOString(),
          });
        }
      } else {
        if (settlement.status !== SettlementState.FINALIZED && settlement.status !== SettlementState.PAID) {
          issues.push({
            severity: 'HIGH',
            category: 'MISSING_LEDGER',
            sourceType: FeeSourceType.MANUAL,
            sourceId: payout.id,
            settlementId: payout.settlementId,
            payoutId: payout.id,
            description: `Payout ${payout.id} references non-finalized settlement ${payout.settlementId} status=${settlement.status}`,
            detectedAt: new Date().toISOString(),
          });
        }

        // Payout amount mismatch
        try {
          const payoutMinor = parseToMinorUnits(payout.amount, payout.currency);
          const settlementMinor = parseToMinorUnits(settlement.finalSettlementAmount, settlement.currency);
          if (payoutMinor > settlementMinor) {
            issues.push({
              severity: 'CRITICAL',
              category: 'AMOUNT_MISMATCH',
              sourceType: FeeSourceType.MANUAL,
              sourceId: payout.id,
              settlementId: payout.settlementId,
              payoutId: payout.id,
              detectedAmount: payout.amount,
              expectedAmount: settlement.finalSettlementAmount,
              currency: payout.currency,
              description: `Payout ${payout.id} amount ${payout.amount} exceeds settlement ${settlement.finalSettlementAmount}`,
              detectedAt: new Date().toISOString(),
            });
          }
          if (payout.currency !== settlement.currency) {
            issues.push({
              severity: 'HIGH',
              category: 'CURRENCY_MISMATCH',
              sourceType: FeeSourceType.MANUAL,
              sourceId: payout.id,
              settlementId: payout.settlementId,
              payoutId: payout.id,
              currency: payout.currency,
              description: `Payout ${payout.id} currency ${payout.currency} != settlement currency ${settlement.currency}`,
              detectedAt: new Date().toISOString(),
            });
          }
        } catch {}
      }

      // Missing provider confirmation
      if (payout.status === PayoutStatus.SUCCEEDED && !payout.providerPayoutId) {
        issues.push({
          severity: 'HIGH',
          category: 'MISSING_PROVIDER_CONFIRMATION',
          sourceType: FeeSourceType.MANUAL,
          sourceId: payout.id,
          payoutId: payout.id,
          settlementId: payout.settlementId,
          description: `Payout ${payout.id} marked SUCCEEDED but missing providerPayoutId`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 4. Detect duplicate fees (same source + feeType)
    const sourceMap = new Map<string, number>();
    for (const accrual of accruals) {
      const key = `${accrual.tenantId}_${accrual.sourceType}_${accrual.sourceId}_${accrual.feeType}`;
      sourceMap.set(key, (sourceMap.get(key) || 0) + 1);
    }
    for (const [key, count] of sourceMap) {
      if (count > 1) {
        const [tenantIdPart, sourceType, sourceId, feeType] = key.split('_');
        issues.push({
          severity: 'CRITICAL',
          category: 'DUPLICATE_FEE',
          sourceType: sourceType as FeeSourceType,
          sourceId,
          description: `Duplicate fee accruals detected for key ${key}: count=${count}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 5. Detect duplicate payouts (same settlement + beneficiary)
    const payoutMap = new Map<string, number>();
    for (const payout of payouts) {
      const key = `${payout.settlementId}_${payout.beneficiaryId}_${payout.amount}_${payout.currency}`;
      payoutMap.set(key, (payoutMap.get(key) || 0) + 1);
    }
    for (const [key, count] of payoutMap) {
      if (count > 1) {
        issues.push({
          severity: 'CRITICAL',
          category: 'DUPLICATE_PAYOUT',
          sourceType: FeeSourceType.MANUAL,
          sourceId: key,
          description: `Duplicate payouts detected for key ${key}: count=${count}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Summary
    const summary = {
      critical: issues.filter((i) => i.severity === 'CRITICAL').length,
      high: issues.filter((i) => i.severity === 'HIGH').length,
      medium: issues.filter((i) => i.severity === 'MEDIUM').length,
      low: issues.filter((i) => i.severity === 'LOW').length,
    };

    this.logger.log(`Reconciliation tenant=${tenantId} accruals=${accruals.length} settlements=${settlements.length} payouts=${payouts.length} issues=${issues.length} critical=${summary.critical}`);

    return {
      tenantId,
      checkedAccruals: accruals.length,
      checkedSettlements: settlements.length,
      checkedPayouts: payouts.length,
      issues,
      summary,
    };
  }

  async reconcileAllTenants(options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<any[]> {
    const tenantIds = await listBillableTenantIds(this.prisma, options?.limit ?? 1000);
    const results = await forEachTenant(tenantIds, (tenantId) => this.reconcileTenant(tenantId, { fromDate: options?.fromDate, toDate: options?.toDate }));
    const failed = results.filter((r) => r.error).length;
    this.logger.log(`Fee reconciliation all tenants=${tenantIds.length} failed=${failed}`);
    return results.map((r) => (r.error ? { tenantId: r.tenantId, error: r.error } : r.result));
  }

  private formatMinor(minor: number, currency: string): string {
    try {
      const { formatFromMinorUnits } = require('../finance/money.types');
      return formatFromMinorUnits(minor, currency);
    } catch {
      return minor.toString();
    }
  }
}
