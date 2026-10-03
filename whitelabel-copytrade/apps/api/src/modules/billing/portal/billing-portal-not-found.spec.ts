import { NotFoundException } from '@nestjs/common';
import { BillingInvoiceQueryService } from './billing-invoice-query.service';
import { BillingPaymentHistoryService } from './billing-payment-history.service';

/**
 * Missing or foreign invoices and payments must answer 404, not a generic
 * Error (which the exception filter turns into a 500 and leaks nothing useful
 * to the customer portal).
 */
describe('billing portal not-found handling', () => {
  const TENANT = 'tenant-a';
  const OTHER = 'tenant-b';

  describe('BillingInvoiceQueryService', () => {
    let findById: jest.Mock;
    let service: BillingInvoiceQueryService;

    beforeEach(() => {
      findById = jest.fn();
      const pdf = { generateInvoicePdfData: jest.fn().mockRejectedValue(new Error('no pdf')) };
      service = new BillingInvoiceQueryService({ findById } as never, pdf as never);
    });

    it('getInvoiceDetail: unknown invoice is NotFound', async () => {
      findById.mockResolvedValue(null);
      await expect(service.getInvoiceDetail(TENANT, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getInvoiceDetail: another tenant invoice is NotFound', async () => {
      findById.mockResolvedValue({
        id: 'inv-1',
        tenantId: OTHER,
        invoiceNumber: 'INV-1',
        status: 'PAID',
      });
      await expect(service.getInvoiceDetail(TENANT, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getInvoicePdfMetadata: unknown and foreign invoices are NotFound', async () => {
      findById.mockResolvedValueOnce(null);
      await expect(service.getInvoicePdfMetadata(TENANT, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      findById.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: OTHER,
        invoiceNumber: 'INV-1',
        status: 'PAID',
      });
      await expect(service.getInvoicePdfMetadata(TENANT, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getInvoiceDetail: own invoice is returned', async () => {
      findById.mockResolvedValue({
        id: 'inv-1',
        tenantId: TENANT,
        invoiceNumber: 'INV-1',
        status: 'PAID',
        currency: 'USD',
        total: '49.00',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        issueDate: new Date('2026-09-01T00:00:00Z'),
      });
      const detail = await service.getInvoiceDetail(TENANT, 'inv-1');
      expect(detail).toMatchObject({
        id: 'inv-1',
        invoiceNumber: 'INV-1',
        total: '49.00',
        pdfAvailable: true,
      });
    });
  });

  describe('BillingPaymentHistoryService', () => {
    let getPaymentById: jest.Mock;
    let service: BillingPaymentHistoryService;

    beforeEach(() => {
      getPaymentById = jest.fn();
      service = new BillingPaymentHistoryService({ getPaymentById } as never);
    });

    it('another tenant payment is NotFound for detail and status', async () => {
      getPaymentById.mockResolvedValue({
        id: 'pay-1',
        tenantId: OTHER,
        status: 'PAID',
        createdAt: new Date(),
      });
      await expect(service.getPaymentDetail(TENANT, 'pay-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getPaymentStatus(TENANT, 'pay-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
