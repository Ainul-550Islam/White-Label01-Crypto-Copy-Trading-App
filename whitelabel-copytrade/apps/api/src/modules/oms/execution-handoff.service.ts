// # Bridges OMS order intents to execution service or paper simulator based on mode
import { OrderRoutingService } from './order-routing.service';
import { ExecutionAckService } from './execution-ack.service';

export {
  OrderRoutingService,
  OrderRoutingService as ExecutionHandoffService,
  ExecutionAckService,
};

export type ExecutionDispatchTarget = 'PAPER_SIMULATOR' | 'SANDBOX_ADAPTER' | 'LIVE_ENGINE';

export function resolveExecutionDispatchTarget(params: {
  tradingMode: 'PAPER' | 'SANDBOX' | 'LIVE';
  liveTradingEnabled: boolean;
  dryRun: boolean;
}): ExecutionDispatchTarget {
  if (params.tradingMode === 'LIVE' && params.liveTradingEnabled && !params.dryRun) {
    return 'LIVE_ENGINE';
  }
  if (params.tradingMode === 'SANDBOX') {
    return 'SANDBOX_ADAPTER';
  }
  return 'PAPER_SIMULATOR';
}

export interface ExecutionCommandPayload {
  tenantId: string;
  orderId: string;
  clientOrderId: string;
  exchangeAccountId: string;
  venue: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  quantity: string;
  price?: string | null;
  commandType: 'SUBMIT_ORDER';
  idempotencyKey: string;
}

export function formatExecutionCommandPayload(input: {
  tenantId: string;
  orderId: string;
  clientOrderId: string;
  exchangeAccountId: string;
  venue: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  quantity: string;
  price?: string | null;
}): ExecutionCommandPayload {
  return {
    ...input,
    symbol: input.symbol.trim().toUpperCase().replace('-', '/'),
    commandType: 'SUBMIT_ORDER',
    idempotencyKey: `exec-cmd:${input.tenantId}:${input.orderId}:${input.clientOrderId}`,
  };
}

export default OrderRoutingService;
