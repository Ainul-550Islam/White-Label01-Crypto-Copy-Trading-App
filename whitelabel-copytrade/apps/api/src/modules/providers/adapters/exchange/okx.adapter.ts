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
    order: { symbol: string; side: string; type: string; quantity: string; price?: string; clientOrderId: string; isSimulated: boolean },
  ): Promise<ProviderResult<NormalizedExchangeOrderResult>> {
    const start = Date.now();

    if (order.isSimulated) {
      const simulated: NormalizedExchangeOrderResult = {
        providerOrderId: null,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        exchangeSymbol: order.symbol.replace('-', ''),
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
    const bodyObj = {
      instId: order.symbol.replace('-', '-'),
      tdMode: 'cash',
      side: order.side.toLowerCase(),
      ordType: order.type.toLowerCase(),
      sz: order.quantity,
      px: order.price,
      clOrdId: order.clientOrderId,
    };
    const body = JSON.stringify(bodyObj);
    const signature = this.signRequest(timestamp, 'POST', requestPath, body, context.apiSecret);

    try {
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
        isIdempotent: false,
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
