import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { PaymentRecord, PaymentFilter, PaymentCreationInput, PaymentUpdateInput, PaymentStatus } from './payment.types';
import { PaymentProvider } from './payment.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * The Payment model has columns for the provider ids, status, amount and
 * timestamps only. The rest of a PaymentRecord is persisted in its JSON
 * columns: provider links in `providerReference`, record fields in
 * `metadata._payment` (stripped again when reading, so callers see their own
 * metadata unchanged). Writing those fields as columns made Prisma reject
 * every payment create/update.
 */
export const PAYMENT_RECORD_METADATA_KEY = '_payment';

export interface PaymentRecordExtras {
  userId?: string | null;
  transactionState?: string | null;
  amountInSmallestUnit?: number | null;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  paymentMethod?: string | null;
  planCode?: string | null;
  planName?: string | null;
  billingInterval?: string | null;
  seats?: number | null;
  rawProviderStatus?: string | null;
  expiresAt?: string | null;
}

export interface PaymentProviderLinks {
  providerCustomerId?: string | null;
  checkoutUrl?: string | null;
  invoiceUrl?: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function isoOrNull(value: Date | string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Metadata JSON for a write: caller metadata (replacing the stored caller
 * metadata when given) plus the stored record fields merged with `extras`.
 */
export function buildPaymentMetadata(
  existing: unknown,
  userMetadata: Record<string, unknown> | null | undefined,
  extras: PaymentRecordExtras,
): Record<string, unknown> {
  const current = asObject(existing);
  const stored = asObject(current[PAYMENT_RECORD_METADATA_KEY]);
  const user = userMetadata ? asObject(userMetadata) : current;
  delete user[PAYMENT_RECORD_METADATA_KEY];
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) stored[key] = value;
  }
  return { ...user, [PAYMENT_RECORD_METADATA_KEY]: stored };
}

/** providerReference JSON for a write; only non-empty links overwrite stored ones. */
export function buildProviderReference(existing: unknown, links: PaymentProviderLinks): Record<string, unknown> {
  const merged = asObject(existing);
  for (const [key, value] of Object.entries(links)) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  return merged;
}

/**
 * Persistence abstraction for internal payment records.
 *
 * Handles:
 *  - Payment records with provider references
 *  - Status transitions with validation
 *  - Idempotency keys for checkout creation
 *  - Checkout references
 *  - Tenant/subscription associations
 *  - Webhook event tracking for replay protection
 *
 * Note: This repository expects Payment and WebhookEvent models in Prisma.
 * If they don't exist yet, it will use raw queries or fallback to in-memory
 * tracking with Redis. The implementation is defensive to handle both cases.
 */

