import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { PayoutProviderFactory } from './payout-provider.factory';
import { FeeAuditService } from './fee-audit.service';
import { PayoutStatus, PayoutProvider, BeneficiaryType, PayoutDestination } from './payout.types';
import { SettlementState } from './fee.types';
import { parseToMinorUnits, formatFromMinorUnits } from '../finance/money.types';
import { BillingEventService } from '../notifications/billing-event.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Main payout orchestration: finalized settlement -> payout eligibility -> beneficiary validation
 * -> create payout -> provider confirmation -> state update -> settlement sync -> audit
 * Idempotent, no amount greater than settlement, currency validation, concurrency protection.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly settlementRepository: FeeSettlementRepository,
    private readonly providerFactory: PayoutProviderFactory,
    private readonly auditService: FeeAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
    // Phase 3: beneficiary ownership checks read the canonical trader/user
    // tables. Optional for harness construction; without it a TRADER payout
    // is refused (fail closed) rather than paid to an unverified party.
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async createPayout(params: {
    settlementId: string;
    tenantId: string;
    beneficiaryId: string;
    beneficiaryType: BeneficiaryType;
    amount?: string; // If not provided, uses settlement final amount
    currency?: string;
    destination: PayoutDestination;
    provider?: PayoutProvider;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<any> {
    const idempotencyKey = params.idempotencyKey || `payout_${params.settlementId}_${params.beneficiaryId}_${params.tenantId}`;

    // Idempotency check
    const existingByKey = await this.payoutRepository.findByIdempotencyKey(idempotencyKey, params.tenantId);
    if (existingByKey) {
      this.logger.log(`Idempotent payout return by idempotencyKey: ${idempotencyKey}`);
      return existingByKey;
    }

    // Validate settlement exists and is finalized
    const settlement = await this.settlementRepository.findById(params.settlementId, params.tenantId);
    if (!settlement) {
      throw new Error(`Settlement not found: ${params.settlementId}`);
    }

    if (settlement.status !== SettlementState.FINALIZED && settlement.status !== SettlementState.APPROVED) {
      throw new Error(`Payout requires finalized settlement, current status: ${settlement.status}`);
    }

    // Currency validation
    const currency = params.currency || settlement.currency;
    if (currency !== settlement.currency) {
      throw new Error(`Currency mismatch: payout ${currency} vs settlement ${settlement.currency}`);
    }

    // Amount validation - cannot exceed finalized settlement
    const requestedAmount = params.amount || settlement.finalSettlementAmount;
    try {
      const requestedMinor = parseToMinorUnits(requestedAmount, currency);
      const settlementMinor = parseToMinorUnits(settlement.finalSettlementAmount, settlement.currency);
      if (requestedMinor > settlementMinor) {
        throw new Error(`Payout amount ${requestedAmount} exceeds finalized settlement ${settlement.finalSettlementAmount}`);
      }
      if (requestedMinor <= 0) {
        throw new Error('Payout amount must be positive');
      }
    } catch (e: any) {
      if (e.message.includes('exceeds') || e.message.includes('positive')) throw e;
      throw new Error(`Invalid payout amount: ${requestedAmount} - ${e.message}`);
    }

    // Beneficiary ownership validation - tenant-scoped
    if (params.beneficiaryType === BeneficiaryType.TRADER) {
      if (!params.beneficiaryId) {
        throw new Error('Beneficiary ID required for trader payout');
      }
      await this.assertTraderBelongsToTenant(params.tenantId, params.beneficiaryId);
    }
    if (params.beneficiaryType === BeneficiaryType.TENANT && params.beneficiaryId && params.beneficiaryId !== params.tenantId) {
      throw new Error('Tenant payout beneficiary must be the tenant itself');
    }

    // Validate provider availability
    const provider = params.provider || PayoutProvider.MANUAL;
    const providerInstance = this.providerFactory.getProvider(provider);
    if (!providerInstance.isAvailable()) {
      const configCheck = this.providerFactory.validateProviderConfiguration();
      this.logger.error(`Payout provider not available: ${provider} - ${configCheck.message}`);
      // Create payout record with FAILED status to keep audit trail, not fake success
      const failedPayout = await this.payoutRepository.create({
        settlementId: params.settlementId,
        beneficiaryId: params.beneficiaryId,
        beneficiaryType: params.beneficiaryType,
        tenantId: params.tenantId,
        amount: requestedAmount,
        currency,
        destination: this.sanitizeDestination(params.destination),
        provider,
        providerPayoutId: null,
        providerReference: null,
        status: PayoutStatus.FAILED,
        failureReason: configCheck.message,
        idempotencyKey,
        metadata: params.metadata,
        safeMetadata: this.sanitizeSafeMetadata(params.metadata),
      });

      await this.auditService.logPayoutFailed(params.tenantId, failedPayout.id, params.settlementId, configCheck.message);

      throw new Error(configCheck.message);
    }

    // Create payout record with CREATED status
    const payout = await this.payoutRepository.create({
      settlementId: params.settlementId,
      beneficiaryId: params.beneficiaryId,
      beneficiaryType: params.beneficiaryType,
      tenantId: params.tenantId,
      amount: requestedAmount,
      currency,
      destination: this.sanitizeDestination(params.destination),
      provider,
      providerPayoutId: null,
      providerReference: null,
      status: PayoutStatus.CREATED,
      failureReason: null,
      idempotencyKey,
      metadata: params.metadata,
      safeMetadata: this.sanitizeSafeMetadata(params.metadata),
    });

    await this.auditService.logPayoutCreated(params.tenantId, payout.id, params.settlementId, requestedAmount, currency);

    // Execute payout via provider
    try {
      const providerResult = await providerInstance.createPayout({
        settlementId: params.settlementId,
        beneficiaryId: params.beneficiaryId,
        beneficiaryType: params.beneficiaryType,
        tenantId: params.tenantId,
        amount: requestedAmount,
        currency,
        destination: this.sanitizeDestination(params.destination),
        provider,
        idempotencyKey,
        metadata: params.metadata,
      });

      // Update payout with provider references and status
      const updated = await this.payoutRepository.updateStatus(payout.id, {
        status: providerResult.status,
        providerPayoutId: providerResult.providerPayoutId,
        providerReference: providerResult.providerReference || null,
        failureReason: providerResult.failureReason || null,
        processedAt: providerResult.status === PayoutStatus.PROCESSING || providerResult.status === PayoutStatus.PENDING ? new Date().toISOString() : null,
        succeededAt: providerResult.status === PayoutStatus.SUCCEEDED ? new Date().toISOString() : null,
        failedAt: providerResult.status === PayoutStatus.FAILED ? new Date().toISOString() : null,
      });

      if (providerResult.status === PayoutStatus.PROCESSING || providerResult.status === PayoutStatus.PENDING) {
        await this.auditService.logPayoutProcessing(params.tenantId, payout.id, params.settlementId, providerResult.providerPayoutId);
      } else if (providerResult.status === PayoutStatus.SUCCEEDED) {
        await this.auditService.logPayoutSucceeded(params.tenantId, payout.id, params.settlementId, requestedAmount, currency, providerResult.providerPayoutId);
        // Sync settlement to PAID if all payouts succeeded? For simplicity, mark settlement PAID when payout succeeds
        try {
          await this.settlementRepository.updateStatus(params.settlementId, SettlementState.PAID, {
            paidAt: new Date().toISOString(),
          });
        } catch {}
        if (this.billingEventService) {
          this.billingEventService.onPayoutSucceeded({
            tenantId: params.tenantId,
            payoutId: payout.id,
            settlementId: params.settlementId,
            amount: requestedAmount,
            currency,
            payoutStatus: providerResult.status,
            supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
            appName: process.env.APP_NAME || 'WLCT',
          }).catch((e) => this.logger.warn(`Failed to trigger payout succeeded notification: ${e.message}`));
        }
      } else if (providerResult.status === PayoutStatus.FAILED) {
        await this.auditService.logPayoutFailed(params.tenantId, payout.id, params.settlementId, providerResult.failureReason || 'Provider failed');
        if (this.billingEventService) {
          this.billingEventService.onPayoutFailed({
            tenantId: params.tenantId,
            payoutId: payout.id,
            settlementId: params.settlementId,
            amount: requestedAmount,
            currency,
            payoutStatus: providerResult.status,
            supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
            appName: process.env.APP_NAME || 'WLCT',
          }).catch((e) => this.logger.warn(`Failed to trigger payout failed notification: ${e.message}`));
        }
      }

      this.logger.log(`Payout created id=${payout.id} settlement=${params.settlementId} provider=${provider} status=${providerResult.status} amount=${requestedAmount} ${currency}`);

      return updated || payout;
    } catch (error: any) {
      // Provider execution failed - mark payout as FAILED, not successful
      this.logger.error(`Payout provider execution failed for ${payout.id}: ${error.message}`);

      const failed = await this.payoutRepository.updateStatus(payout.id, {
        status: PayoutStatus.FAILED,
        failureReason: error.message,
        failedAt: new Date().toISOString(),
      });

      await this.auditService.logPayoutFailed(params.tenantId, payout.id, params.settlementId, error.message);

      throw error;
    }
  }

  async getPayoutStatus(payoutId: string, tenantId: string): Promise<any> {
    const payout = await this.payoutRepository.findById(payoutId, tenantId);
    if (!payout) throw new Error(`Payout not found: ${payoutId}`);

    // If payout already in final state, return
    if ([PayoutStatus.SUCCEEDED, PayoutStatus.FAILED, PayoutStatus.CANCELLED, PayoutStatus.REVERSED].includes(payout.status)) {
      return payout;
    }

    // If has provider payout ID, check provider for updated status (provider confirmation required)
    if (payout.providerPayoutId) {
      try {
        const provider = this.providerFactory.getProvider(payout.provider);
        if (provider.isAvailable()) {
          const statusResult = await provider.getPayoutStatus(payout.providerPayoutId);

          // Only update if provider status is different and more advanced
          if (statusResult.status !== payout.status) {
            const updated = await this.payoutRepository.updateStatus(payout.id, {
              status: statusResult.status,
              failureReason: statusResult.failureReason || null,
              processedAt: statusResult.processedAt || null,
              succeededAt: statusResult.status === PayoutStatus.SUCCEEDED ? new Date().toISOString() : null,
              failedAt: statusResult.status === PayoutStatus.FAILED ? new Date().toISOString() : null,
            });

            if (statusResult.status === PayoutStatus.SUCCEEDED) {
              await this.auditService.logPayoutSucceeded(tenantId, payout.id, payout.settlementId, payout.amount, payout.currency, payout.providerPayoutId);
              // Sync settlement
              try {
                await this.settlementRepository.updateStatus(payout.settlementId, SettlementState.PAID, {
                  paidAt: new Date().toISOString(),
                });
              } catch {}
            } else if (statusResult.status === PayoutStatus.FAILED) {
              await this.auditService.logPayoutFailed(tenantId, payout.id, payout.settlementId, statusResult.failureReason || 'Provider failed');
            }

            return updated || payout;
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to fetch provider status for payout ${payoutId}: ${(e as Error).message}`);
      }
    }

    return payout;
  }

  async retryPayout(payoutId: string, tenantId: string, actorId?: string): Promise<any> {
    const payout = await this.payoutRepository.findById(payoutId, tenantId);
    if (!payout) throw new Error(`Payout not found: ${payoutId}`);

    if (payout.status !== PayoutStatus.FAILED) {
      throw new Error(`Only FAILED payouts can be retried, current status: ${payout.status}`);
    }

    // Check provider availability
    const provider = this.providerFactory.getProvider(payout.provider);
    if (!provider.isAvailable()) {
      throw new Error(`Payout provider ${payout.provider} not available for retry`);
    }

    try {
      const providerResult = await provider.createPayout({
        settlementId: payout.settlementId,
        beneficiaryId: payout.beneficiaryId,
        beneficiaryType: payout.beneficiaryType,
        tenantId: payout.tenantId,
        amount: payout.amount,
        currency: payout.currency,
        destination: payout.destination,
        provider: payout.provider,
        idempotencyKey: `${payout.idempotencyKey}_retry_${Date.now()}`,
        metadata: payout.metadata || undefined,
      });

      const updated = await this.payoutRepository.updateStatus(payout.id, {
        status: providerResult.status,
        providerPayoutId: providerResult.providerPayoutId,
        providerReference: providerResult.providerReference || null,
        failureReason: providerResult.failureReason || null,
        processedAt: new Date().toISOString(),
        failedAt: null,
      });

      await this.auditService.logPayoutProcessing(tenantId, payout.id, payout.settlementId, providerResult.providerPayoutId);

      return updated;
    } catch (e: any) {
      await this.payoutRepository.updateStatus(payout.id, {
        status: PayoutStatus.FAILED,
        failureReason: e.message,
        failedAt: new Date().toISOString(),
      });
      await this.auditService.logPayoutFailed(tenantId, payout.id, payout.settlementId, e.message);
      throw e;
    }
  }

  async cancelPayout(payoutId: string, tenantId: string, actorId?: string): Promise<any> {
    const payout = await this.payoutRepository.findById(payoutId, tenantId);
    if (!payout) throw new Error(`Payout not found: ${payoutId}`);

    if ([PayoutStatus.SUCCEEDED, PayoutStatus.CANCELLED, PayoutStatus.REVERSED].includes(payout.status)) {
      throw new Error(`Cannot cancel payout in status ${payout.status}`);
    }

    const provider = this.providerFactory.getProvider(payout.provider);
    if (provider.cancelPayout && payout.providerPayoutId) {
      try {
        const result = await provider.cancelPayout(payout.providerPayoutId);
        if (result.cancelled) {
          const updated = await this.payoutRepository.updateStatus(payout.id, {
            status: PayoutStatus.CANCELLED,
            cancelledAt: new Date().toISOString(),
          });
          return updated;
        }
      } catch (e) {
        this.logger.warn(`Provider cancel failed for ${payoutId}: ${(e as Error).message}`);
      }
    }

    // Fallback: mark as cancelled if provider doesn't support cancellation or provider call failed
    const updated = await this.payoutRepository.updateStatus(payout.id, {
      status: PayoutStatus.CANCELLED,
      cancelledAt: new Date().toISOString(),
    });

    return updated;
  }

  async listPayouts(
    tenantId: string,
    filter?: { status?: PayoutStatus; provider?: PayoutProvider; beneficiaryId?: string; currency?: string; fromDate?: Date; toDate?: Date; limit?: number; offset?: number },
  ): Promise<any[]> {
    return this.payoutRepository.listByTenant(tenantId, filter);
  }

  /**
   * A TRADER beneficiary is a TraderProfile (by id or by its user id) of THIS
   * tenant, in good standing. Cross-tenant ids, unknown ids and suspended /
   * rejected traders are refused with the same message (no tenant probing).
   */
  private async assertTraderBelongsToTenant(tenantId: string, beneficiaryId: string): Promise<void> {
    if (!this.prisma) {
      throw new Error('Trader beneficiary verification unavailable');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(beneficiaryId)) {
      throw new Error('Beneficiary is not a trader of this tenant');
    }
    const trader = await this.prisma.traderProfile.findFirst({
      where: { tenantId, OR: [{ id: beneficiaryId }, { userId: beneficiaryId }] },
      select: { id: true, verificationState: true },
    });
    if (!trader) {
      throw new Error('Beneficiary is not a trader of this tenant');
    }
    const state = String(trader.verificationState);
    if (state === 'SUSPENDED' || state === 'REJECTED') {
      throw new Error(`Trader beneficiary is not eligible for payouts (${state})`);
    }
  }

  private sanitizeDestination(destination: PayoutDestination): PayoutDestination {
    // Store only minimum safe reference, never private keys
    return {
      type: destination.type,
      reference: destination.reference, // Should already be safe reference, not private key
      maskedReference: destination.maskedReference,
      currency: destination.currency,
      country: destination.country,
      metadata: destination.metadata ? (this.sanitizeSafeMetadata(destination.metadata) ?? undefined) : undefined,
    };
  }

  private sanitizeSafeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbidden = ['secret', 'privateKey', 'private_key', 'walletKey', 'bankAccount', 'credentials', 'apiKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret', 'seed', 'mnemonic'];
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }
}
