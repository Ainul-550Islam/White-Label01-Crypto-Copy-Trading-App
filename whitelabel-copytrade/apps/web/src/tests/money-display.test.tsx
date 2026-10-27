import { renderToStaticMarkup } from 'react-dom/server';
import { Money, MoneyWithState } from '@/components/money';

test('renders token symbols and exact large decimal strings without binary rounding', () => {
  const html = renderToStaticMarkup(<Money value="9007199254740993.000000000001" currency="USDT" />);
  expect(html).toContain('USDT 9,007,199,254,740,993.000000000001');
  expect(html).toContain('aria-label="9007199254740993.000000000001 USDT"');
});

test('known currencies, signs, zero and fixed precision are displayed without float conversion', () => {
  expect(renderToStaticMarkup(<Money value="-0001.005" currency="USD" precision={2} />)).toContain('-$1.00');
  expect(renderToStaticMarkup(<Money value="1.015" currency="USD" precision={2} showSign />)).toContain('+$1.02');
  expect(renderToStaticMarkup(<Money value="-0.00" currency="BTC" />)).toContain('BTC 0.00');
  expect(renderToStaticMarkup(<Money value="12.000000001" currency="" />)).toContain('12.000000001');
});

test('missing and nondecimal values stay visibly unavailable and stale values remain labelled', () => {
  expect(renderToStaticMarkup(<Money value={null} />)).toContain('—');
  expect(renderToStaticMarkup(<Money value="UNKNOWN" currency="USDT" />)).toContain('UNKNOWN');
  expect(renderToStaticMarkup(<MoneyWithState value="5" currency="USDT" valuationState="STALE" />)).toContain('STALE');
});