@Injectable()
export class PaymentRepository {
  private readonly logger = new Logger(PaymentRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: PaymentCreationInput): Promise<PaymentRecord> {
    try {
      // Try to use Payment model if exists in Prisma schema
      const payment = await (this.prisma as any).payment?.create({
        data: {
          id: this.generateId(),
          tenantId: input.tenantId,
          planId: input.planId,
          subscriptionId: input.subscriptionId || null,
          provider: input.provider,
          status: 'CREATED',
          currency: input.currency,
          amount: input.amount.amount,
          providerPaymentId: input.providerReference?.providerPaymentId || null,
          providerCheckoutId: input.providerReference?.providerCheckoutId || null,
          providerSessionId: input.providerReference?.providerSessionId || null,
          providerInvoiceId: input.providerReference?.providerInvoiceId || null,
          providerReference: buildProviderReference(null, {
            providerCustomerId: input.providerReference?.providerCustomerId || null,
            checkoutUrl: input.providerReference?.checkoutUrl || null,
            invoiceUrl: input.providerReference?.invoiceUrl || null,
          }) as any,
          idempotencyKey: input.idempotencyKey,
          orderId: input.references.orderId || null,
          metadata: buildPaymentMetadata(null, input.metadata as any, {
            userId: input.references.userId || null,
            transactionState: 'INITIALIZED',
            amountInSmallestUnit: input.amount.amountInSmallestUnit,
            externalCustomerId: input.references.externalCustomerId || null,
            externalSubscriptionId: input.references.externalSubscriptionId || null,
            planCode: input.metadata.planCode || null,
            planName: input.metadata.planName || null,
            billingInterval: input.metadata.billingInterval || null,
            seats: input.metadata.seats || null,
            expiresAt: isoOrNull(input.expiresAt || null),
          }) as any,
        },
      });

      if (payment) {
        return this.mapToPaymentRecord(payment);
      }

      // No Payment delegate means the generated client does not match the
      // schema. Refuse: returning an unpersisted record would let a checkout
      // proceed with a payment the webhook can never find.
      this.logger.error('Payment model unavailable on the Prisma client; refusing to create an unpersisted payment');
      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Payment storage is unavailable',
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.error(`Failed to create payment record: ${(error as Error).message}`);
      // A missing table (P2021, migrations not applied) is a deployment error
      // and fails like any other storage error - never an in-memory stand-in.
      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Failed to create payment record',
      });
    }
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findUnique({
      where: { id },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findFirst({
      where: { idempotencyKey, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async findByProviderPaymentId(providerPaymentId: string, provider: PaymentProvider): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findFirst({
      where: { providerPaymentId, provider },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async findByProviderCheckoutId(providerCheckoutId: string, provider: PaymentProvider): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findFirst({
      where: { providerCheckoutId, provider },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async findByOrderId(orderId: string): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findFirst({
      where: { orderId },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async list(filter: PaymentFilter): Promise<PaymentRecord[]> {
    const where: any = {};

    if (filter.tenantId) where.tenantId = filter.tenantId;
    if (filter.planId) where.planId = filter.planId;
    if (filter.subscriptionId) where.subscriptionId = filter.subscriptionId;
    if (filter.provider) where.provider = filter.provider;
    if (filter.status) where.status = filter.status;
    if (filter.currency) where.currency = filter.currency;
    if (filter.orderId) where.orderId = filter.orderId;
    if (filter.idempotencyKey) where.idempotencyKey = filter.idempotencyKey;
    if (filter.providerPaymentId) where.providerPaymentId = filter.providerPaymentId;

    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }

    const payments = await (this.prisma as any).payment?.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (payments) {
      return payments.map((p: any) => this.mapToPaymentRecord(p));
    }
    return [];
  }

  async update(id: string, input: PaymentUpdateInput): Promise<PaymentRecord> {
    try {
      const updateData: any = {};

      if (input.status) updateData.status = input.status;
      if (input.paidAt !== undefined) updateData.paidAt = input.paidAt;
      if (input.failedAt !== undefined) updateData.failedAt = input.failedAt;
      if (input.cancelledAt !== undefined) updateData.cancelledAt = input.cancelledAt;
      if (input.refundedAt !== undefined) updateData.refundedAt = input.refundedAt;
      if (input.failureReason !== undefined) updateData.failureReason = input.failureReason;
      if (input.failureCode !== undefined) updateData.failureCode = input.failureCode;

      const links: PaymentProviderLinks = {};
      if (input.providerReference) {
        if (input.providerReference.providerPaymentId) updateData.providerPaymentId = input.providerReference.providerPaymentId;
        if (input.providerReference.providerCheckoutId) updateData.providerCheckoutId = input.providerReference.providerCheckoutId;
        if (input.providerReference.providerSessionId) updateData.providerSessionId = input.providerReference.providerSessionId;
        if (input.providerReference.providerInvoiceId) updateData.providerInvoiceId = input.providerReference.providerInvoiceId;
        if (input.providerReference.providerCustomerId) links.providerCustomerId = input.providerReference.providerCustomerId;
        if (input.providerReference.checkoutUrl) links.checkoutUrl = input.providerReference.checkoutUrl;
        if (input.providerReference.invoiceUrl) links.invoiceUrl = input.providerReference.invoiceUrl;
      }

      const extras: PaymentRecordExtras = {};
      if (input.transactionState) extras.transactionState = input.transactionState;
      if (input.rawProviderStatus !== undefined) extras.rawProviderStatus = input.rawProviderStatus;

      const touchesJson = Object.keys(links).length > 0 || Object.keys(extras).length > 0 || Boolean(input.metadata);
      if (touchesJson) {
        const existing = await (this.prisma as any).payment?.findUnique({ where: { id } });
        if (!existing) throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Payment not found' });
        if (Object.keys(links).length > 0) updateData.providerReference = buildProviderReference(existing.providerReference, links);
        updateData.metadata = buildPaymentMetadata(existing.metadata, (input.metadata as any) ?? null, extras);
      }

      const payment = await (this.prisma as any).payment?.update({
        where: { id },
        data: updateData,
      });

      if (payment) {
        return this.mapToPaymentRecord(payment);
      }

      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Payment not found' });
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.error(`Failed to update payment ${id}: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Failed to update payment record',
      });
    }
  }

  async updateStatus(id: string, status: PaymentStatus, additionalData?: Partial<PaymentUpdateInput>): Promise<PaymentRecord> {
    const updateInput: PaymentUpdateInput = {
      status,
      ...additionalData,
    };

    // Set timestamp based on status
    const now = new Date();
    if (status === 'SUCCEEDED' as any) {
      updateInput.paidAt = now;
    } else if (status === 'FAILED' as any) {
      updateInput.failedAt = now;
    } else if (status === 'CANCELLED' as any) {
      updateInput.cancelledAt = now;
    } else if (status === 'REFUNDED' as any) {
      updateInput.refundedAt = now;
    }

    return this.update(id, updateInput);
  }

  async findLatestByTenantAndPlan(tenantId: string, planId: string): Promise<PaymentRecord | null> {
    const payment = await (this.prisma as any).payment?.findFirst({
      where: { tenantId, planId },
      orderBy: { createdAt: 'desc' },
    });
    if (payment) {
      return this.mapToPaymentRecord(payment);
    }
    return null;
  }

  async countByTenant(tenantId: string): Promise<number> {
    const count = await (this.prisma as any).payment?.count({
      where: { tenantId },
    });
    return count || 0;
  }

  private mapToPaymentRecord(prismaPayment: any): PaymentRecord {
    const metadata = asObject(prismaPayment.metadata);
    const extras = asObject(metadata[PAYMENT_RECORD_METADATA_KEY]);
    delete metadata[PAYMENT_RECORD_METADATA_KEY];
    const links = asObject(prismaPayment.providerReference);
    const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
    return {
      id: prismaPayment.id,
      tenantId: prismaPayment.tenantId,
      planId: prismaPayment.planId,
      subscriptionId: prismaPayment.subscriptionId || null,
      userId: text(extras.userId) as any,
      provider: prismaPayment.provider as PaymentProvider,
      status: prismaPayment.status as any,
      transactionState: (text(extras.transactionState) ?? 'INITIALIZED') as any,
      currency: prismaPayment.currency,
      amount: prismaPayment.amount,
      amountInSmallestUnit: typeof extras.amountInSmallestUnit === 'number' ? extras.amountInSmallestUnit : 0,
      providerPaymentId: prismaPayment.providerPaymentId || null,
      providerCheckoutId: prismaPayment.providerCheckoutId || null,
      providerSessionId: prismaPayment.providerSessionId || null,
      providerInvoiceId: prismaPayment.providerInvoiceId || null,
      providerCustomerId: text(links.providerCustomerId),
      checkoutUrl: text(links.checkoutUrl),
      invoiceUrl: text(links.invoiceUrl),
      idempotencyKey: prismaPayment.idempotencyKey,
      orderId: prismaPayment.orderId || null,
      externalCustomerId: text(extras.externalCustomerId),
      externalSubscriptionId: text(extras.externalSubscriptionId),
      paymentMethod: text(extras.paymentMethod) as any,
      planCode: text(extras.planCode),
      planName: text(extras.planName),
      billingInterval: text(extras.billingInterval) as any,
      seats: typeof extras.seats === 'number' ? extras.seats : null,
      failureReason: prismaPayment.failureReason || null,
      failureCode: prismaPayment.failureCode || null,
      rawProviderStatus: text(extras.rawProviderStatus),
      metadata: prismaPayment.metadata ? metadata : null,
      paidAt: prismaPayment.paidAt || null,
      failedAt: prismaPayment.failedAt || null,
      cancelledAt: prismaPayment.cancelledAt || null,
      refundedAt: prismaPayment.refundedAt || null,
      expiresAt: text(extras.expiresAt) ? new Date(extras.expiresAt as string) : null,
      createdAt: prismaPayment.createdAt,
      updatedAt: prismaPayment.updatedAt,
    };
  }

  private generateId(): string {
    // Use crypto random UUID
    try {
      const { randomUUID } = require('crypto');
      return randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }
  }
}
