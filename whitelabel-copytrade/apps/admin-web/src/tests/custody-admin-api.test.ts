import { custodyAdminApi as api } from '@/api/custody-admin-api';
import { apiClient } from '@/lib/api-client';

/**
 * Every function is asserted against the route the controller declares:
 * exact HTTP method, exact path (prefix + segment + parameter), exact body
 * keys and the idempotency key on every state-changing call. A path that
 * drifts from `custody.controller.ts` fails here rather than 404-ing in
 * production.
 */
jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'custody-intent-1';
const opts = { idempotencyKey: key };
const base = '/v1/custody';

afterEach(() => jest.clearAllMocks());

describe('wallet routes', () => {
  it('creates a wallet with the declared body and key', () => {
    const input = { assetId: 'BTC', networkId: 'bitcoin', walletType: 'HOT', operatorId: 'op-1' };
    void api.createWallet(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/wallets`, input, opts);
  });

  it('transitions a wallet state', () => {
    const input = { walletId: 'w-1', toState: 'ACTIVE' as const, operatorId: 'op-1', reason: 'Activated after funding' };
    void api.transitionWallet(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/wallets/transition`, input, opts);
  });

  it('lists wallets with only the filters that were supplied', () => {
    void api.listWallets({ state: 'ACTIVE', assetId: 'BTC', page: 2, limit: 25, networkId: undefined });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/wallets`, {
      searchParams: { state: 'ACTIVE', assetId: 'BTC', page: 2, limit: 25 },
    });
  });

  it('reads a wallet by encoded id', () => {
    void api.getWallet('w/1');

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/wallets/w%2F1`);
  });
});

describe('address routes', () => {
  it('issues an address (step-up protected route)', () => {
    const input = { walletId: 'w-1', address: 'bc1qexample', assetId: 'BTC', networkId: 'bitcoin' };
    void api.createAddress(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/addresses`, input, opts);
  });

  it('lists addresses paged', () => {
    void api.listAddresses({ walletId: 'w-1', status: 'ACTIVE', limit: 10 });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/addresses`, {
      searchParams: { walletId: 'w-1', status: 'ACTIVE', limit: 10 },
    });
  });

  it('gets or creates a deposit address', () => {
    const input = { walletId: 'w-1', assetId: 'ETH', networkId: 'ethereum' };
    void api.getOrCreateDepositAddress(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/deposit-addresses/get-or-create`, input, opts);
  });
});

describe('deposit routes', () => {
  it('observes a deposit', () => {
    const input = { walletId: 'w-1', assetId: 'BTC', networkId: 'bitcoin', amount: '0.50000000', transactionHash: '0xabc' };
    void api.observeDeposit(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/deposits/observe`, input, opts);
  });

  it('updates deposit confirmations for an encoded deposit id', () => {
    const input = { confirmationCount: 3, blockHash: '0xblock' };
    void api.updateDepositConfirmations('d/1', input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/deposits/d%2F1/confirmations`, input, opts);
  });

  it('raises a deposit reorg', () => {
    void api.handleDepositReorg('d-1', { reason: 'Chain reorg at height 800000' }, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/deposits/d-1/reorg`, { reason: 'Chain reorg at height 800000' }, opts);
  });
});

describe('withdrawal routes', () => {
  it('evaluates eligibility as a POST that still carries the caller key', () => {
    const input = { assetId: 'USDT', networkId: 'ethereum', amount: '100.00', destinationAddress: '0xdest' };
    void api.evaluateWithdrawal(input, 'evaluate-key');

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/withdrawals/evaluate`, input, { idempotencyKey: 'evaluate-key' });
  });

  it('submits a custody withdrawal with a key', () => {
    const input = { custodyWithdrawalId: 'cw-1', operatorId: 'op-1', correlationId: 'corr-1' };
    void api.submitWithdrawal(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/withdrawals/submit`, input, opts);
  });

  it('finalises deposit and withdrawal settlement on their own paths', () => {
    void api.finalizeDepositSettlement({ depositId: 'd-1', operatorId: 'op-1' }, key);
    void api.finalizeWithdrawalSettlement({ custodyWithdrawalId: 'cw-1', operatorId: 'op-1' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/settlement/deposit/finalize`, { depositId: 'd-1', operatorId: 'op-1' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/settlement/withdrawal/finalize`, { custodyWithdrawalId: 'cw-1', operatorId: 'op-1' }, opts);
  });
});

