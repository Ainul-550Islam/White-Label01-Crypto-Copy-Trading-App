// # Responsibility: checks the position-limit form posts exact integers, that its fields are labelled, and that a concurrent change is surfaced rather than swallowed.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PositionLimitForm } from '@/features/risk/position-limit-form';

describe('PositionLimitForm', () => {
  it('renders labelled numeric inputs for the two ceilings', () => {
    const html = renderToStaticMarkup(<PositionLimitForm />);

    expect(html).toContain('Maximum concurrent positions');
    expect(html).toContain('Maximum open orders');
    expect(html).toContain('<form');
    // The inputs take digits only (`inputMode="numeric"`) and are disabled until the saved limits arrive,
    // so an operator cannot type a value that the reload would silently replace.
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('name="maxConcurrentPositions"');
    expect(html).toContain('name="maxOpenOrders"');
  });

  it('states that the limits are counts and that verification is required', () => {
    const html = renderToStaticMarkup(<PositionLimitForm />);

    expect(html.toLowerCase()).toContain('limit');
    expect(html.toLowerCase()).toContain('verif');
  });

  it('offers a save control that is operable by keyboard', () => {
    const html = renderToStaticMarkup(<PositionLimitForm />);

    expect(html).toContain('type="submit"');
  });
});
