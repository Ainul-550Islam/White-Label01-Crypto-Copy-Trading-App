import { Logger } from '@nestjs/common';
import { IPayoutProvider } from './payout-provider.interface';
import {
  CreatePayoutInput,
  PayoutProvider,
  PayoutProviderResult,
  PayoutStatus,
  PayoutStatusResult,
} from './payout.types';

/**
 * Stripe Connect payout adapter (Transfers API, plain REST - no SDK).
 *
 * A Stripe Transfer moves funds from the platform balance to a connected
 * account's balance. It is synchronous: once Stripe returns the transfer
 * object the money has moved, so the result is SUCCEEDED (or REVERSED if a
 * reversal already covers the full amount). Getting the money from the
 * connected account to the beneficiary's bank is the connected account's own
 * Stripe payout schedule and is not modelled here.
 *
 * Fail-closed rules:
 *  - no STRIPE_SECRET_KEY (or a publishable key by mistake) -> isAvailable() false,
 *    every call throws; nothing is reported as paid;
 *  - destination must be `stripe_account` with an `acct_...` id;
 *  - amounts are converted with string arithmetic (no floating point) and
 *    rejected if they carry more decimals than the currency allows;
 *  - the payout idempotency key is sent as Stripe's Idempotency-Key header,
 *    so a retried request can never create a second transfer;
 *  - any non-2xx response throws with Stripe's error code/message (never the
 *    key) so PayoutService records the failure.
 */

/** Stripe zero-decimal currencies (amount is already in the smallest unit). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/** Stripe three-decimal currencies (amount must be a multiple of 10 minor units). */
const THREE_DECIMAL_CURRENCIES = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

const CONNECTED_ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,}$/;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export interface StripeConnectPayoutOptions {
  secretKey?: string;
  apiBase?: string;
  apiVersion?: string;
  fetchImpl?: FetchLike;
}