describe('transaction routes', () => {
  it('creates and transitions a transaction', () => {
    const created = { walletId: 'w-1', assetId: 'BTC', networkId: 'bitcoin', direction: 'INBOUND' as const, amount: '0.10000000' };
    void api.createTransaction(created, key);
    const transitioned = { transactionId: 't-1', toState: 'CONFIRMED' as const, confirmationCount: 6 };
    void api.transitionTransaction(transitioned, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/transactions`, created, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/transactions/transition`, transitioned, opts);
  });

  it('lists transactions with pagination and filters', () => {
    void api.listTransactions({ direction: 'OUTBOUND', status: 'CONFIRMING', page: 1, limit: 50, walletId: '' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/transactions`, {
      searchParams: { direction: 'OUTBOUND', status: 'CONFIRMING', page: 1, limit: 50 },
    });
  });

  it('reads, polls and reorgs a transaction', () => {
    void api.getTransaction('t/1');
    void api.pollTransaction('t-1', key);
    void api.handleTransactionReorg('t-1', { reason: 'Reorg', newBlockHash: '0xnew' }, key);

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/transactions/t%2F1`);
    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/transactions/t-1/poll`, undefined, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/transactions/t-1/reorg`, { reason: 'Reorg', newBlockHash: '0xnew' }, opts);
  });
});

describe('confirmation and fee routes', () => {
  it('observes a confirmation and reads the confirmation chain', () => {
    const input = { transactionId: 't-1', confirmationCount: 2 };
    void api.observeConfirmation(input, key);
    void api.getConfirmations('t-1');

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/confirmations/observe`, input, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/confirmations/t-1`);
  });

  it('estimates a fee and reads the actual fee', () => {
    const input = { assetId: 'BTC', networkId: 'bitcoin', amount: '0.1' };
    void api.estimateFee(input, 'fee-key');
    void api.getActualFee('t-1');

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/fees/estimate`, input, { idempotencyKey: 'fee-key' });
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/fees/t-1`);
  });
});

describe('internal transfer routes', () => {
  it('creates, approves, settles and lists internal transfers', () => {
    const created = { sourceWalletId: 'w-1', destinationWalletId: 'w-2', assetId: 'USDT', networkId: 'ethereum', amount: '500.00' };
    void api.createInternalTransfer(created, key);
    void api.approveInternalTransfer({ transferId: 'it-1', approverId: 'op-1' }, key);
    void api.settleInternalTransfer({ transferId: 'it-1', operatorId: 'op-1' }, key);
    void api.listInternalTransfers({ state: 'APPROVED' });

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/internal-transfers`, created, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/internal-transfers/approve`, { transferId: 'it-1', approverId: 'op-1' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${base}/internal-transfers/settle`, { transferId: 'it-1', operatorId: 'op-1' }, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/internal-transfers`, { searchParams: { state: 'APPROVED' } });
  });
});

describe('balance routes', () => {
  it('reads a wallet balance with an explicit asset and network', () => {
    void api.getWalletBalance('w/1', { assetId: 'BTC', networkId: 'bitcoin' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/balances/wallet/w%2F1`, {
      searchParams: { assetId: 'BTC', networkId: 'bitcoin' },
    });
  });

  it('reads the treasury balance', () => {
    void api.getTreasuryBalance({ assetId: 'USDT' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/balances/treasury`, { searchParams: { assetId: 'USDT' } });
  });
});

describe('reserve routes', () => {
  it('creates, lists and evaluates reserves', () => {
    const created = { assetId: 'USDT', reserveType: 'OPERATIONAL', requiredAmount: '10000.00' };
    void api.createReserve(created, key);
    void api.listReserves({ state: 'ACTIVE', assetId: 'USDT' });
    const evaluated = { assetId: 'USDT', requiredAmount: '10000.00' };
    void api.evaluateReserve(evaluated, 'reserve-key');

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/reserves`, created, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/reserves`, { searchParams: { state: 'ACTIVE', assetId: 'USDT' } });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/reserves/evaluate`, evaluated, { idempotencyKey: 'reserve-key' });
  });
});

describe('sweep routes', () => {
  it('creates, approves, executes and lists sweeps', () => {
    const created = { sourceWalletId: 'w-1', destinationWalletId: 'w-2', assetId: 'BTC', networkId: 'bitcoin', amount: '1.0', reason: 'Consolidate hot wallet' };
    void api.createSweep(created, key);
    void api.approveSweep({ sweepId: 's-1', approverId: 'op-2' }, key);
    void api.executeSweep({ sweepId: 's-1', operatorId: 'op-1' }, key);
    void api.listSweeps({ state: 'REQUESTED' });

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/sweeps`, created, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/sweeps/approve`, { sweepId: 's-1', approverId: 'op-2' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${base}/sweeps/execute`, { sweepId: 's-1', operatorId: 'op-1' }, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/sweeps`, { searchParams: { state: 'REQUESTED' } });
  });
});

describe('reconciliation routes', () => {
  it('runs reconciliation, lists findings and resolves one', () => {
    const run = { assetId: 'USDT', networkId: 'ethereum' };
    void api.runReconciliation(run, key);
    void api.listFindings({ resolved: false, type: 'PROVIDER_WALLET_WITHOUT_INTERNAL_RECORD' });
    const resolved = { findingId: 'f-1', reason: 'Provider record matched', resolution: 'ADJUSTED' };
    void api.resolveFinding(resolved, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${base}/reconciliation/run`, run, opts);
    expect(apiClient.get).toHaveBeenCalledWith(`${base}/reconciliation/findings`, {
      searchParams: { resolved: false, type: 'PROVIDER_WALLET_WITHOUT_INTERNAL_RECORD' },
    });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${base}/reconciliation/resolve`, resolved, opts);
  });
});

describe('audit, policy and registry routes', () => {
  it('lists and exports the custody audit trail', () => {
    void api.listAudits({ action: 'WALLET_CREATED', fromDate: '2026-10-01', page: 1 });
    void api.exportAudits({ fromDate: '2026-10-01T00:00:00.000Z', toDate: '2026-10-31T00:00:00.000Z', format: 'JSON' }, key);

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/audits`, {
      searchParams: { action: 'WALLET_CREATED', fromDate: '2026-10-01', page: 1 },
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      `${base}/audits/export`,
      { fromDate: '2026-10-01T00:00:00.000Z', toDate: '2026-10-31T00:00:00.000Z', format: 'JSON' },
      opts,
    );
  });

  it('reads policy, registries and provider health', () => {
    void api.getPolicy({ walletId: 'w-1' });
    void api.listAssets({ isActive: true });
    void api.listNetworks({ status: 'ACTIVE' });
    void api.getProvidersHealth();

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${base}/policy`, { searchParams: { walletId: 'w-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${base}/assets`, { searchParams: { isActive: true } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${base}/networks`, { searchParams: { status: 'ACTIVE' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${base}/providers/health`);
  });

  it('reads the operator-only withdrawal destination audit listing', () => {
    void api.listDestinations({ limit: 100 });

    expect(apiClient.get).toHaveBeenCalledWith('/v1/admin/custody/destinations', { searchParams: { limit: 100 } });
  });
});

