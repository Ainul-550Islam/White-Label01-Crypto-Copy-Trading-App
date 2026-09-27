/**
 * Production Coinbase Adapter
 * Only for capabilities actually supported by repository's exchange interface.
 * No fabricated futures/derivatives support.
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

export interface CoinbaseContext {
  apiKey: string;
  apiSecret: string;
  isSandbox: boolean;
  tenantId: string;
  accountId: string;
  correlationId: string;
}

@Injectable()
export class CoinbaseProductionAdapter {
  private readonly logger = new Logger(CoinbaseProductionAdapter.name);
  readonly provider = ProviderName.COINBASE;
  readonly domain = ProviderDomain.EXCHANGE;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.BALANCE_READ,
    ProviderCapability.ORDER_READ,
    ProviderCapability.SYMBOL_READ,
    ProviderCapability.ACCOUNT_HEALTH,
  ];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
  ) {}

  supportsCapability(capability: ProviderCapability): boolean {
    return this.capabilities.includes(capability);
  }

  private getBaseUrl(isSandbox: boolean): string {
    if (isSandbox) return 'https://api-public.sandbox.exchange.coinbase.com';
    return this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://api.exchange.coinbase.com';
  }

  async getBalances(context: CoinbaseContext): Promise<ProviderResult<Array<{ asset: string; free: string; locked: string; total: string }>>> {
    const start = Date.now();
    const baseUrl = this.getBaseUrl(context.isSandbox);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const requestPath = '/accounts';
    const body = '';
    const message = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', Buffer.from(context.apiSecret, 'base64')).update(message).digest('base64');

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'GET',
        url: `${baseUrl}${requestPath}`,
        headers: {
          'CB-ACCESS-KEY': context.apiKey,
          'CB-ACCESS-SIGN': signature,
          'CB-ACCESS-TIMESTAMP': timestamp,
          'CB-ACCESS-PASSPHRASE': process.env['COINBASE_PASSPHRASE'] || '',
          'Content-Type': 'application/json',
        },
        correlationId: context.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId: context.tenantId,
        isIdempotent: true,
      });

      const accounts = Array.isArray(response.data) ? response.data : [];
      const balances = accounts.map((a: any) => ({
        asset: a.currency,
        free: a.available || '0',
        locked: a.hold || '0',
        total: a.balance || '0',
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
    context: CoinbaseContext,
    order: { symbol: string; side: string; type: string; quantity: string; price?: string; clientOrderId: string; isSimulated: boolean },
  ): Promise<ProviderResult<NormalizedExchangeOrderResult>> {
    if (!this.supportsCapability(ProviderCapability.ORDER_CREATE)) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.CAPABILITY_NOT_SUPPORTED,
          message: `Capability ${ProviderCapability.ORDER_CREATE} not supported by ${this.provider}, only ${this.capabilities.join(', ')} supported`,
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId: context.correlationId,
          safeEvidence: { capability: ProviderCapability.ORDER_CREATE, supported: this.capabilities },
        },
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: 0,
      };
    }

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
        venue: 'COINBASE',
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

    return {
      success: false,
      provider: this.provider,
      domain: this.domain,
      error: {
        code: ProviderErrorCode.CAPABILITY_NOT_SUPPORTED,
        message: 'Coinbase spot trading via this adapter requires explicit enablement, futures/derivatives not supported',
        provider: this.provider,
        domain: this.domain,
        isRetryable: false,
        retryClassification: RetryClassification.NO_RETRY,
        correlationId: context.correlationId,
        safeEvidence: { provider: this.provider, requested: 'ORDER_CREATE' },
      },
      correlationId: context.correlationId,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  }
}
