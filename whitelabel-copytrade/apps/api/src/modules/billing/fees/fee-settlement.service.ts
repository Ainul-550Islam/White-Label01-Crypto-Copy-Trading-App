import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { FeeAuditService } from './fee-audit.service';
import { FeeAccrualStatus, SettlementState, FeeType, FeeSourceType } from './fee.types';
import { parseToMinorUnits, formatFromMinorUnits, getMinorUnitForCurrency } from '../finance/money.types';
import { BillingEventService } from '../notifications/billing-event.service';

/**
 * Settlement processing: identifies eligible accruals, prevents double settlement,
 * groups by tenant/currency, calculates totals server-side.
 * Settlement separate from payout execution.
 */
@Injectable()
export class FeeSettlementService {
  private readonly logger = new Logger(FeeSettlementService.name);

  constructor(
    private readonly accrualRepository: FeeAccrualRepository,
    private readonly settlementRepository: FeeSettlementRepository,
    private readonly auditService: FeeAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async previewSettlement(params: {
    tenantId: string;
    currency?: string;
    feeType?: FeeType;
    accrualIds?: string[];
    limit?: number;
  }): Promise<{
    tenantId: string;
    currency: string;
    eligibleAccruals: any[];
    grossFeeAmount: string;
    finalSettlementAmount: string;
    numberOfAccruals: number;
    feeType: FeeType | 'MIXED';
  }> {
    const currency = params.currency || 'USD';
    let accruals: any[] = [];

    if (params.accrualIds && params.accrualIds.length > 0) {
      // Validate provided accrual IDs are eligible
      for (const id of params.accrualIds) {
        const accrual = await this.accrualRepository.findById(id, params.tenantId);
        if (!accrual) continue;
        if (accrual.status !== FeeAccrualStatus.ACCRUED) continue;
        if (accrual.settlementState !== SettlementState.DRAFT && accrual.settlementState !== SettlementState.CALCULATED) continue;
        if (params.currency && accrual.currency !== params.currency) continue;
        if (params.feeType && accrual.feeType !== params.feeType) continue;
        accruals.push(accrual);
      }
    } else {
      accruals = await this.accrualRepository.listEligibleForSettlement(params.tenantId, currency, params.feeType, params.limit || 100);
    }

    if (accruals.length === 0) {
      return {
        tenantId: params.tenantId,
        currency,
        eligibleAccruals: [],
        grossFeeAmount: formatFromMinorUnits(0, currency),
        finalSettlementAmount: formatFromMinorUnits(0, currency),
        numberOfAccruals: 0,
        feeType: params.feeType || 'MIXED',
      };
    }

    // Server-calculated totals (never trust client)
    let totalMinor = 0;
    const feeTypes = new Set<FeeType>();
    for (const accrual of accruals) {
      try {
        const minor = parseToMinorUnits(accrual.feeAmount, accrual.currency);
        totalMinor += minor;
        feeTypes.add(accrual.feeType);
      } catch {}
    }

    const grossFeeAmount = formatFromMinorUnits(totalMinor, currency);
    const feeTypeResult: FeeType | 'MIXED' = feeTypes.size === 1 ? (Array.from(feeTypes)[0] as FeeType) : 'MIXED';

    return {
      tenantId: params.tenantId,
      currency,
      eligibleAccruals: accruals,
      grossFeeAmount,
      finalSettlementAmount: grossFeeAmount,
      numberOfAccruals: accruals.length,
      feeType: feeTypeResult,
    };
  }

  async createSettlement(params: {
    tenantId: string;
    currency?: string;
    feeType?: FeeType;
    accrualIds?: string[];
    idempotencyKey?: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<any> {
    const idempotencyKey = params.idempotencyKey || `settlement_${params.tenantId}_${params.currency || 'USD'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Idempotency check
    const existingByKey = await this.settlementRepository.findByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent settlement return by key: ${idempotencyKey}`);
      return existingByKey;
    }

    const preview = await this.previewSettlement({
      tenantId: params.tenantId,
      currency: params.currency,
      feeType: params.feeType,
      accrualIds: params.accrualIds,
    });

    if (preview.numberOfAccruals === 0) {
      throw new Error('No eligible accruals for settlement');
    }

    // Create settlement record
    const settlement = await this.settlementRepository.createSettlement({
      tenantId: params.tenantId,
      currency: preview.currency,
      grossFeeAmount: preview.grossFeeAmount,
      adjustments: '0',
      finalSettlementAmount: preview.finalSettlementAmount,
      numberOfAccruals: preview.numberOfAccruals,
      feeType: preview.feeType,
      status: SettlementState.CALCULATED,
      idempotencyKey,
      accrualIds: preview.eligibleAccruals.map((a: any) => a.id),
      metadata: params.metadata,
    });

    // Mark accruals as settled only after valid settlement creation (transactional intention)
    for (const accrual of preview.eligibleAccruals) {
      try {
        // Prevent double settlement: check if already settled
        if (accrual.settlementId) {
          this.logger.warn(`Accrual ${accrual.id} already settled in ${accrual.settlementId}, skipping`);
          continue;
        }
        await this.accrualRepository.updateStatus(accrual.id, {
          settlementState: SettlementState.CALCULATED,
          settlementId: settlement.id,
          settlementTimestamp: new Date().toISOString(),
        });
      } catch (e) {
        this.logger.warn(`Failed to mark accrual ${accrual.id} as settled: ${(e as Error).message}`);
      }
    }

    await this.auditService.logSettlementCreated(params.tenantId, settlement.id, settlement.finalSettlementAmount, settlement.currency, preview.numberOfAccruals);

    this.logger.log(`Settlement created id=${settlement.id} tenant=${params.tenantId} amount=${settlement.finalSettlementAmount} ${settlement.currency} accruals=${preview.numberOfAccruals}`);

    return settlement;
  }

  async approveSettlement(settlementId: string, tenantId: string, actorId?: string): Promise<any> {
    const settlement = await this.settlementRepository.findById(settlementId, tenantId);
    if (!settlement) throw new Error(`Settlement not found: ${settlementId}`);

    if (settlement.status !== SettlementState.CALCULATED && settlement.status !== SettlementState.DRAFT) {
      throw new Error(`Settlement ${settlementId} cannot be approved from status ${settlement.status}`);
    }

    const updated = await this.settlementRepository.updateStatus(settlementId, SettlementState.APPROVED, {
      approvedAt: new Date().toISOString(),
    });

    // Update accruals to APPROVED
    for (const accrualId of settlement.accrualIds) {
      try {
        await this.accrualRepository.updateStatus(accrualId, {
          settlementState: SettlementState.APPROVED,
        });
      } catch {}
    }

    await this.auditService.logSettlementApproved(tenantId, settlementId, settlement.finalSettlementAmount, settlement.currency);

    return updated;
  }

  async finalizeSettlement(settlementId: string, tenantId: string, actorId?: string): Promise<any> {
    const settlement = await this.settlementRepository.findById(settlementId, tenantId);
    if (!settlement) throw new Error(`Settlement not found: ${settlementId}`);

    if (settlement.status !== SettlementState.APPROVED && settlement.status !== SettlementState.CALCULATED) {
      throw new Error(`Settlement ${settlementId} cannot be finalized from status ${settlement.status}`);
    }

    const updated = await this.settlementRepository.updateStatus(settlementId, SettlementState.FINALIZED, {
      finalizedAt: new Date().toISOString(),
    });

    for (const accrualId of settlement.accrualIds) {
      try {
        await this.accrualRepository.updateStatus(accrualId, {
          settlementState: SettlementState.FINALIZED,
          status: FeeAccrualStatus.SETTLED,
        });
      } catch {}
    }

    await this.auditService.logSettlementFinalized(tenantId, settlementId, settlement.finalSettlementAmount, settlement.currency);

    this.logger.log(`Settlement finalized id=${settlementId} tenant=${tenantId} amount=${settlement.finalSettlementAmount}`);

    if (this.billingEventService) {
      this.billingEventService.onFeeSettlementFinalized({
        tenantId,
        settlementId,
        amount: settlement.finalSettlementAmount,
        currency: settlement.currency,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger settlement finalized notification: ${e.message}`));
    }

    return updated;
  }

  async getSettlement(settlementId: string, tenantId?: string): Promise<any> {
    const settlement = await this.settlementRepository.findById(settlementId, tenantId);
    if (!settlement) throw new Error(`Settlement not found: ${settlementId}`);
    const items = await this.settlementRepository.getSettlementItems(settlementId);
    return { ...settlement, items };
  }

  async listSettlements(
    tenantId: string,
    filter?: { status?: SettlementState; currency?: string; feeType?: FeeType | 'MIXED'; fromDate?: Date; toDate?: Date; limit?: number; offset?: number },
  ): Promise<any[]> {
    return this.settlementRepository.listByTenant(tenantId, filter);
  }

  async retryFailedSettlement(settlementId: string, tenantId: string, actorId?: string): Promise<any> {
    const settlement = await this.settlementRepository.findById(settlementId, tenantId);
    if (!settlement) throw new Error(`Settlement not found: ${settlementId}`);

    if (settlement.status !== SettlementState.FAILED) {
      throw new Error(`Only FAILED settlements can be retried, current status: ${settlement.status}`);
    }

    const updated = await this.settlementRepository.updateStatus(settlementId, SettlementState.CALCULATED, {
      finalizedAt: null,
    });

    for (const accrualId of settlement.accrualIds) {
      try {
        await this.accrualRepository.updateStatus(accrualId, {
          settlementState: SettlementState.CALCULATED,
        });
      } catch {}
    }

    await this.auditService.logSettlementCreated(tenantId, settlementId, settlement.finalSettlementAmount, settlement.currency, settlement.numberOfAccruals);

    return updated;
  }
}
