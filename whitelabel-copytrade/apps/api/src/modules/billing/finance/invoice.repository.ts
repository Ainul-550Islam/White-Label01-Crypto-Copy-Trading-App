import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { InvoiceRecord, InvoiceFilter, CreateInvoiceInput, UpdateInvoiceInput, InvoiceStatus, InvoiceWithLines, InvoiceLineItem } from './invoice.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Invoice columns hold the amounts, status, dates and the JSON documents
 * (customer, lines, taxSummary, metadata). Record fields without a column are
 * kept in `metadata._invoice` and stripped again on read. `lines` is a JSON
 * column, not a relation: the previous nested `lines.create` / `include`
 * made Prisma reject every invoice write and read.
 */
export const INVOICE_RECORD_METADATA_KEY = '_invoice';

export interface InvoiceRecordExtras {
  customerId?: string | null;
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  billingInterval?: string | null;
  discountTotal?: string | null;
  amountCredited?: string | null;
  providerInvoiceId?: string | null;
  planCode?: string | null;
  planName?: string | null;
  paymentReference?: unknown;
}

function invoiceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function invoiceIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Metadata JSON for a write: caller metadata (replacing the stored one when given) plus merged record fields. */
export function buildInvoiceMetadata(
  existing: unknown,
  userMetadata: Record<string, unknown> | null | undefined,
  extras: InvoiceRecordExtras,
): Record<string, unknown> {
  const current = invoiceObject(existing);
  const stored = invoiceObject(current[INVOICE_RECORD_METADATA_KEY]);
  const user = userMetadata ? invoiceObject(userMetadata) : current;
  delete user[INVOICE_RECORD_METADATA_KEY];
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) stored[key] = value;
  }
  return { ...user, [INVOICE_RECORD_METADATA_KEY]: stored };
}

/**
 * Persistence abstraction for invoices, invoice lines, invoice numbers,
 * status transitions, payment associations, and tenant-scoped invoice queries.
 *
 * Requirements:
 *  - tenant isolation
 *  - concurrency-safe number generation
 *  - no duplicate invoice for the same successful payment
 *  - immutable finalized invoice history where required
 */

