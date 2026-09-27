import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceNumber: string;
  @ApiProperty() status: string;
  @ApiProperty() issueDate: string;
  @ApiPropertyOptional() dueDate: string | null;
  @ApiProperty() currency: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountTotal: string;
  @ApiProperty() taxTotal: string;
  @ApiProperty() total: string;
  @ApiProperty() amountPaid: string;
  @ApiProperty() amountDue: string;
  @ApiProperty() amountRefunded: string;
  @ApiPropertyOptional() billingPeriodStart: string | null;
  @ApiPropertyOptional() billingPeriodEnd: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() planName: string | null;
  @ApiProperty() pdfAvailable: boolean;
}

export class InvoiceLineItemDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() description: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: string;
  @ApiProperty() amount: string;
  @ApiPropertyOptional() taxRate: number | null;
  @ApiPropertyOptional() taxAmount: string | null;
}

export class InvoiceTaxSummaryDto {
  @ApiProperty() taxRate: number;
  @ApiProperty() taxableAmount: string;
  @ApiProperty() taxAmount: string;
  @ApiProperty() jurisdiction: string;
  @ApiProperty() taxCategory: string;
  @ApiProperty() reverseCharge: boolean;
}

export class InvoiceDetailResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceNumber: string;
  @ApiProperty() status: string;
  @ApiProperty() issueDate: string;
  @ApiPropertyOptional() dueDate: string | null;
  @ApiProperty() currency: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountTotal: string;
  @ApiProperty() taxTotal: string;
  @ApiProperty() total: string;
  @ApiProperty() amountPaid: string;
  @ApiProperty() amountDue: string;
  @ApiProperty() amountRefunded: string;
  @ApiPropertyOptional() billingPeriodStart: string | null;
  @ApiPropertyOptional() billingPeriodEnd: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() planName: string | null;
  @ApiProperty() pdfAvailable: boolean;
  @ApiPropertyOptional({ type: [InvoiceLineItemDto] }) lines?: InvoiceLineItemDto[];
  @ApiPropertyOptional({ type: [InvoiceTaxSummaryDto] }) taxSummary?: InvoiceTaxSummaryDto[];
  @ApiPropertyOptional() paymentReference?: any;
}

export class InvoiceListResponseDto {
  @ApiProperty({ type: [InvoiceListItemDto] }) invoices: InvoiceListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() tenantId: string;
  @ApiProperty() fetchedAt: string;
}

export class InvoicePdfMetadataDto {
  @ApiProperty() available: boolean;
  @ApiProperty() invoiceNumber: string;
  @ApiPropertyOptional() generatedAt?: string;
}
