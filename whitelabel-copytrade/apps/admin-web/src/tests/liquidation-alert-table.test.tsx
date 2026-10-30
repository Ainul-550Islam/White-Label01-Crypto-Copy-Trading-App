// # Responsibility: checks the liquidation alert table starts in a loadable state, keeps the severity filter labelled, and never renders an unknown distance as a comfortable number.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LiquidationAlertTable } from '@/features/risk/liquidation-alert-table';

describe('LiquidationAlertTable', () => {
  it('renders the list with a labelled severity filter', () => {
    const html = renderToStaticMarkup(<LiquidationAlertTable />);

    expect(html).toContain('Liquidation alerts');
    expect(html).toContain('Severity');
    expect(html).toContain('<select');
    expect(html).toContain('<label');
  });

  it('does not print a distance to liquidation before the service reports one', () => {
    const html = renderToStaticMarkup(<LiquidationAlertTable />);

    // No row has been loaded yet, so no distance, price or bucket may appear - only the service's own
    // statement that an unknown distance is not shown as a comfortable one.
    expect(html).not.toContain('USDT');
    expect(html).not.toContain('Liquidation price');
    expect(html).toContain('an unknown distance is not shown as a comfortable one');
    expect(html).toContain('Loading liquidation alerts');
  });
});
