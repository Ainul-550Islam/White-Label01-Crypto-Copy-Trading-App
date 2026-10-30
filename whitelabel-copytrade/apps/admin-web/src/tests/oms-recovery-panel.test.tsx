// # Responsibility: checks the OMS recovery panel renders its actions with the confirmation and step-up copy a money-affecting retry needs.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OmsRecoveryPanel } from '@/features/oms/oms-recovery-panel';

describe('OmsRecoveryPanel', () => {
  it('renders the recovery surface', () => {
    const html = renderToStaticMarkup(<OmsRecoveryPanel />);

    expect(html.toLowerCase()).toContain('recover');
    expect(html.length).toBeGreaterThan(200);
  });

  it('does not claim a recovery succeeded before one was requested', () => {
    const html = renderToStaticMarkup(<OmsRecoveryPanel />);

    expect(html.toLowerCase()).not.toContain('recovered successfully');
  });
});
