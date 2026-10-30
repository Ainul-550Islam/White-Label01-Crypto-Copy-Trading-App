'use client';

import { useMemo, useState, type JSX } from 'react';

import { riskAdminApi, riskRows, type LiquidationAlert } from '@/api/risk-admin-api';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Liquidation alerts for the caller's own scope (`GET risk/liquidation-alerts`).
 *
 * The controller exposes a single read: there is no acknowledge or dismiss
 * route, so this page does not pretend to offer one. Its job is to make the
 * distance to liquidation unmistakable and to say plainly when the distance is
 * unknown rather than showing a reassuring number.
 */
export function LiquidationAlertTable(): JSX.Element {
  const [severity, setSeverity] = useState('');
  const alerts = useResource(() => riskAdminApi.listLiquidationAlerts(), [], { errorMessage: 'Liquidation alerts could not be loaded.' });

  const rows = useMemo(() => {
    const all = riskRows(alerts.data);
    return severity ? all.filter((row) => row.severity?.toUpperCase() === severity) : all;
  }, [alerts.data, severity]);

  const critical = riskRows(alerts.data).filter((row) => row.severity?.toUpperCase() === 'CRITICAL').length;
  const unknownDistance = rows.filter((row) => row.distancePercent === null || row.distancePercent === undefined).length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Liquidation alerts"
        description="Positions approaching their liquidation price. Distance is reported by the risk service; an unknown distance is not shown as a comfortable one."
        actions={
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={alerts.loading}>
              <option value="">All severities</option>
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        }
      >
        {alerts.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading liquidation alerts…</p>}
        {alerts.error && <ErrorNotice title="Liquidation alerts unavailable" message={alerts.error} />}

        {alerts.data && (
          <>
            <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
              <StatTile label="Alerts" value={rows.length} />
              <StatTile label="Critical" value={critical} hint={critical > 0 ? 'Review these first' : undefined} />
              <StatTile label="Unknown distance" value={unknownDistance} hint="The service did not return a distance for these" />
            </div>

            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              emptyTitle={severity ? 'No alerts at this severity' : 'No liquidation alerts'}
              emptyDescription="Liquidation alerts appear here when a position moves inside the risk service's warning band."
              columns={[
                { key: 'severity', header: 'Severity', render: (row: LiquidationAlert) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge> },
                { key: 'symbol', header: 'Symbol', render: (row: LiquidationAlert) => row.symbol ?? '—' },
                { key: 'account', header: 'Account', render: (row: LiquidationAlert) => <code style={{ fontSize: 12 }}>{(row.accountId ?? '—').slice(0, 8)}</code> },
                { key: 'distance', header: 'Distance to liquidation', align: 'right', render: (row: LiquidationAlert) => (row.distancePercent === null || row.distancePercent === undefined ? 'Not available' : `${row.distancePercent}%`) },
                { key: 'liq', header: 'Liquidation price', align: 'right', render: (row: LiquidationAlert) => formatAmount(row.liquidationPrice) },
                { key: 'mark', header: 'Mark price', align: 'right', render: (row: LiquidationAlert) => formatAmount(row.markPrice) },
                { key: 'at', header: 'Raised', render: (row: LiquidationAlert) => formatDateTime(row.createdAt) },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
