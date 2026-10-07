// # Exposes paginated, filterable commission ledger entries per partner
import { PartnerCommissionLedgerService } from '../partners/partner-commission-ledger.service';
import { PartnerCommissionState, type PartnerCommission } from '../partners/partner.types';

export { PartnerCommissionLedgerService, PartnerCommissionState, type PartnerCommission };

export interface PaginatedPartnerCommissionsResult {
  partnerId: string;
  page: number;
  limit: number;
  total: number;
  items: PartnerCommission[];
}

export function paginatePartnerCommissions(
  partnerId: string,
  allItems: ReadonlyArray<PartnerCommission>,
  page = 1,
  limit = 50,
): PaginatedPartnerCommissionsResult {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const start = (safePage - 1) * safeLimit;
  return {
    partnerId,
    page: safePage,
    limit: safeLimit,
    total: allItems.length,
    items: allItems.slice(start, start + safeLimit),
  };
}

export default PartnerCommissionLedgerService;
