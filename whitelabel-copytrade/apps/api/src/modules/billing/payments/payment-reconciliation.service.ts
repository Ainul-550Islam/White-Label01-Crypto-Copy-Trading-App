import { Injectable, Logger } from '@nestjs/common';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentEventsAuditService } from './payment-events.audit';
import { PaymentSubscriptionSyncService } from './payment-subscription-sync.service';
import { PaymentStatus, PaymentProvider, isValidPaymentTransition } from './payment.types';
import type { PaymentRecord } from './payment.types';

/**
 * Detects provider/internal status mismatches, retrieves provider state when
 * necessary, and safely reconciles payment state without blindly trusting
 * stale webhook data.
 *
 * Handles:
 *  provider says SUCCEEDED, internal says PENDING
 *  provider says FAILED, internal says PROCESSING
 *  provider says REFUNDED, internal says SUCCEEDED
 *
 * Must verify provider state before changing internal state when necessary.
 * Do not blindly trust webhook ordering.
 * Do not downgrade a valid final state without an explicitly supported transition.
 */

export interface ReconciliationResult {
  paymentId: string;
  tenantId: string;
  provider: PaymentProvider;
  internalStatusBefore: PaymentStatus;
  providerStatus: PaymentStatus;
  internalStatusAfter: PaymentStatus;
  reconciled: boolean;
  reason: string;
  shouldSyncSubscription: boolean;
}

