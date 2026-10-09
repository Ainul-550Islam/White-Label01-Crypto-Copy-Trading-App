/**
 * Production OKX Adapter
 * Uses existing exchange-provider interface with explicit capability detection and safe authentication.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedExchangeOrderResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface OkxContext {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  isSandbox: boolean;
  tenantId: string;
  accountId: string;
  correlationId: string;
}

@Injectable()
export class OkxProductionAdapter {
  private readonly logger = new Logger(OkxProductionAdapter.name);
  readonly provider = ProviderName.OKX;
  readonly domain = ProviderDomain.EXCHANGE;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.BALANCE_READ,
    ProviderCapability.POSITION_READ,
    ProviderCapability.ORDER_CREATE,
    ProviderCapability.ORDER_CANCEL,
    ProviderCapability.ORDER_READ,
    ProviderCapability.FILL_READ,
    ProviderCapability.SYMBOL_READ,
    ProviderCapability.ACCOUNT_HEALTH,
  ];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  supportsCapability(capability: ProviderCapability): boolean {
    return this.capabilities.includes(capability);
  }

  private getBaseUrl(isSandbox: boolean): string {
    if (isSandbox) return 'https://www.okx.com';
    return this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://www.okx.com';
  }

  private signRequest(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
    const prehash = timestamp + method + requestPath + body;
    return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
  }

  /**
   * OKX addresses instruments as `BASE-QUOTE`, with a derivative carrying a third segment:
   * `BTC-USDT-SWAP` for a perpetual, `BTC-USDT-260327` for a dated future. Internal symbols reach
   * this adapter as `BTC-USDT`, `BTC/USDT` or `BTC:USDT`, so the separators are canonicalised and
   * the shape is validated. A symbol that does not resolve to two or three alphanumeric segments
   * is refused rather than sent: previous revisions shipped a `replace('-', '-')` here, which
   * looked like normalisation and did nothing.
   */
  private toOkxInstrumentId(symbol: string): string | null {
    const canonical = symbol.trim().toUpperCase().replace(/[/_:]/g, '-');
    // Empty segments are refused rather than collapsed: `BTC--USDT` is not a venue instrument, and
    // silently repairing it would hide the upstream bug that produced it.
    const parts = canonical.split('-');
    if (parts.length < 2 || parts.length > 3) return null;
    if (parts.some((part) => !/^[A-Z0-9]+$/.test(part))) return null;
    return parts.join('-');
  }

  /**
   * `cash` is the spot account mode and the only correct value for a spot pair. A derivative must
   * run in `cross` or `isolated`, and defaulting one to `cash` would submit a leveraged order under
   * a mode the operator never chose - so a derivative requires an explicit `marginMode` and the
   * request is refused without one. Throws, so the caller's catch reports it like any other
   * refusal.
   */
  private resolveTdMode(instrumentId: string, marginMode?: string): string {
    const isDerivative = instrumentId.split('-').length > 2;

    if (marginMode !== undefined) {
      const normalised = marginMode.trim().toLowerCase();
      if (normalised !== 'cash' && normalised !== 'cross' && normalised !== 'isolated') {
        throw new Error(`Unsupported OKX tdMode ${marginMode} for ${instrumentId}`);
      }
      if (normalised === 'cash' && isDerivative) {
        throw new Error(`OKX derivative ${instrumentId} cannot trade in cash mode`);
      }
      return normalised;
    }

    if (isDerivative) {
      throw new Error(`OKX derivative ${instrumentId} requires an explicit margin mode`);
    }
    return 'cash';
  }

  async getBalances(context: OkxContext): Promise<ProviderResult<Array<{ asset: string; free: string; locked: string; total: string }>>> {
    const start = Date.now();
    const baseUrl = this.getBaseUrl(context.isSandbox);
    const requestPath = '/api/v5/account/balance';
    const timestamp = new Date().toISOString();
    const body = '';
    const signature = this.signRequest(timestamp, 'GET', requestPath, body, context.apiSecret);

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'GET',
        url: `${baseUrl}${requestPath}`,
        headers: {
          'OK-ACCESS-KEY': context.apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': timestamp,
          'OK-ACCESS-PASSPHRASE': context.passphrase,
          'Content-Type': 'application/json',
        },
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId: context.tenantId,
        isIdempotent: true,
      });

      const details = response.data?.data?.[0]?.details || [];
      const balances = details.map((d: any) => ({
        asset: d.ccy,
        free: d.availBal || '0',
        locked: d.frozenBal || '0',
        total: d.cashBal || '0',
      }));

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: balances,
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
      };
    } catch (error) {
      const err = (error as any).code ? error : this.requestService.normalizeError(error as Error, this.provider, this.domain, context.correlationId);
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err as any,
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }

  async createOrder(
    context: OkxContext,
    order: { symbol: string; side: string; type: string; quantity: string; price?: string; clientOrderId: string; isSimulated: boolean; marginMode?: string },
  ): Promise<ProviderResult<NormalizedExchangeOrderResult>> {
    const start = Date.now();

    if (order.isSimulated) {
      const simulated: NormalizedExchangeOrderResult = {
        providerOrderId: null,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        exchangeSymbol: this.toOkxInstrumentId(order.symbol) ?? order.symbol.trim().toUpperCase(),
        side: order.side,
        orderType: order.type,
        requestedQuantity: order.quantity,
        executedQuantity: '0',
        averagePrice: null,
        status: 'NEW',
        fee: null,
        feeAsset: null,
        timestamp: new Date().toISOString(),
        venue: 'OKX',
        isSimulated: true,
        safeRawStatus: 'NEW',
      };
      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: simulated,
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = this.getBaseUrl(context.isSandbox);
    const requestPath = '/api/v5/trade/order';
    const timestamp = new Date().toISOString();

    try {
      // Resolved inside the try so that a request this adapter refuses to send is reported
      // through the same normalised error path as a venue rejection.
      const instrumentId = this.toOkxInstrumentId(order.symbol);
      if (instrumentId === null) {
        throw new Error(`OKX instrument id cannot be derived from symbol ${order.symbol}`);
      }

      const bodyObj = {
        instId: instrumentId,
        tdMode: this.resolveTdMode(instrumentId, order.marginMode),
        side: order.side.toLowerCase(),
        ordType: order.type.toLowerCase(),
        sz: order.quantity,
        px: order.price,
        clOrdId: order.clientOrderId,
      };
      const body = JSON.stringify(bodyObj);
      const signature = this.signRequest(timestamp, 'POST', requestPath, body, context.apiSecret);

      const response = await this.requestService.request<any>({
        method: 'POST',
        url: `${baseUrl}${requestPath}`,
        headers: {
          'OK-ACCESS-KEY': context.apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': timestamp,
          'OK-ACCESS-PASSPHRASE': context.passphrase,
          'Content-Type': 'application/json',
        },
        body,
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.CREATE,
        tenantId: context.tenantId,
        // The body carries clOrdId, which OKX deduplicates on, so a retry of this request cannot
        // place a second order. Reporting it as non-idempotent told the retry layer to treat an
        // order it could safely repeat as one it must not - the opposite of the failure mode that
        // matters, and inconsistent with the Binance adapter, which declares the same guarantee.
        isIdempotent: true,
      });

      const data = response.data?.data?.[0] || {};

      const normalized: NormalizedExchangeOrderResult = {
        providerOrderId: data.ordId || null,
        clientOrderId: data.clOrdId || order.clientOrderId,
        symbol: order.symbol,
        exchangeSymbol: order.symbol,
        side: order.side,
        orderType: order.type,
        requestedQuantity: order.quantity,
        executedQuantity: '0',
        averagePrice: null,
        status: data.sCode === '0' ? 'NEW' : 'REJECTED',
        fee: null,
        feeAsset: null,
        timestamp: new Date().toISOString(),
        venue: 'OKX',
        isSimulated: false,
        safeRawStatus: data.sCode || null,
      };

      return {
        success: data.sCode === '0',
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: context.correlationId,
        providerReference: normalized.providerOrderId,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: data.sCode,
      };
    } catch (error) {
      const err = (error as any).code ? error : this.requestService.normalizeError(error as Error, this.provider, this.domain, context.correlationId);
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err as any,
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }
}
