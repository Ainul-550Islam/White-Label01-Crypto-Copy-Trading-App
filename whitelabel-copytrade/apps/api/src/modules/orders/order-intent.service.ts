// # Enforces pre-trade risk and venue filter checks prior to OMS persistence
import { OrderIntentService } from '../oms/order-intent.service';
import {
  RiskService,
  type PreTradeOrderRuleInput,
  type PreTradeOrderRuleResult,
} from '../risk/risk.service';

export {
  OrderIntentService,
  RiskService,
  type PreTradeOrderRuleInput,
  type PreTradeOrderRuleResult,
};

export interface PreTradeOrderIntentGateSummary {
  allowed: boolean;
  computedNotional: string;
  requiredMargin: string;
  rejectionReasons: string[];
}

export function validateOrderIntentPreTrade(
  input: PreTradeOrderRuleInput,
): PreTradeOrderIntentGateSummary {
  const riskService = new RiskService();
  const res = riskService.evaluatePreTradeOrderRules(input);
  return {
    allowed: res.allowed,
    computedNotional: res.computedNotional,
    requiredMargin: res.requiredMargin,
    rejectionReasons: res.reasons,
  };
}

export default OrderIntentService;
