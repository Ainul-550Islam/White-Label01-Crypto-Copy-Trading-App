import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { InvoiceRepository } from './invoice.repository';
import { InvoiceNumberService } from './invoice-number.service';
import { TaxService } from './tax.service';
import { FinanceAuditService } from './finance.audit';
import { PaymentService } from '../payments/payment.service';
import { PlansService } from '../plans.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingEventService } from '../notifications/billing-event.service';
import type { InvoiceRecord, CreateInvoiceInput, InvoiceStatus, InvoiceLineType, DiscountType } from './invoice.types';
import { InvoiceStatus as InvoiceStatusEnum, isValidInvoiceTransition } from './invoice.types';
import type { Money } from './money.types';
import { createMoney, addMoney, subtractMoney, sumMoney, parseToMinorUnits, formatFromMinorUnits, getMinorUnitForCurrency } from './money.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';
import { BillingInterval } from '@wlct/shared-types';

/**
 * Main invoice orchestration: generate invoice from canonical plan/payment/subscription data,
 * calculate totals, persist invoice, finalize lifecycle, and expose invoice retrieval.
 *
 * Critical rule: The invoice price must come from the canonical billing plan/payment record.
 * Do NOT recalculate Basic/Standard/Premium pricing from hardcoded values.
 * The service must be idempotent for the same successful payment/subscription transaction.
 */

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly invoiceNumberService: InvoiceNumberService,
    private readonly taxService: TaxService,
    private readonly paymentService: PaymentService,
    private readonly plansService: PlansService,
    private readonly audit: FinanceAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async createInvoiceFromPayment(paymentId: string): Promise<InvoiceRecord> {
    // Idempotency: check if invoice already exists for this payment
    const existingInvoice = await this.invoiceRepository.findByPaymentId(paymentId);
    if (existingInvoice) {
      this.logger.log(`Idempotent invoice creation: payment ${paymentId} already has invoice ${existingInvoice.id}`);
      return existingInvoice;
    }

    // Get canonical payment record - price comes from here, not hardcoded
    const payment = await this.paymentService.getPaymentById(paymentId);

    if (payment.status !== 'SUCCEEDED' as any) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Invoice can only be created for succeeded payments, current status: ${payment.status}`,
        context: { paymentId, status: payment.status },
      });
    }

    // Get canonical plan from catalog - price must come from plan definition
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: payment.planId },
    });

    if (!plan) {
      throw new AppException({
        code: ErrorCode.NOT_FOUND,
        message: `Plan not found: ${payment.planId}`,
      });
    }

    // Get tenant billing customer
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payment.tenantId },
      select: { id: true, name: true, slug: true, contactEmail: true },
    });

    if (!tenant) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    // Build invoice lines from canonical data
    const currency = payment.currency;
    const planPriceMoney = createMoney(plan.price.toString(), currency);

    const lines: CreateInvoiceInput['lines'] = [
      {
        type: 'SUBSCRIPTION' as any,
        description: `${plan.name} - ${plan.interval} subscription`,
        quantity: 1,
        unitPrice: planPriceMoney,
        amount: planPriceMoney,
        planId: plan.id,
        subscriptionId: payment.subscriptionId || undefined,
        billingPeriodStart: new Date().toISOString(),
        billingPeriodEnd: this.calculatePeriodEnd(new Date(), plan.interval as BillingInterval).toISOString(),
        metadata: {
          planCode: plan.code,
          billingInterval: plan.interval,
        },
      },
    ];

    // Apply discount if supported by existing billing configuration
    // For now, no discount unless metadata contains it
    if ((payment as any).metadata?.discount) {
      const discount = (payment as any).metadata.discount;
      if (discount.amount) {
        const discountMoney = createMoney(discount.amount, currency);
        lines.push({
          type: 'DISCOUNT' as any,
          description: discount.description || 'Discount',
          quantity: 1,
          unitPrice: discountMoney,
          amount: discountMoney,
          discountType: 'FIXED_AMOUNT' as any,
          discountValue: discount.amount,
        });
      }
    }

    // Calculate tax using tax service - not hardcoded rates
    const subtotalMoney = planPriceMoney;
    const taxResult = await this.taxService.calculateTax({
      tenantId: payment.tenantId,
      amount: subtotalMoney,
      currency,
      billingCountry: (tenant as any).countryCode || 'US',
      taxId: undefined,
      isBusinessCustomer: false,
    });

    if (taxResult.taxAmount && parseToMinorUnits(taxResult.taxAmount.amount, currency) > 0) {
      lines.push({
        type: 'TAX' as any,
        description: `Tax (${(taxResult.taxRate / 100).toFixed(2)}%) - ${taxResult.jurisdiction || ''}`,
        quantity: 1,
        unitPrice: taxResult.taxAmount,
        amount: taxResult.taxAmount,
        taxRate: taxResult.taxRate,
        taxAmount: taxResult.taxAmount,
        metadata: {
          jurisdiction: taxResult.jurisdiction,
          taxCategory: taxResult.taxCategory,
          reverseCharge: taxResult.reverseCharge,
        },
      });
    }

    const customer = {
      tenantId: payment.tenantId,
      billingName: tenant.name,
      legalName: tenant.name,
      billingEmail: tenant.contactEmail || `${tenant.slug}@example.com`,
      taxId: undefined,
      vatNumber: undefined,
    };

    const billingPeriod = {
      start: new Date(),
      end: this.calculatePeriodEnd(new Date(), plan.interval as BillingInterval),
      interval: plan.interval as BillingInterval,
    };

    const idempotencyKey = `invoice_${payment.id}_${payment.tenantId}`;

    const createInput: CreateInvoiceInput = {
      tenantId: payment.tenantId,
      subscriptionId: payment.subscriptionId || undefined,
      paymentId: payment.id,
      currency,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      billingPeriod,
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      provider: payment.provider as any,
      idempotencyKey,
      lines,
      taxSummary: taxResult.taxAmount ? [
        {
          taxRate: taxResult.taxRate,
          taxableAmount: subtotalMoney,
          taxAmount: taxResult.taxAmount,
          jurisdiction: taxResult.jurisdiction,
          taxCategory: taxResult.taxCategory,
          exemptionReason: taxResult.exemptionReason,
          reverseCharge: taxResult.reverseCharge,
        },
      ] : [],
      customer,
      paymentReference: {
        paymentId: payment.id,
        provider: payment.provider as any,
        providerPaymentId: payment.providerPaymentId || undefined,
        paidAt: payment.paidAt?.toISOString(),
      },
      metadata: {
        paymentId: payment.id,
        planId: plan.id,
        generatedFrom: 'payment_succeeded',
      },
    };

    const invoice = await this.invoiceRepository.create(createInput);

    // Generate unique invoice number concurrency-safe
    const invoiceNumber = await this.invoiceNumberService.generateInvoiceNumber(payment.tenantId, invoice.id);
    const finalizedInvoice = await this.invoiceRepository.update(invoice.id, {
      status: InvoiceStatusEnum.OPEN as any,
      metadata: { ...((invoice.metadata as any) || {}), invoiceNumber },
    });

    // Finalize invoice
    const finalInvoice = await this.finalizeInvoice(finalizedInvoice.id);

    await this.audit.logInvoiceCreated(
      payment.tenantId,
      finalInvoice.id,
      finalInvoice.invoiceNumber,
      finalInvoice.total,
      finalInvoice.currency,
      payment.id,
    );

    this.logger.log(`Invoice created: ${finalInvoice.id} number ${finalInvoice.invoiceNumber} for payment ${paymentId}, tenant ${payment.tenantId}`);

    return finalInvoice;
  }

  async finalizeInvoice(invoiceId: string): Promise<InvoiceRecord> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    }

    if (invoice.status === InvoiceStatusEnum.FINALIZED || invoice.status === InvoiceStatusEnum.PAID || invoice.status === InvoiceStatusEnum.OPEN) {
      return invoice;
    }

    if (!isValidInvoiceTransition(invoice.status as any, InvoiceStatusEnum.FINALIZED as any)) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Invalid invoice transition: ${invoice.status} → FINALIZED`,
      });
    }

    const finalized = await this.invoiceRepository.update(invoiceId, {
      status: InvoiceStatusEnum.FINALIZED as any,
      finalizedAt: new Date(),
    });

    await this.audit.logInvoiceFinalized(
      invoice.tenantId,
      finalized.id,
      finalized.invoiceNumber,
    );

    // Trigger billing notification for invoice finalized
    if (this.billingEventService) {
      this.billingEventService.onInvoiceFinalized({
        tenantId: finalized.tenantId,
        invoiceId: finalized.id,
        invoiceNumber: finalized.invoiceNumber,
        amount: finalized.total,
        currency: finalized.currency,
        planName: (finalized as any).planName,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger invoice finalized notification: ${e.message}`));
    }

    return finalized;
  }

  async markInvoicePaid(invoiceId: string, paymentId: string, amountPaid?: string): Promise<InvoiceRecord> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    }

    const paidAmount = amountPaid || invoice.total;
    const totalMinor = parseToMinorUnits(invoice.total, invoice.currency);
    const paidMinor = parseToMinorUnits(paidAmount, invoice.currency);

    let newStatus: InvoiceStatus;
    if (paidMinor >= totalMinor) {
      newStatus = InvoiceStatusEnum.PAID as any;
    } else if (paidMinor > 0) {
      newStatus = InvoiceStatusEnum.PARTIALLY_PAID as any;
    } else {
      newStatus = invoice.status as any;
    }

    const updated = await this.invoiceRepository.update(invoiceId, {
      status: newStatus,
      amountPaid: paidAmount,
      amountDue: formatFromMinorUnits(totalMinor - paidMinor, invoice.currency),
      paidAt: newStatus === InvoiceStatusEnum.PAID ? new Date() : undefined,
    });

    await this.audit.logInvoicePaid(
      invoice.tenantId,
      updated.id,
      updated.invoiceNumber,
      paidAmount,
      invoice.currency,
    );

    if (newStatus === InvoiceStatusEnum.PAID && this.billingEventService) {
      this.billingEventService.onInvoicePaid({
        tenantId: updated.tenantId,
        invoiceId: updated.id,
        invoiceNumber: updated.invoiceNumber,
        amount: paidAmount,
        currency: updated.currency,
        planName: (updated as any).planName,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger invoice paid notification: ${e.message}`));
    }

    return updated;
  }

  async voidInvoice(invoiceId: string, reason?: string): Promise<InvoiceRecord> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    }

    if (invoice.status === InvoiceStatusEnum.PAID) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot void a paid invoice, use refund instead',
      });
    }

    const voided = await this.invoiceRepository.update(invoiceId, {
      status: InvoiceStatusEnum.VOID as any,
      voidedAt: new Date(),
      metadata: { ...((invoice.metadata as any) || {}), voidReason: reason },
    });

    await this.audit.logInvoiceVoided(
      invoice.tenantId,
      voided.id,
      voided.invoiceNumber,
      reason,
    );

    return voided;
  }

  async getInvoiceById(invoiceId: string, tenantId: string): Promise<InvoiceRecord> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    }

    if (invoice.tenantId !== tenantId) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    }

    return invoice;
  }

  async listInvoicesByTenant(tenantId: string): Promise<InvoiceRecord[]> {
    return this.invoiceRepository.list({ tenantId });
  }

  async getInvoiceByPaymentId(paymentId: string): Promise<InvoiceRecord | null> {
    return this.invoiceRepository.findByPaymentId(paymentId);
  }

  private calculatePeriodEnd(from: Date, interval: BillingInterval): Date {
    const end = new Date(from);
    switch (interval) {
      case BillingInterval.MONTHLY:
        end.setMonth(end.getMonth() + 1);
        break;
      case BillingInterval.QUARTERLY:
        end.setMonth(end.getMonth() + 3);
        break;
      case BillingInterval.YEARLY:
        end.setFullYear(end.getFullYear() + 1);
        break;
      case BillingInterval.LIFETIME:
        end.setFullYear(end.getFullYear() + 100);
        break;
      default:
        end.setMonth(end.getMonth() + 1);
        break;
    }
    return end;
  }
}
