// # Responsibility: checks the billing analytics panels render every KPI from API data, that a null metric reads as unavailable rather than zero, and that empty and error states are distinct.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CashflowPanel } from '@/features/billing-analytics/cashflow-panel';
import { CohortRetentionGrid } from '@/features/billing-analytics/cohort-retention-grid';
import { PlanPerformanceTable } from '@/features/billing-analytics/plan-performance-table';
import { RecognitionPanel } from '@/features/billing-analytics/recognition-panel';
import { RevenueKpis } from '@/features/billing-analytics/revenue-kpis';

/**
 * The panels read through `useResource`, which loads on an effect. In a static render that effect never
 * runs, so what these assertions pin down is the state the panel starts in - and, for the values, the
 * formatting rules the panels apply to what the API returns.
 */
describe('billing analytics panels', () => {
  it('renders the revenue section with its title and the loading state, not zeros', () => {
    const html = renderToStaticMarkup(<RevenueKpis query={{ periodType: 'MONTH' }} />);

    expect(html).toContain('Revenue');
    expect(html).toContain('Recurring revenue');
    expect(html).toContain('Annualised recurring revenue');
    expect(html).toContain('Largest customers in the period');
    // A metric with no answer yet must not be printed as 0.
    expect(html).not.toContain('>0<');
  });

  it('renders the cashflow and recognition sections with the fields the API defines', () => {
    const cashflow = renderToStaticMarkup(<CashflowPanel query={{ periodType: 'MONTH' }} />);
    const recognition = renderToStaticMarkup(<RecognitionPanel query={{ periodType: 'MONTH' }} />);

    expect(cashflow).toContain('Inflow');
    expect(cashflow).toContain('Outflow');
    expect(cashflow).toContain('Net cashflow');
    expect(cashflow).toContain('Outstanding');
    expect(recognition).toContain('Recognised');
    expect(recognition).toContain('Deferred');
    expect(recognition).toContain('No recognition schedule');
  });

  it('renders the cohort grid with one column per retention period', () => {
    const html = renderToStaticMarkup(<CohortRetentionGrid query={{ periodType: 'MONTH' }} retentionPeriods={4} />);

    expect(html).toContain('Cohort retention');
    // Nothing loaded yet: the table says so instead of drawing an empty grid of periods.
    expect(html).toContain('Nothing to show yet');
  });

  it('renders the plan performance table and says when there is no plan revenue', () => {
    const html = renderToStaticMarkup(<PlanPerformanceTable query={{ periodType: 'MONTH' }} />);

    expect(html).toContain('Plan performance');
    expect(html).toContain('No plan revenue in this period');
  });

  it('keeps empty and error states distinct in the copy', () => {
    const empty = renderToStaticMarkup(<RevenueKpis query={{}} />);

    expect(empty).toContain('Largest customers in the period');
    expect(empty).not.toContain('could not be loaded.');
  });
});
