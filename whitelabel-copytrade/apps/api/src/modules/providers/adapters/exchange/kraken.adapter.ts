/**
 * Production Kraken Adapter
 * Uses existing exchange-provider interface with explicit capability detection and provider-state normalization.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as qs from 'querystring';
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

export interface KrakenContext {
  apiKey: string;
  apiSecret: string;
  isSandbox: boolean;
  tenantId: string;
  accountId: string;
  correlationId: string;
}

@Injectable()
export class KrakenProductionAdapter {
  private readonly logger = new Logger(KrakenProductionAdapter.name);
  readonly provider = ProviderName.KRAKEN;
  readonly domain = ProviderDomain.EXCHANGE;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.BALANCE_READ,
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

  private getBaseUrl(): string {
    return this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://api.kraken.com';
  }

  private signRequest(path: string, params: Record<string, string>, secret: string): string {
    const nonce = params['nonce'] || Date.now().toString();
    const postData = qs.stringify(params);
    const hash = crypto.createHash('sha256').update(nonce + postData).digest();
    const hmac = crypto.createHmac('sha512', Buffer.from(secret, 'base64')).update(path + hash).digest('base64');
    return hmac;
  }

  async getBalances(context: KrakenContext): Promise<ProviderResult<Array<{ asset: string; free: string; locked: string; total: string }>>> {
    const start = Date.now();
    const baseUrl = this.getBaseUrl();
    const path = '/0/private/Balance';
    const nonce = Date.now().toString();
    const params: Record<string, string> = { nonce };
    const signature = this.signRequest(path, params, context.apiSecret);

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'POST',
        url: `${baseUrl}${path}`,
        headers: {
          'API-Key': context.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: qs.stringify(params),
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId: context.tenantId,
        isIdempotent: true,
      });

      const result = response.data?.result || {};
      const balances = Object.entries(result).map(([asset, amount]) => ({
        asset,
        free: amount as string,
        locked: '0',
        total: amount as string,
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
    context: KrakenContext,
    order: { symbol: string; side: string; type: string; quantity: string; price?: string; clientOrderId: string; isSimulated: boolean },
  ): Promise<ProviderResult<NormalizedExchangeOrderResult>> {
    const start = Date.now();

    if (order.isSimulated) {
      const simulated: NormalizedExchangeOrderResult = {
        providerOrderId: null,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        exchangeSymbol: order.symbol,
        side: order.side,
        orderType: order.type,
        requestedQuantity: order.quantity,
        executedQuantity: '0',
        averagePrice: null,
        status: 'NEW',
        fee: null,
        feeAsset: null,
        timestamp: new Date().toISOString(),
        venue: 'KRAKEN',
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

    const baseUrl = this.getBaseUrl();
    const path = '/0/private/AddOrder';
    const nonce = Date.now().toString();
    const params: Record<string, string> = {
      nonce,
      pair: order.symbol.replace('-', ''),
      type: order.side.toLowerCase(),
      ordertype: order.type.toLowerCase(),
      volume: order.quantity,
      userref: order.clientOrderId,
    };
    if (order.price) params['price'] = order.price;

    const signature = this.signRequest(path, params, context.apiSecret);

    try {
      const response = await this.requestService.request<any>({
        method: 'POST',
        url: `${baseUrl}${path}`,
        headers: {
          'API-Key': context.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: qs.stringify(params),
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.CREATE,
        tenantId: context.tenantId,
        isIdempotent: false,
      });

      const result = response.data?.result || {};
      const txid = result.txid?.[0] || null;

      const normalized: NormalizedExchangeOrderResult = {
        providerOrderId: txid,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        exchangeSymbol: order.symbol,
        side: order.side,
        orderType: order.type,
        requestedQuantity: order.quantity,
        executedQuantity: '0',
        averagePrice: null,
        status: txid ? 'NEW' : 'REJECTED',
        fee: null,
        feeAsset: null,
        timestamp: new Date().toISOString(),
        venue: 'KRAKEN',
        isSimulated: false,
        safeRawStatus: txid ? 'NEW' : 'REJECTED',
      };

      return {
        success: !!txid,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: context.correlationId,
        providerReference: txid,
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
}
