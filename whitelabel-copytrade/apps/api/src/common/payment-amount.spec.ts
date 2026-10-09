// # Contract-tests exact minor-unit and NOWPayments invoice amount conversions.
import { nowPaymentsInvoiceAmountToNumber, paymentAmountToMinorUnits } from './payment-amount';

describe('exact payment amount conversions', () => {
  it.each([
    ['49.99', 'USD', 4999],
    ['100', 'JPY', 100],
    ['0.00000001', 'BTC', 1],
    ['0.000000000000000001', 'ETH', 1],
    ['1.230000', 'USDT', 1230000],
    ['0.000001', 'TRX', 1],
  ])('scales %s %s to an exact safe integer', (amount, currency, expected) => {
    expect(paymentAmountToMinorUnits(amount, currency)).toBe(expected);
  });

  it('rejects precision beyond the configured currency scale instead of rounding', () => {
    expect(() => paymentAmountToMinorUnits('1.001', 'USD')).toThrow(/represent .* exactly at scale 2/);
    expect(() => paymentAmountToMinorUnits('0.0000000000000000001', 'ETH')).toThrow(/supported maximum|exactly at scale/);
  });

  it('rejects invalid currencies, negative amounts, and values beyond the safe integer range', () => {
    expect(() => paymentAmountToMinorUnits('1.00', 'UNKNOWN')).toThrow(/scale is not configured/);
    expect(() => paymentAmountToMinorUnits('-0.01', 'USD')).toThrow(/must not be negative/);
    expect(() => paymentAmountToMinorUnits('90071992547409.92', 'USD')).toThrow(/safe minor-unit range/);
    expect(() => paymentAmountToMinorUnits(1.23, 'USD')).toThrow(/exact decimal string/);
  });

  it('allows a NOWPayments invoice JSON number only when its decimal round-trip is exact', () => {
    expect(nowPaymentsInvoiceAmountToNumber('49.99')).toBe(49.99);
    expect(nowPaymentsInvoiceAmountToNumber('1.2300')).toBe(1.23);
    expect(() => nowPaymentsInvoiceAmountToNumber('1.230000000000000001')).toThrow(/losslessly/);
    expect(nowPaymentsInvoiceAmountToNumber('0.0000000000000000001')).toBe(1e-19);
    expect(() => nowPaymentsInvoiceAmountToNumber('0')).toThrow(/greater than zero/);
    expect(() => nowPaymentsInvoiceAmountToNumber(1.23)).toThrow(/exact decimal string/);
  });
});
