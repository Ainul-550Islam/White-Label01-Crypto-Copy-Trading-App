'use client';

import { useState, type JSX } from 'react';

import { theme } from '@/lib/theme';
import { OmsOrderDrawer } from '@/features/oms/oms-order-drawer';
import { OmsOrderTable } from '@/features/oms/oms-order-table';

/**
 * The order book plus its detail drawer.
 *
 * Selection lives here rather than inside the table so that the drawer and the
 * table stay in step: opening an order is one state change, and closing the
 * drawer returns the operator to the exact filtered page they came from (the
 * table keeps its filters, because it is not unmounted).
 */
export function OmsOrdersView(): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <OmsOrderTable selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId && (
        <div id="oms-order-detail">
          <OmsOrderDrawer orderId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
