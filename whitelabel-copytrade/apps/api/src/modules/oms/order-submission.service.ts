// # Persists OMS Order record from validated intent and enqueues execution command
import { OrderRoutingService } from './order-routing.service';
import {
  submitOrderJobId,
  clientOrderIdFromJobId,
  buildSubmitSpecification,
  computeSubmitExposure,
  plainDecimal,
  type SymbolRuleSource,
  type SubmitSpecification,
  type PositionSource,
  type SubmitExposure,
} from './order-submission.payload';

export {
  OrderRoutingService as OrderSubmissionService,
  OrderRoutingService,
  submitOrderJobId,
  clientOrderIdFromJobId,
  buildSubmitSpecification,
  computeSubmitExposure,
  plainDecimal,
  type SymbolRuleSource,
  type SubmitSpecification,
  type PositionSource,
  type SubmitExposure,
};

export interface OrderSubmissionJobContext {
  tenantId: string;
  orderId: string;
  clientOrderId: string;
  exchangeAccountId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  quantity: string;
  price?: string | null;
}

export default OrderRoutingService;
