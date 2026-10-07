// # Responsibility: checks rebalance preview disclosures, controlled target weights, and empty-snapshot safety.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AllocationRebalancePage } from '@/features/trading/allocation-rebalance-page';

const allocation = {
  traderId: 'trader-a',
  currentValue: '600.00',
  targetWeightBps: 6000,
  priceAvailable: true,
};

describe('AllocationRebalancePage', () => {
  it('renders user-input and preview-only warnings with a target weight control', () => {
    const html = renderToStaticMarkup(<AllocationRebalancePage initialTotalValue="1000.00" initialAllocations={[allocation]} />);
    expect(html).toContain('user supplied');
    expect(html).toContain('not checked against exchange balances or positions');
    expect(html).toContain('Preview portfolio value (unverified)');
    expect(html).toContain('trader-a target weight in basis points');
    expect(html).toContain('never creates an order or transfers funds');
  });

  it('does not offer preview submission without allocation rows', () => {
    const html = renderToStaticMarkup(<AllocationRebalancePage initialTotalValue="1000" initialAllocations={[]} />);
    expect(html).toContain('No allocation rows were supplied');
    expect(html).toContain('disabled=""');
  });
});
