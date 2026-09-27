/**
 * Production Bybit Adapter
 * Uses existing exchange-provider interface. Unsupported capabilities return explicit capability errors.
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

export interface BybitContext {
  apiKey: string;
  apiSecret: string;
  isSandbox: boolean;
  tenantId: string;
  accountId: string;
  correlationId: string;
}

@Injectable()
export class BybitProductionAdapter {
  private readonly logger = new Logger(BybitProductionAdapter.name);
  readonly provider = ProviderName.BYBIT;
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
    if (isSandbox) return 'https://api-testnet.bybit.com';
    return this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://api.bybit.com';
  }

  private signRequest(apiSecret: string, timestamp: string, apiKey: string, recvWindow: string, queryString: string): string {
    const paramStr = timestamp + apiKey + recvWindow + queryString;
    return crypto.createHmac('sha256', apiSecret).update(paramStr).digest('hex');
  }

  async getBalances(context: BybitContext): Promise<ProviderResult<Array<{ asset: string; free: string; locked: string; total: string }>>> {
    const start = Date.now();
    const baseUrl = this.getBaseUrl(context.isSandbox);
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const queryString = 'accountType=UNIFIED';

    const signature = this.signRequest(context.apiSecret, timestamp, context.apiKey, recvWindow, queryString);

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'GET',
        url: `${baseUrl}/v5/account/wallet-balance?${queryString}`,
        headers: {
          'X-BAPI-API-KEY': context.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId: context.tenantId,
        isIdempotent: true,
      });

      const coins = response.data?.result?.list?.[0]?.coin || [];
      const balances = coins.map((c: any) => ({
        asset: c.coin,
        free: c.walletBalance || c.availableToWithdraw || '0',
        locked: c.locked || '0',
        total: c.walletBalance || '0',
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
    context: BybitContext,
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
        venue: 'BYBIT',
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
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const body = JSON.stringify({
      category: 'spot',
      symbol: order.symbol.replace('-', ''),
      side: order.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: order.type.toUpperCase(),
      qty: order.quantity,
      price: order.price,
      orderLinkId: order.clientOrderId,
    });

    const signature = this.signRequest(context.apiSecret, timestamp, context.apiKey, recvWindow, body);

    try {
      const response = await this.requestService.request<any>({
        method: 'POST',
        url: `${baseUrl}/v5/order/create`,
        headers: {
          'X-BAPI-API-KEY': context.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
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

      const result = response.data?.result || {};

      const normalized: NormalizedExchangeOrderResult = {
        providerOrderId: result.orderId || null,
        clientOrderId: result.orderLinkId || order.clientOrderId,
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
        venue: 'BYBIT',
        isSimulated: false,
        safeRawStatus: 'NEW',
      };

      await this.observationService.recordExchangeObservation(
        this.provider,
        ProviderOperationType.CREATE,
        context.correlationId,
        order.clientOrderId,
        normalized.providerOrderId,
        normalized.status,
        { symbol: order.symbol, side: order.side },
        context.tenantId,
        context.accountId,
      );

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: context.correlationId,
        providerReference: normalized.providerOrderId,
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

  async unsupportedCapability(capability: ProviderCapability, correlationId: string): Promise<ProviderResult<null>> {
    return {
      success: false,
      provider: this.provider,
      domain: this.domain,
      error: {
        code: ProviderErrorCode.CAPABILITY_NOT_SUPPORTED,
        message: `Capability ${capability} not supported by ${this.provider}`,
        provider: this.provider,
        domain: this.domain,
        isRetryable: false,
        retryClassification: RetryClassification.NO_RETRY,
        correlationId,
        safeEvidence: { capability, provider: this.provider },
      },
      correlationId,
      timestamp: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}
