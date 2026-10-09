// # Responsibility: protects the operator budget panel from rendering an unreadable rate-limit state as a healthy one.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExchangeRateLimitHealth,
  pressureTone,
  summarizeRateLimitHealth,
  toRateLimitRow,
  type ExchangeRateLimitRow,
  type ServerRateLimitState,
} from '../features/execution/exchange-rate-limit-health';

const measuredState: ServerRateLimitState = {
  venue: 'BINANCE',
  environment: 'LIVE',
  accountId: 'account-a',
  endpointClass: 'ORDER',
  currentUsage: 300,
  remaining: 300,
  pressure: 50,
  isWeightBased: true,
  requestsPerInterval: 10,
  scope: 'ACCOUNT',
  retryAfterMs: null,
  resetAtMs: 1767000000000,
};

function row(overrides: Partial<ExchangeRateLimitRow>): ExchangeRateLimitRow {
  return { ...toRateLimitRow('account-a', measuredState, { venue: 'BINANCE', endpointClass: 'ORDER' }), ...overrides };
}

describe('exchange rate-limit health', () => {
  test('a readable budget is shown with its measured usage, headroom and pressure', () => {
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={[row({})]} />);
    expect(html).toContain('300');
    expect(html).toContain('50%');
    expect(html).toContain('BINANCE');
    expect(html).toContain('ORDER');
    expect(html).not.toContain('UNKNOWN');
    expect(html).not.toContain('BUDGET UNKNOWN');
  });

  // The failure this panel exists to prevent: an unreadable budget rendered as an empty, healthy bar.
  test('an unreadable budget is UNKNOWN with its reason, never a healthy reading', () => {
    const unavailable = toRateLimitRow('account-a', null, { venue: 'BINANCE', endpointClass: 'ORDER' });
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={[unavailable]} />);

    expect(html).toContain('UNKNOWN');
    expect(html).toContain('BUDGET UNKNOWN');
    expect(html).toContain('could not be read');
    // No invented numbers: no zero pressure, no zero remaining.
    expect(html).not.toContain('>0%<');
    expect(unavailable.pressure).toBeNull();
    expect(unavailable.remaining).toBeNull();
    expect(unavailable.currentUsage).toBeNull();
  });

  test('the summary counts unreadable budgets separately from busy ones and withholds the worst pressure', () => {
    const summary = summarizeRateLimitHealth([
      row({ pressure: 95 }),
      row({ pressure: 75 }),
      toRateLimitRow('account-b', null, { venue: 'OKX', endpointClass: 'PRIVATE' }),
    ]);

    expect(summary).toEqual({ total: 3, unavailable: 1, atOrAboveWarning: 2, worstPressure: 95 });

    // With every budget unreadable there is no worst pressure to report - null, not 0.
    const allUnknown = summarizeRateLimitHealth([
      toRateLimitRow('account-a', null, { venue: 'BINANCE', endpointClass: 'ORDER' }),
    ]);
    expect(allUnknown.worstPressure).toBeNull();
    expect(allUnknown.unavailable).toBe(1);
  });

  test('pressure tones band at the documented thresholds and an unknown pressure has no tone', () => {
    expect(pressureTone(null)).toBeNull();
    expect(pressureTone(69)).toBe('neutral');
    expect(pressureTone(70)).toBe('warning');
    expect(pressureTone(89)).toBe('warning');
    expect(pressureTone(90)).toBe('danger');
    expect(pressureTone(100)).toBe('danger');
  });

  test('an account with no reported state stays in the list as unavailable rather than disappearing', () => {
    const rows = [
      row({}),
      toRateLimitRow('account-c', null, { venue: 'KRAKEN', endpointClass: 'PUBLIC' }),
    ];
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={rows} />);

    expect(html).toContain('account-c');
    expect(html).toContain('KRAKEN');
    expect(html).toContain('2 accounts monitored');
  });
});