describe('step-up proof', () => {
  it('posts the method-specific payload to the shared verification route', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'proof-1',
      action: 'CUSTODY_SWEEP',
      method: 'TOTP',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await api.requestStepUp('CUSTODY_SWEEP', 'TOTP', '123456', 'proof-key');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'CUSTODY_SWEEP', method: 'TOTP', code: '123456' },
      { idempotencyKey: 'proof-key' },
    );
  });

  it('sends the password and recovery-code variants under their own keys', async () => {
    jest.mocked(apiClient.post)
      .mockResolvedValueOnce({ proofId: 'p1', action: 'PAYOUT_APPROVE', method: 'PASSWORD', expiresAt: new Date(Date.now() + 60_000).toISOString() })
      .mockResolvedValueOnce({ proofId: 'p2', action: 'PAYOUT_APPROVE', method: 'RECOVERY_CODE', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    await api.requestStepUp('PAYOUT_APPROVE', 'PASSWORD', 'secret', 'k1');
    await api.requestStepUp('PAYOUT_APPROVE', 'RECOVERY_CODE', 'recovery', 'k2');

    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/v1/auth/step-up/verify', { action: 'PAYOUT_APPROVE', method: 'PASSWORD', password: 'secret' }, { idempotencyKey: 'k1' });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, '/v1/auth/step-up/verify', { action: 'PAYOUT_APPROVE', method: 'RECOVERY_CODE', recoveryCode: 'recovery' }, { idempotencyKey: 'k2' });
  });

  it('refuses a proof that is for another action, another method, or already expired', async () => {
    const expired = new Date(Date.now() - 1_000).toISOString();
    const valid = { proofId: 'p', action: 'CUSTODY_SWEEP', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString() };

    jest.mocked(apiClient.post).mockResolvedValueOnce({ ...valid, action: 'PAYOUT_APPROVE' });
    await expect(api.requestStepUp('CUSTODY_SWEEP', 'TOTP', '123456', 'k')).rejects.toThrow('Invalid verification response');

    jest.mocked(apiClient.post).mockResolvedValueOnce({ ...valid, method: 'PASSWORD' });
    await expect(api.requestStepUp('CUSTODY_SWEEP', 'TOTP', '123456', 'k')).rejects.toThrow('Invalid verification response');

    jest.mocked(apiClient.post).mockResolvedValueOnce({ ...valid, expiresAt: expired });
    await expect(api.requestStepUp('CUSTODY_SWEEP', 'TOTP', '123456', 'k')).rejects.toThrow('Invalid verification response');

    jest.mocked(apiClient.post).mockResolvedValueOnce({ ...valid, expiresAt: 'not-a-date' });
    await expect(api.requestStepUp('CUSTODY_SWEEP', 'TOTP', '123456', 'k')).rejects.toThrow('Invalid verification response');
  });

  it('does not treat a bare success status as a proof', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({ ok: true });

    await expect(api.requestStepUp('CUSTODY_ADDRESS_ISSUE', 'TOTP', '123456', 'k')).rejects.toThrow('Invalid verification response');
  });
});