/** Converts a decimal amount string to Stripe's integer minor units, exactly. */
export function toStripeMinorUnits(amount: string, currency: string): number {
  const cur = currency.toLowerCase();
  const trimmed = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid payout amount "${amount}"`);
  }
  const decimals = ZERO_DECIMAL_CURRENCIES.has(cur) ? 0 : THREE_DECIMAL_CURRENCIES.has(cur) ? 3 : 2;
  const [whole, fraction = ''] = trimmed.split('.');
  const significantFraction = fraction.replace(/0+$/, '');
  if (significantFraction.length > decimals) {
    throw new Error(
      `Payout amount ${amount} has more than ${decimals} decimal places for ${cur.toUpperCase()}`,
    );
  }
  const minor = BigInt(whole + significantFraction.padEnd(decimals, '0'));
  if (minor <= 0n) {
    throw new Error('Payout amount must be greater than zero');
  }
  if (THREE_DECIMAL_CURRENCIES.has(cur) && minor % 10n !== 0n) {
    throw new Error(`Stripe requires ${cur.toUpperCase()} amounts to be a multiple of 0.010`);
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Payout amount too large');
  }
  return Number(minor);
}

export class StripeConnectPayoutProvider implements IPayoutProvider {
  readonly providerName = PayoutProvider.STRIPE;
  private readonly logger = new Logger(StripeConnectPayoutProvider.name);
  private readonly secretKey: string;
  private readonly apiBase: string;
  private readonly apiVersion: string | undefined;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(options: StripeConnectPayoutOptions = {}) {
    this.secretKey = (options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '').trim();
    this.apiBase = (
      options.apiBase ??
      process.env.STRIPE_API_BASE ??
      'https://api.stripe.com'
    ).replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? process.env.STRIPE_API_VERSION ?? undefined;
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  }

  isAvailable(): boolean {
    // Secret (sk_) or restricted (rk_) keys only; a publishable key cannot move money.
    return /^(sk|rk)_(live|test)_/.test(this.secretKey) && !!this.fetchImpl;
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutProviderResult> {
    this.assertAvailable();
    const destination = input.destination;
    if (!destination || destination.type !== 'stripe_account') {
      throw new Error('Stripe Connect payouts require a destination of type stripe_account');
    }
    if (!CONNECTED_ACCOUNT_ID.test(destination.reference || '')) {
      throw new Error(
        'Stripe Connect payout destination must be a connected account id (acct_...)',
      );
    }
    if (!input.idempotencyKey) {
      throw new Error('Stripe Connect payouts require an idempotency key');
    }

    const currency = input.currency.toLowerCase();
    const form = new URLSearchParams();
    form.set('amount', String(toStripeMinorUnits(input.amount, currency)));
    form.set('currency', currency);
    form.set('destination', destination.reference);
    form.set('transfer_group', `settlement_${input.settlementId}`);
    form.set('description', `Settlement ${input.settlementId}`);
    form.set('metadata[settlement_id]', input.settlementId);
    form.set('metadata[tenant_id]', input.tenantId);
    form.set('metadata[beneficiary_id]', input.beneficiaryId);
    form.set('metadata[beneficiary_type]', String(input.beneficiaryType));

    const transfer = await this.request(
      'POST',
      '/v1/transfers',
      form.toString(),
      input.idempotencyKey,
    );
    const status = this.transferStatus(transfer);
    this.logger.log(
      `Stripe transfer ${transfer.id} created for settlement ${input.settlementId} (${status})`,
    );
    return {
      providerPayoutId: String(transfer.id),
      providerReference: transfer.balance_transaction
        ? String(transfer.balance_transaction)
        : undefined,
      status,
      rawResponse: this.safeTransfer(transfer),
    };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<PayoutStatusResult> {
    this.assertAvailable();
    if (!/^tr_[A-Za-z0-9]+$/.test(providerPayoutId)) {
      throw new Error('Not a Stripe transfer id');
    }
    const transfer = await this.request(
      'GET',
      `/v1/transfers/${encodeURIComponent(providerPayoutId)}`,
    );
    return {
      providerPayoutId,
      status: this.transferStatus(transfer),
      processedAt:
        typeof transfer.created === 'number'
          ? new Date(transfer.created * 1000).toISOString()
          : undefined,
      rawResponse: this.safeTransfer(transfer),
    };
  }

  normalizeStatus(providerStatus: string): PayoutStatus {
    switch ((providerStatus || '').toLowerCase()) {
      case 'paid':
      case 'succeeded':
      case 'created':
        return PayoutStatus.SUCCEEDED;
      case 'reversed':
        return PayoutStatus.REVERSED;
      case 'pending':
      case 'in_transit':
        return PayoutStatus.PROCESSING;
      case 'canceled':
      case 'cancelled':
        return PayoutStatus.CANCELLED;
      default:
        return PayoutStatus.FAILED;
    }
  }

  verifyProviderResponse(response: unknown): boolean {
    const r = response as any;
    return !!r && r.object === 'transfer' && typeof r.id === 'string' && r.id.startsWith('tr_');
  }

  private transferStatus(transfer: any): PayoutStatus {
    if (!this.verifyProviderResponse(transfer)) {
      throw new Error('Stripe returned an unexpected response for a transfer');
    }
    if (transfer.reversed === true) return PayoutStatus.REVERSED;
    return PayoutStatus.SUCCEEDED;
  }

  private safeTransfer(transfer: any): Record<string, unknown> {
    return {
      id: transfer.id,
      object: transfer.object,
      amount: transfer.amount,
      amount_reversed: transfer.amount_reversed,
      currency: transfer.currency,
      destination: transfer.destination,
      reversed: transfer.reversed,
      livemode: transfer.livemode,
      created: transfer.created,
    };
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error(
        'Stripe Connect payouts not configured: set STRIPE_SECRET_KEY (sk_/rk_ key). No fake success allowed.',
      );
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
    idempotencyKey?: string,
  ): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 255);
    if (this.apiVersion) headers['Stripe-Version'] = this.apiVersion;

    const response = await this.fetchImpl!(`${this.apiBase}${path}`, { method, headers, body });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const err = payload?.error ?? {};
      const code = err.code || err.type || `http_${response.status}`;
      throw new Error(
        `Stripe transfer request failed (${response.status} ${code}): ${err.message || 'no message'}`,
      );
    }
    return payload;
  }
}
