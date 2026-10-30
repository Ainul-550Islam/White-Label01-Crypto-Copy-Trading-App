'use client';

import { useMemo, useState, type JSX } from 'react';

import { custodyAdminApi } from '@/api/custody-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';

import { formatAmount } from '@/features/shared/money';
import { SweepPanel } from './sweep-panel';
import { useResource } from '@/features/shared/use-resource';

/**
 * Treasury oversight: what the organisation actually holds, what it must keep
 * as reserve, what is moving, and whether the chain providers are answering.
 *
 * Three rules from the API shape the rendering:
 *
 *  * `available: null` means the provider did not return a usable reading. It
 *    is rendered as "Unavailable", never as 0 and never summed into a total.
 *  * `dataCompleteness` is shown next to the total, because
 *    PARTIAL_UNKNOWN and PROVIDER_DERIVED are different claims.
 *  * Reserves are read from the reserve table rather than recomputed in the
 *    browser, so the console and the API cannot disagree about a shortfall.
 */
export function TreasuryOverview({ operatorId, canReadPolicy }: { operatorId: string; canReadPolicy: boolean }): JSX.Element {
  const assets = useResource(() => custodyAdminApi.listAssets({ isActive: true, limit: 100 }), []);
  const [assetId, setAssetId] = useState('');

  const assetOptions = useMemo(() => assets.data?.data ?? [], [assets.data]);
  const selectedAsset = assetId || assetOptions[0]?.assetId || '';

  const treasury = useResource(
    () => custodyAdminApi.getTreasuryBalance({ assetId: selectedAsset }),
    [selectedAsset],
    { enabled: selectedAsset !== '', errorMessage: 'The treasury balance could not be read from the provider.' },
  );
  const reserves = useResource(() => custodyAdminApi.listReserves({ limit: 25 }), []);
  const transfers = useResource(() => custodyAdminApi.listInternalTransfers({ limit: 25 }), []);
  const providers = useResource(() => custodyAdminApi.getProvidersHealth(), []);
  const policy = useResource(() => custodyAdminApi.getPolicy(), [], { enabled: canReadPolicy });

  const balances = treasury.data?.balances ?? [];
  const pendingSettlements = (transfers.data?.data ?? []).filter((row) => row.state !== 'SETTLED' && row.state !== 'CANCELLED');
  const unhealthy = (providers.data ?? []).filter((provider) => !provider.healthy);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Treasury balance"
        description="Provider-reported balances. An unavailable reading is reported as unavailable and is never shown as zero."
        actions={
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Asset
            <select
              value={selectedAsset}
              onChange={(event) => setAssetId(event.target.value)}
              disabled={assets.loading || assetOptions.length === 0}
            >
              {assetOptions.length === 0 && <option value="">No active assets</option>}
              {assetOptions.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>{asset.symbol}</option>
              ))}
            </select>
          </label>
        }
      >
        {assets.error && <ErrorNotice title="Assets unavailable" message={assets.error} />}
        {treasury.loading && (
          <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Reading balances from the provider…</p>
        )}
        {treasury.error && <ErrorNotice title="Treasury balance unavailable" message={treasury.error} />}
        {treasury.data && (
          <div style={{ display: 'grid', gap: theme.space(4) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3), flexWrap: 'wrap' }}>
              <StatTile
                label={`Available (${selectedAsset})`}
                value={formatAmount(treasury.data.totalAvailable)}
                hint={balances.length > 0 ? `Across ${balances.length} wallet${balances.length === 1 ? '' : 's'}` : 'No wallets hold this asset'}
              />
              <Badge tone={treasury.data.dataCompleteness === 'PROVIDER_DERIVED' ? 'success' : treasury.data.dataCompleteness === 'PARTIAL_UNKNOWN' ? 'warning' : 'danger'}>
                {treasury.data.dataCompleteness === 'PROVIDER_DERIVED'
                  ? 'Provider-derived total'
                  : treasury.data.dataCompleteness === 'PARTIAL_UNKNOWN'
                    ? 'Partial: some readings unavailable'
                    : 'No wallet to read'}
              </Badge>
            </div>
            {treasury.data.dataCompleteness !== 'PROVIDER_DERIVED' && (
              <p role="note" style={{ margin: 0, fontSize: 13, color: theme.color.warning }}>
                This total is incomplete. Verify the wallet balances below before relying on it for a reserve decision.
              </p>
            )}
            <DataTable
              rows={balances}
              rowKey={(row) => `${row.walletId}:${row.networkId}`}
              emptyTitle="No balances to show"
              emptyDescription="No custody wallet holds this asset, or the provider returned no reading for it."
              columns={[
                { key: 'wallet', header: 'Wallet', render: (row) => <code style={{ fontSize: 12 }}>{row.walletId.slice(0, 8)}</code> },
                { key: 'network', header: 'Network', render: (row) => row.networkId },
                { key: 'available', header: 'Available', align: 'right', render: (row) => formatAmount(row.available, { symbol: row.assetSymbol }) },
                { key: 'pendingIn', header: 'Pending in', align: 'right', render: (row) => formatAmount(row.pendingIn) },
                { key: 'pendingOut', header: 'Pending out', align: 'right', render: (row) => formatAmount(row.pendingOut) },
                { key: 'reserved', header: 'Reserved', align: 'right', render: (row) => formatAmount(row.reserved) },
                { key: 'provider', header: 'Provider', render: (row) => row.provider },
                { key: 'observed', header: 'Observed', render: (row) => formatDateTime(row.observationTimestamp) },
              ]}
            />
          </div>
        )}
      </Card>

      <Card title="Reserves" description="Required versus available, as computed by the API. A shortfall is not rounded away.">
        {reserves.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading reserves…</p>}
        {reserves.error && <ErrorNotice title="Reserves unavailable" message={reserves.error} />}
        {reserves.data && (
          <DataTable
            rows={reserves.data.data}
            rowKey={(row) => row.id}
            emptyTitle="No reserves configured"
            emptyDescription="Create a reserve for each asset that must stay funded before withdrawals are allowed."
            columns={[
              { key: 'asset', header: 'Asset', render: (row) => row.assetId },
              { key: 'type', header: 'Type', render: (row) => row.reserveType },
              { key: 'required', header: 'Required', align: 'right', render: (row) => formatAmount(row.requiredAmount) },
              { key: 'available', header: 'Available', align: 'right', render: (row) => formatAmount(row.availableAmount) },
              { key: 'reserved', header: 'Reserved', align: 'right', render: (row) => formatAmount(row.reservedAmount) },
              { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
              { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updatedAt) },
            ]}
          />
        )}
      </Card>

      <Card title="Pending settlements" description="Internal transfers that have not settled yet.">
        {transfers.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading transfers…</p>}
        {transfers.error && <ErrorNotice title="Internal transfers unavailable" message={transfers.error} />}
        {transfers.data && (
          <DataTable
            rows={pendingSettlements}
            rowKey={(row) => row.id}
            emptyTitle="No pending settlements"
            emptyDescription="Every internal transfer has settled or been cancelled."
            columns={[
              { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount, { symbol: row.assetId }) },
              { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
              { key: 'route', header: 'Wallets', render: (row) => <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.sourceWalletId.slice(0, 8)} → {row.destinationWalletId.slice(0, 8)}</span> },
              { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>

      <Card title="Provider health" description="A provider that cannot answer is reported as unhealthy; it is never assumed to be fine.">
        {providers.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Checking providers…</p>}
        {providers.error && <ErrorNotice title="Provider health unavailable" message={providers.error} />}
        {providers.data && (
          <>
            {unhealthy.length > 0 && (
              <p role="alert" style={{ marginTop: 0, fontSize: 13, color: theme.color.danger }}>
                {unhealthy.length} provider{unhealthy.length === 1 ? ' is' : 's are'} not healthy. Deposits and withdrawals that depend on them will not be observed.
              </p>
            )}
            <DataTable
              rows={providers.data}
              rowKey={(row) => row.providerId}
              emptyTitle="No providers configured"
              columns={[
                { key: 'name', header: 'Provider', render: (row) => row.providerName },
                { key: 'health', header: 'Status', render: (row) => <Badge tone={row.healthy ? 'success' : 'danger'}>{row.healthy ? 'Healthy' : 'Unhealthy'}</Badge> },
                { key: 'reason', header: 'Detail', render: (row) => row.reason ?? '—' },
              ]}
            />
          </>
        )}
      </Card>

      {policy.data && (
        <Card title="Withdrawal policy in force" description="Resolved by the API for this tenant. Editing policy is a backend configuration change, not a console action.">
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.space(4), margin: 0 }}>
            <div>
              <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>Max single withdrawal</dt>
              <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 16, fontWeight: 600 }}>{formatAmount(policy.data.withdrawalLimits.maxSingleWithdrawal)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>Max daily withdrawal</dt>
              <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 16, fontWeight: 600 }}>{formatAmount(policy.data.withdrawalLimits.maxDailyWithdrawal)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>Max pending withdrawals</dt>
              <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 16, fontWeight: 600 }}>{policy.data.withdrawalLimits.maxPendingWithdrawals}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>Address allowlist</dt>
              <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 16, fontWeight: 600 }}>{policy.data.addressAllowlisting.requireAllowlist ? 'Required' : 'Not required'}</dd>
            </div>
          </dl>
        </Card>
      )}

      <SweepPanel operatorId={operatorId} />
    </div>
  );
}