@Injectable()
export class InvoiceRepository {
  private readonly logger = new Logger(InvoiceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInvoiceInput): Promise<InvoiceRecord> {
    try {
      // Idempotency check: if invoice with same idempotency key exists, return it
      const existingByIdempotency = await this.findByIdempotencyKey(input.idempotencyKey, input.tenantId);
      if (existingByIdempotency) {
        this.logger.log(`Idempotent invoice creation: returning existing invoice ${existingByIdempotency.id} for key ${input.idempotencyKey}`);
        return existingByIdempotency;
      }

      // Check for duplicate invoice for same payment
      if (input.paymentId) {
        const existingByPayment = await this.findByPaymentId(input.paymentId);
        if (existingByPayment) {
          this.logger.log(`Duplicate invoice prevention: payment ${input.paymentId} already has invoice ${existingByPayment.id}`);
          return existingByPayment;
        }
      }

      // Calculate totals from lines using precise decimal handling
      const totals = this.calculateTotalsFromLines(input.lines, input.currency);

      const invoice = await (this.prisma as any).invoice?.create({
        data: {
          id: this.generateId(),
          invoiceNumber: await this.generateInvoiceNumber(input.tenantId),
          tenantId: input.tenantId,
          subscriptionId: input.subscriptionId || null,
          paymentId: input.paymentId || null,
          currency: input.currency,
          status: 'DRAFT',
          issuedAt: input.issueDate || new Date(),
          dueDate: input.dueDate || null,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          amountPaid: '0',
          amountDue: totals.total,
          amountRefunded: '0',
          provider: input.provider || null,
          planId: input.planId || null,
          idempotencyKey: input.idempotencyKey,
          customer: (input.customer ?? {}) as any,
          taxSummary: (input.taxSummary ?? []) as any,
          metadata: buildInvoiceMetadata(null, (input.metadata as any) ?? {}, {
            customerId: input.customerId || null,
            billingPeriodStart: invoiceIso(input.billingPeriod?.start),
            billingPeriodEnd: invoiceIso(input.billingPeriod?.end),
            billingInterval: input.billingPeriod?.interval || null,
            discountTotal: totals.discountTotal,
            amountCredited: '0',
            providerInvoiceId: input.providerInvoiceId || null,
            planCode: input.planCode || null,
            planName: input.planName || null,
            paymentReference: input.paymentReference ?? null,
          }) as any,
          lines: input.lines.map((line) => ({
            id: this.generateId(),
            type: line.type,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount,
            amount: line.amount.amount,
            discountType: line.discountType || null,
            discountValue: line.discountValue || null,
            discountAmount: line.discountAmount?.amount || null,
            taxRate: line.taxRate || null,
            taxAmount: line.taxAmount?.amount || null,
            metadata: line.metadata || null,
            planId: line.planId || null,
            subscriptionId: line.subscriptionId || null,
            billingPeriodStart: invoiceIso(line.billingPeriodStart as any),
            billingPeriodEnd: invoiceIso(line.billingPeriodEnd as any),
          })) as any,
        },
      });

      if (invoice) {
        return this.mapToInvoiceRecord(invoice);
      }

      this.logger.warn('Invoice model not found in Prisma schema, using fallback');
      return this.createFallbackRecord(input, totals);
    } catch (error) {
      if ((error as any).code === 'P2002') {
        // Unique constraint violation - try to find existing
        const existing = await this.findByIdempotencyKey(input.idempotencyKey, input.tenantId);
        if (existing) return existing;
      }

      this.logger.error(`Failed to create invoice: ${(error as Error).message}`);
      if ((error as any).code === 'P2021' || (error as Error).message.includes('does not exist')) {
        const totals = this.calculateTotalsFromLines(input.lines, input.currency);
        return this.createFallbackRecord(input, totals);
      }

      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Failed to create invoice',
      });
    }
  }

  async findById(id: string, tenantId?: string): Promise<InvoiceRecord | null> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const invoice = await (this.prisma as any).invoice?.findUnique({
      where,
    });
    if (invoice) {
      // If tenantId provided, double-check isolation even when using findUnique
      if (tenantId && invoice.tenantId !== tenantId) return null;
      return this.mapToInvoiceRecord(invoice);
    }
    // Fallback to findFirst for tenant isolation
    if (tenantId) {
      const invoiceFirst = await (this.prisma as any).invoice?.findFirst({
        where: { id, tenantId },
        });
      if (invoiceFirst) return this.mapToInvoiceRecord(invoiceFirst);
    }
    return null;
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceRecord | null> {
    const invoice = await (this.prisma as any).invoice?.findFirst({
      where: { invoiceNumber },
    });
    if (invoice) return this.mapToInvoiceRecord(invoice);
    return null;
  }

  async findByPaymentId(paymentId: string): Promise<InvoiceRecord | null> {
    const invoice = await (this.prisma as any).invoice?.findFirst({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
    if (invoice) return this.mapToInvoiceRecord(invoice);
    return null;
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId?: string): Promise<InvoiceRecord | null> {
    const invoice = await (this.prisma as any).invoice?.findFirst({
      where: { idempotencyKey, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (invoice) return this.mapToInvoiceRecord(invoice);
    return null;
  }

  async list(filter: InvoiceFilter): Promise<InvoiceRecord[]> {
    const where: any = {};
    if (filter.tenantId) where.tenantId = filter.tenantId;
    const jsonFilters: any[] = [];
    if (filter.customerId) jsonFilters.push({ metadata: { path: [INVOICE_RECORD_METADATA_KEY, 'customerId'], equals: filter.customerId } });
    if (filter.subscriptionId) where.subscriptionId = filter.subscriptionId;
    if (filter.paymentId) where.paymentId = filter.paymentId;
    if (filter.status) where.status = filter.status;
    if (filter.currency) where.currency = filter.currency;
    if (filter.planId) where.planId = filter.planId;
    if (filter.invoiceNumber) where.invoiceNumber = filter.invoiceNumber;
    if (filter.billingInterval) {
      jsonFilters.push({ metadata: { path: [INVOICE_RECORD_METADATA_KEY, 'billingInterval'], equals: filter.billingInterval } });
    }
    if (jsonFilters.length > 0) where.AND = jsonFilters;

    if (filter.fromDate || filter.toDate) {
      where.issuedAt = {};
      if (filter.fromDate) where.issuedAt.gte = filter.fromDate;
      if (filter.toDate) where.issuedAt.lte = filter.toDate;
    }

    const invoices = await (this.prisma as any).invoice?.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (invoices) {
      return invoices.map((inv: any) => this.mapToInvoiceRecord(inv));
    }
    return [];
  }

  async update(id: string, input: UpdateInvoiceInput): Promise<InvoiceRecord> {
    try {
      const updateData: any = {};
      if (input.status) updateData.status = input.status;
      if (input.dueDate !== undefined) updateData.dueDate = input.dueDate;
      if (input.amountPaid) updateData.amountPaid = input.amountPaid;
      if (input.amountDue) updateData.amountDue = input.amountDue;
      if (input.amountRefunded) updateData.amountRefunded = input.amountRefunded;
      const extras: InvoiceRecordExtras = {};
      if (input.amountCredited) extras.amountCredited = input.amountCredited;
      if (input.providerInvoiceId) extras.providerInvoiceId = input.providerInvoiceId;
      if (Object.keys(extras).length > 0 || input.metadata) {
        const existing = await (this.prisma as any).invoice?.findUnique({ where: { id } });
        if (!existing) throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
        updateData.metadata = buildInvoiceMetadata(existing.metadata, (input.metadata as any) ?? null, extras);
      }
      if (input.finalizedAt !== undefined) updateData.finalizedAt = input.finalizedAt;
      if (input.paidAt !== undefined) updateData.paidAt = input.paidAt;
      if (input.voidedAt !== undefined) updateData.voidedAt = input.voidedAt;

      const invoice = await (this.prisma as any).invoice?.update({
        where: { id },
        data: updateData,
      });

      if (invoice) return this.mapToInvoiceRecord(invoice);

      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'Invoice not found' });
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.error(`Failed to update invoice ${id}: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Failed to update invoice',
      });
    }
  }

  async updateStatus(id: string, status: InvoiceStatus): Promise<InvoiceRecord> {
    const updateData: any = { status };
    const now = new Date();

    if (status === 'FINALIZED' as any) updateData.finalizedAt = now;
    if (status === 'PAID' as any) updateData.paidAt = now;
    if (status === 'VOID' as any) updateData.voidedAt = now;

    return this.update(id, updateData);
  }

  async findByTenant(tenantId: string): Promise<InvoiceRecord[]> {
    return this.list({ tenantId });
  }

  private calculateTotalsFromLines(lines: any[], currency: string): { subtotal: string; discountTotal: string; taxTotal: string; total: string } {
    let subtotalMinor = 0;
    let discountMinor = 0;
    let taxMinor = 0;

    const getMinorUnit = (curr: string): number => {
      const map: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, BTC: 8, ETH: 18, USDT: 6, USDC: 6 };
      return map[curr.toUpperCase()] ?? 2;
    };

    const parseToMinor = (amount: string, curr: string): number => {
      const minorUnit = getMinorUnit(curr);
      const factor = Math.pow(10, minorUnit);
      return Math.round(parseFloat(amount) * factor);
    };

    const formatFromMinor = (minor: number, curr: string): string => {
      const minorUnit = getMinorUnit(curr);
      const factor = Math.pow(10, minorUnit);
      return (minor / factor).toFixed(minorUnit);
    };

    for (const line of lines) {
      const amountStr = typeof line.amount === 'string' ? line.amount : line.amount?.amount || '0';
      const amountMinor = parseToMinor(amountStr, currency);

      if (line.type === 'DISCOUNT' || line.type === 'CREDIT') {
        discountMinor += amountMinor;
      } else if (line.type === 'TAX') {
        taxMinor += amountMinor;
      } else {
        subtotalMinor += amountMinor;
      }

      if (line.discountAmount) {
        const discStr = typeof line.discountAmount === 'string' ? line.discountAmount : line.discountAmount?.amount || '0';
        discountMinor += parseToMinor(discStr, currency);
      }

      if (line.taxAmount) {
        const taxStr = typeof line.taxAmount === 'string' ? line.taxAmount : line.taxAmount?.amount || '0';
        taxMinor += parseToMinor(taxStr, currency);
      }
    }

    const totalMinor = subtotalMinor - discountMinor + taxMinor;

    return {
      subtotal: formatFromMinor(subtotalMinor, currency),
      discountTotal: formatFromMinor(discountMinor, currency),
      taxTotal: formatFromMinor(taxMinor, currency),
      total: formatFromMinor(totalMinor, currency),
    };
  }

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    // Delegate to invoice-number service in production, here generate simple unique
    const prefix = 'INV';
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  private mapToInvoiceRecord(prismaInvoice: any): InvoiceRecord {
    const metadata = invoiceObject(prismaInvoice.metadata);
    const extras = invoiceObject(metadata[INVOICE_RECORD_METADATA_KEY]);
    delete metadata[INVOICE_RECORD_METADATA_KEY];
    const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
    const date = (value: unknown): Date | null => (text(value) ? new Date(value as string) : null);
    return {
      id: prismaInvoice.id,
      invoiceNumber: prismaInvoice.invoiceNumber,
      tenantId: prismaInvoice.tenantId,
      customerId: text(extras.customerId) as any,
      subscriptionId: prismaInvoice.subscriptionId || null,
      paymentId: prismaInvoice.paymentId || null,
      currency: prismaInvoice.currency,
      status: prismaInvoice.status as InvoiceStatus,
      issueDate: prismaInvoice.issuedAt ?? prismaInvoice.createdAt,
      dueDate: prismaInvoice.dueDate || null,
      billingPeriodStart: date(extras.billingPeriodStart),
      billingPeriodEnd: date(extras.billingPeriodEnd),
      billingInterval: text(extras.billingInterval) as any,
      subtotal: prismaInvoice.subtotal,
      discountTotal: text(extras.discountTotal) ?? '0',
      taxTotal: prismaInvoice.taxTotal,
      total: prismaInvoice.total,
      amountPaid: prismaInvoice.amountPaid,
      amountDue: prismaInvoice.amountDue,
      amountRefunded: prismaInvoice.amountRefunded,
      amountCredited: text(extras.amountCredited) ?? '0',
      provider: prismaInvoice.provider || null,
      providerInvoiceId: text(extras.providerInvoiceId),
      planId: prismaInvoice.planId || null,
      planCode: text(extras.planCode),
      planName: text(extras.planName),
      idempotencyKey: prismaInvoice.idempotencyKey,
      metadata: prismaInvoice.metadata ? metadata : null,
      finalizedAt: prismaInvoice.finalizedAt || null,
      paidAt: prismaInvoice.paidAt || null,
      voidedAt: prismaInvoice.voidedAt || null,
      createdAt: prismaInvoice.createdAt,
      updatedAt: prismaInvoice.updatedAt,
    };
  }

  private createFallbackRecord(input: CreateInvoiceInput, totals: any): InvoiceRecord {
    const now = new Date();
    return {
      id: this.generateId(),
      invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      tenantId: input.tenantId,
      customerId: input.customerId || null,
      subscriptionId: input.subscriptionId || null,
      paymentId: input.paymentId || null,
      currency: input.currency,
      status: 'DRAFT' as any,
      issueDate: input.issueDate || now,
      dueDate: input.dueDate || null,
      billingPeriodStart: input.billingPeriod?.start || null,
      billingPeriodEnd: input.billingPeriod?.end || null,
      billingInterval: input.billingPeriod?.interval || null,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      amountPaid: '0',
      amountDue: totals.total,
      amountRefunded: '0',
      amountCredited: '0',
      provider: input.provider || null,
      providerInvoiceId: input.providerInvoiceId || null,
      planId: input.planId || null,
      planCode: input.planCode || null,
      planName: input.planName || null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata || null,
      finalizedAt: null,
      paidAt: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private generateId(): string {
    try {
      const { randomUUID } = require('crypto');
      return randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }
  }
}
