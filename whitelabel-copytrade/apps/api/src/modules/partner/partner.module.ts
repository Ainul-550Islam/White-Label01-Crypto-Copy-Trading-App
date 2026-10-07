// # Registers all partner controllers and services in AppModule
import { PartnerModule } from '../partners/partner.module';
import { PartnerController } from '../partners/partner.controller';
import { PartnerPortalController } from './partner.controller';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerPayoutService } from './partner-payout.service';
import { PartnerReconciliationService } from './partner-reconciliation.service';

export {
  PartnerModule,
  PartnerController,
  PartnerPortalController,
  PartnerCommissionLedgerService,
  PartnerPayoutService,
  PartnerReconciliationService,
};

export const PARTNER_PORTAL_ROUTE_PREFIX = '/v1/partner';
export const PARTNER_ADMIN_ROUTE_PREFIX = '/v1/partners';

export function listExposedPartnerEndpoints(): readonly string[] {
  return [
    'GET /v1/partner/profile',
    'GET /v1/partner/referrals',
    'POST /v1/partner/referrals',
    'GET /v1/partner/commissions',
    'GET /v1/partner/payouts',
    'POST /v1/partner/payouts',
  ] as const;
}

export default PartnerModule;