export interface ReconciliationReport {
  totalChecked: number;
  totalMismatched: number;
  totalReconciled: number;
  totalFailed: number;
  totalSkipped: number;
  results: ReconciliationResult[];
}

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentService: PaymentService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly audit: PaymentEventsAuditService,
    private readonly subscriptionSync: PaymentSubscriptionSyncService,
  ) {}

  async reconcilePayment(paymentId: string): Promise<ReconciliationResult> {
    const internalPayment = await this.paymentService.getPaymentById(paymentId);

    this.logger.log(`Reconciling payment ${paymentId}: internal status ${internalPayment.status}, provider ${internalPayment.provider}`);

    try {
      // Retrieve current state from provider
      const provider = this.providerFactory.getProvider(internalPayment.provider);
      const providerResult = await provider.retrievePayment({
        providerPaymentId: internalPayment.providerPaymentId || undefined,
        providerCheckoutId: internalPayment.providerCheckoutId || undefined,
        providerSessionId: internalPayment.providerSessionId || undefined,
        providerInvoiceId: internalPayment.providerInvoiceId || undefined,
      });

      const providerStatus = providerResult.status;
      const internalStatusBefore = internalPayment.status;

      // Check if statuses match
      if (providerStatus === internalStatusBefore) {
        this.logger.log(`Payment ${paymentId} already in sync: ${internalStatusBefore}`);

        return {
          paymentId,
          tenantId: internalPayment.tenantId,
          provider: internalPayment.provider,
          internalStatusBefore,
          providerStatus,
          internalStatusAfter: internalStatusBefore,
          reconciled: false,
          reason: 'Already in sync',
          shouldSyncSubscription: false,
        };
      }

      // Validate transition from internal to provider status
      if (!isValidPaymentTransition(internalStatusBefore, providerStatus)) {
        this.logger.warn(`Reconciliation transition rejected: ${internalStatusBefore} → ${providerStatus} for payment ${paymentId} - invalid transition`);

        await this.audit.logPaymentEvent({
          tenantId: internalPayment.tenantId,
          paymentId,
          provider: internalPayment.provider,
          action: 'PAYMENT_RECONCILED',
          status: internalStatusBefore,
          planId: internalPayment.planId,
          metadata: {
            reconciled: false,
            reason: 'invalid_transition',
            internalStatusBefore,
            providerStatus,
            attemptedAfter: providerStatus,
          },
        });

        return {
          paymentId,
          tenantId: internalPayment.tenantId,
          provider: internalPayment.provider,
          internalStatusBefore,
          providerStatus,
          internalStatusAfter: internalStatusBefore,
          reconciled: false,
          reason: `Invalid transition: ${internalStatusBefore} → ${providerStatus}`,
          shouldSyncSubscription: false,
        };
      }

      // Do not downgrade a valid final state without explicitly supported transition
      // Final states: SUCCEEDED, REFUNDED, DISPUTED, CANCELLED, EXPIRED, FAILED (in some cases)
      const finalStates = [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.DISPUTED, PaymentStatus.CANCELLED];
      const isDowngrade = finalStates.includes(internalStatusBefore) && ![PaymentStatus.REFUNDED, PaymentStatus.DISPUTED, PaymentStatus.PARTIALLY_REFUNDED].includes(providerStatus);

      if (isDowngrade) {
        this.logger.warn(`Reconciliation downgrade rejected: ${internalStatusBefore} → ${providerStatus} for payment ${paymentId} - final state downgrade`);

        await this.audit.logPaymentEvent({
          tenantId: internalPayment.tenantId,
          paymentId,
          provider: internalPayment.provider,
          action: 'PAYMENT_RECONCILED',
          status: internalStatusBefore,
          planId: internalPayment.planId,
          metadata: {
            reconciled: false,
            reason: 'final_state_downgrade_rejected',
            internalStatusBefore,
            providerStatus,
          },
        });

        return {
          paymentId,
          tenantId: internalPayment.tenantId,
          provider: internalPayment.provider,
          internalStatusBefore,
          providerStatus,
          internalStatusAfter: internalStatusBefore,
          reconciled: false,
          reason: `Final state downgrade rejected: ${internalStatusBefore} → ${providerStatus}`,
          shouldSyncSubscription: false,
        };
      }

      // Apply provider status to internal record
      const updatedPayment = await this.paymentService.applyProviderResult(paymentId, providerResult);

      const shouldSyncSubscription = this.shouldSyncSubscriptionForReconciliation(internalStatusBefore, providerStatus);

      if (shouldSyncSubscription) {
        try {
          await this.subscriptionSync.syncPaymentToSubscription(updatedPayment);
          this.logger.log(`Reconciled payment ${paymentId} synced to subscription`);
        } catch (syncError) {
          this.logger.error(`Failed to sync reconciled payment ${paymentId} to subscription: ${(syncError as Error).message}`);
        }
      }

      await this.audit.logPaymentEvent({
        tenantId: internalPayment.tenantId,
        paymentId,
        provider: internalPayment.provider,
        action: 'PAYMENT_RECONCILED',
        status: providerStatus,
        planId: internalPayment.planId,
        amount: internalPayment.amount,
        currency: internalPayment.currency,
        metadata: {
          reconciled: true,
          internalStatusBefore,
          providerStatus,
          internalStatusAfter: updatedPayment.status,
          shouldSyncSubscription,
        },
      });

      this.logger.log(`Payment ${paymentId} reconciled: ${internalStatusBefore} → ${providerStatus} (provider says ${providerResult.rawProviderStatus})`);

      return {
        paymentId,
        tenantId: internalPayment.tenantId,
        provider: internalPayment.provider,
        internalStatusBefore,
        providerStatus,
        internalStatusAfter: updatedPayment.status,
        reconciled: true,
        reason: `Reconciled from provider: ${providerResult.rawProviderStatus} → ${providerStatus}`,
        shouldSyncSubscription,
      };
    } catch (error) {
      this.logger.error(`Reconciliation failed for payment ${paymentId}: ${(error as Error).message}`);

      await this.audit.logPaymentEvent({
        tenantId: internalPayment.tenantId,
        paymentId,
        provider: internalPayment.provider,
        action: 'PAYMENT_RECONCILED',
        status: internalPayment.status,
        planId: internalPayment.planId,
        error: (error as Error).message,
        metadata: { reconciled: false, reason: 'reconciliation_error' },
      });

      throw error;
    }
  }

  async reconcilePaymentsByTenant(tenantId: string): Promise<ReconciliationReport> {
    const payments = await this.paymentRepository.list({ tenantId });

    return this.reconcilePaymentList(payments);
  }

  async reconcilePendingPayments(): Promise<ReconciliationReport> {
    // Find payments that are in pending/processing state and older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const pendingPayments = await this.paymentRepository.list({
      status: PaymentStatus.PENDING as any,
    });

    const processingPayments = await this.paymentRepository.list({
      status: PaymentStatus.PROCESSING as any,
    });

    const allPending = [...pendingPayments, ...processingPayments].filter((p) => p.createdAt < fiveMinutesAgo);

    return this.reconcilePaymentList(allPending);
  }

  async reconcilePaymentList(payments: PaymentRecord[]): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      totalChecked: payments.length,
      totalMismatched: 0,
      totalReconciled: 0,
      totalFailed: 0,
      totalSkipped: 0,
      results: [],
    };

    for (const payment of payments) {
      try {
        const result = await this.reconcilePayment(payment.id);

        report.results.push(result);

        if (result.internalStatusBefore !== result.providerStatus) {
          report.totalMismatched++;
        }

        if (result.reconciled) {
          report.totalReconciled++;
        } else {
          report.totalSkipped++;
        }
      } catch (error) {
        report.totalFailed++;

        report.results.push({
          paymentId: payment.id,
          tenantId: payment.tenantId,
          provider: payment.provider,
          internalStatusBefore: payment.status,
          providerStatus: PaymentStatus.UNKNOWN,
          internalStatusAfter: payment.status,
          reconciled: false,
          reason: `Reconciliation error: ${(error as Error).message}`,
          shouldSyncSubscription: false,
        });
      }
    }

    this.logger.log(`Reconciliation report: checked ${report.totalChecked}, mismatched ${report.totalMismatched}, reconciled ${report.totalReconciled}, failed ${report.totalFailed}, skipped ${report.totalSkipped}`);

    return report;
  }

  async checkForMismatches(tenantId?: string): Promise<{ mismatches: ReconciliationResult[]; total: number }> {
    const filter: any = {};
    if (tenantId) filter.tenantId = tenantId;

    const payments = await this.paymentRepository.list(filter);
    const mismatches: ReconciliationResult[] = [];

    for (const payment of payments) {
      // Only check payments that are not in final states and are older than 1 minute
      const isFinal = [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED].includes(payment.status);
      if (isFinal) continue;

      const ageMinutes = (Date.now() - payment.createdAt.getTime()) / (60 * 1000);
      if (ageMinutes < 1) continue;

      try {
        const provider = this.providerFactory.getProvider(payment.provider);
        const providerResult = await provider.retrievePayment({
          providerPaymentId: payment.providerPaymentId || undefined,
          providerCheckoutId: payment.providerCheckoutId || undefined,
          providerSessionId: payment.providerSessionId || undefined,
          providerInvoiceId: payment.providerInvoiceId || undefined,
        });

        if (providerResult.status !== payment.status) {
          mismatches.push({
            paymentId: payment.id,
            tenantId: payment.tenantId,
            provider: payment.provider,
            internalStatusBefore: payment.status,
            providerStatus: providerResult.status,
            internalStatusAfter: payment.status,
            reconciled: false,
            reason: `Mismatch detected: internal ${payment.status} vs provider ${providerResult.status} (${providerResult.rawProviderStatus})`,
            shouldSyncSubscription: this.shouldSyncSubscriptionForReconciliation(payment.status, providerResult.status),
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to check mismatch for payment ${payment.id}: ${(error as Error).message}`);
      }
    }

    return { mismatches, total: payments.length };
  }

  private shouldSyncSubscriptionForReconciliation(from: PaymentStatus, to: PaymentStatus): boolean {
    // Only sync if transitioning to a meaningful final state
    const syncTransitions = [
      PaymentStatus.SUCCEEDED,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
      PaymentStatus.DISPUTED,
    ];

    return syncTransitions.includes(to) && from !== to;
  }
}
