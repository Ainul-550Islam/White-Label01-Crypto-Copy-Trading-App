import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { BillingNotificationsModule } from '../notifications/notifications.module';

// Repositories
import { InvoiceRepository } from './invoice.repository';
import { BillingLedgerRepository } from './billing-ledger.repository';

// Services - Invoice
import { InvoiceNumberService } from './invoice-number.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceService } from './invoice.service';

// Services - Tax
import { TaxProviderFactory, NoOpTaxProvider, ConfigurableTaxProvider } from './tax-provider.interface';
import { TaxService } from './tax.service';

// Services - Ledger
import { BillingLedgerService } from './billing-ledger.service';

// Services - Refund
import { RefundService } from './refund.service';

// Services - Dunning
import { DunningService } from './dunning.service';

// Services - Customer
import { BillingCustomerService } from './billing-customer.service';

// Services - Reconciliation
import { BillingReconciliationService } from './billing-reconciliation.service';

// Services - Audit
import { FinanceAuditService } from './finance.audit';

/**
 * FinanceModule wiring all finance services, repositories, provider abstractions,
 * and exports for integration into billing.module.ts.
 *
 * Preserves existing PlansService, SubscriptionsService, EnforcementModule,
 * Payment services/controllers/entitlement/limit.
 *
 * Financial consistency:
 *  - Payment -> Invoice -> Ledger -> Subscription -> Audit
 *  - Refund -> Payment -> Invoice -> Ledger -> Audit
 *  - Tax -> Invoice Tax Breakdown -> Tax Ledger -> Audit
 *  - Failed Payment -> Dunning -> Retry/Grace -> Recovery/Final -> Audit+Reconciliation
 *
 * Idempotency mandatory: invoice creation/finalization/number generation/ledger/
 * refund request/completion/dunning creation/retry/tax/reconciliation.
 *
 * Concurrency: webhook/invoice/refund/retry/ledger/reconciliation concurrent,
 * uses DB transaction/locking/idempotency, no unsafe read-calc-write for balances.
 */

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => BillingNotificationsModule),
  ],
  providers: [
    // Audit - must be first as other services depend on it
    FinanceAuditService,

    // Tax Provider Factory and implementations
    TaxProviderFactory,
    NoOpTaxProvider,
    ConfigurableTaxProvider,
    TaxService,

    // Repositories
    InvoiceRepository,
    BillingLedgerRepository,

    // Invoice services
    InvoiceNumberService,
    InvoicePdfService,
    InvoiceService,

    // Ledger
    BillingLedgerService,

    // Refund
    RefundService,

    // Dunning
    DunningService,

    // Customer
    BillingCustomerService,

    // Reconciliation
    BillingReconciliationService,
  ],
  exports: [
    // Audit
    FinanceAuditService,

    // Tax
    TaxProviderFactory,
    TaxService,

    // Invoice
    InvoiceRepository,
    InvoiceNumberService,
    InvoicePdfService,
    InvoiceService,

    // Ledger
    BillingLedgerRepository,
    BillingLedgerService,

    // Refund
    RefundService,

    // Dunning
    DunningService,

    // Customer
    BillingCustomerService,

    // Reconciliation
    BillingReconciliationService,
  ],
})
export class FinanceModule {}
