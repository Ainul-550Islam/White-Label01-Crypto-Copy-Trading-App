import { SignalFilterService } from './signal-filter.service';

/**
 * Research signal filtering. The compliance check matched ANY open BLOCK case
 * in the tenant (one blocked customer stopped every research signal) and,
 * like the exchange-capability check, ignored lookup errors; a non-array
 * risk-profile blockedSymbols matched substrings or threw into an empty catch.
 */
function build(opts: {
  createdBy?: string | null;
  blockCaseFor?: string[];
  riskProfile?: unknown;
  tradingSymbol?: { isTradeable: boolean } | null;
  failing?: 'compliance' | 'tradingSymbol';
}) {
  const fail = (what: string) => async () => {
    throw new Error(`${what} lookup failed`);
  };
  const complianceFindFirst = jest.fn(
    opts.failing === 'compliance'
      ? fail('compliance')
      : async (args: any) => {
          const ids: string[] = args.where.userId?.in ?? [];
          return ids.some((id) => (opts.blockCaseFor ?? []).includes(id)) ? { id: 'case-1' } : null;
        },
  );
  const prisma = {
    researchSignal: {
      findFirst: jest.fn(async (args: any) =>
        args.where.id === 'sig-1'
          ? { id: 'sig-1', tenantId: 't1', strategyVersionId: 'v1', symbol: 'ETH-USDT', side: 'BUY', signalKey: 'k1', expiresAt: null }
          : null,
      ),
      update: jest.fn(async () => ({})),
    },
    complianceCase: { findFirst: complianceFindFirst },
    tradingSymbol: {
      findFirst: jest.fn(opts.failing === 'tradingSymbol' ? fail('tradingSymbol') : async () => opts.tradingSymbol ?? { isTradeable: true }),
    },
  };
  const researchRepo = {
    findStrategyVersionById: jest.fn(async () => ({
      id: 'v1',
      status: 'PUBLISHED',
      createdBy: opts.createdBy === undefined ? 'author-1' : opts.createdBy,
      riskProfile: opts.riskProfile ?? {},
    })),
    createAuditLog: jest.fn(async () => ({})),
  };
  return { service: new SignalFilterService(prisma as never, researchRepo as never), complianceFindFirst };
}

const run = (s: SignalFilterService, actorUserId: string | null = 'actor-1') => s.filterSignal({ tenantId: 't1', signalId: 'sig-1', actorUserId });

describe('SignalFilterService compliance and capability checks', () => {
  it("a BLOCK case on some other tenant user no longer stops the signal", async () => {
    const { service, complianceFindFirst } = build({ blockCaseFor: ['someone-else'] });
    await expect(run(service)).resolves.toMatchObject({ allowed: true, filteredState: 'VALID' });
    expect(complianceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1', userId: { in: ['author-1', 'actor-1'] } }) }),
    );
  });

  it("a BLOCK case on the version's author or on the acting user stops it", async () => {
    await expect(run(build({ blockCaseFor: ['author-1'] }).service)).resolves.toMatchObject({ allowed: false, ruleId: 'COMPLIANCE_BLOCK' });
    await expect(run(build({ blockCaseFor: ['actor-1'] }).service)).resolves.toMatchObject({ allowed: false, ruleId: 'COMPLIANCE_BLOCK' });
  });

  it('failed compliance or symbol lookups propagate instead of allowing', async () => {
    await expect(run(build({ failing: 'compliance' }).service)).rejects.toThrow('compliance lookup failed');
    await expect(run(build({ failing: 'tradingSymbol' }).service)).rejects.toThrow('tradingSymbol lookup failed');
  });

  it('a known non-tradeable symbol is rejected; an unknown one is allowed with a warning', async () => {
    await expect(run(build({ tradingSymbol: { isTradeable: false } }).service)).resolves.toMatchObject({
      allowed: false,
      ruleId: 'EXCHANGE_NOT_TRADEABLE',
    });
    const unknown = build({});
    (unknown.service as any).prisma.tradingSymbol.findFirst.mockResolvedValueOnce(null);
    await expect(run(unknown.service)).resolves.toMatchObject({ allowed: true });
  });

  it('risk-profile blockedSymbols must be an array (a string matched substrings)', async () => {
    await expect(run(build({ riskProfile: { blockedSymbols: ['ETH-USDT'] } }).service)).resolves.toMatchObject({
      allowed: false,
      ruleId: 'RISK_BLOCKED_SYMBOL',
    });
    await expect(run(build({ riskProfile: { blockedSymbols: 'BTC-ETH-USDT-X' } }).service)).resolves.toMatchObject({ allowed: true });
  });

  it('with no author and no actor there is no compliance subject to look up', async () => {
    const { service, complianceFindFirst } = build({ createdBy: null });
    await expect(run(service, null)).resolves.toMatchObject({ allowed: true });
    expect(complianceFindFirst).not.toHaveBeenCalled();
  });
});
