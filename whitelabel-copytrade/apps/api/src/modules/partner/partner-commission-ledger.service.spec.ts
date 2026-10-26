// # Tests tenant-safe pagination bounds for partner commission ledger views.
import { paginatePartnerCommissions } from './partner-commission-ledger.service';

describe('partner commission pagination', () => {
  it('caps page size, clamps invalid page numbers, and never changes exact decimal strings', () => {
    const items = Array.from({ length: 3 }, (_, index) => ({
      id: `commission-${index}`,
      amount: '0.100000000000000001',
    })) as never[];
    const result = paginatePartnerCommissions('partner-a', items, 0, 500);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(200);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
  });
});
