// # Integrates deposit address provisioning and deposit status transitions
import { FundingRequestService } from '../client-lifecycle/funding-request.service';
import {
  FundingRequestState,
  FUNDING_VALID_TRANSITIONS,
  isValidDecimal,
  isPositiveDecimal,
  deterministicIdempotencyKey,
} from '../client-lifecycle/client-lifecycle.types';

export {
  FundingRequestService,
  FundingRequestState,
  FUNDING_VALID_TRANSITIONS,
  isValidDecimal,
  isPositiveDecimal,
  deterministicIdempotencyKey,
};

export interface DepositConfirmationEvaluation {
  confirmed: boolean;
  confirmationsObserved: number;
  confirmationsRequired: number;
  targetState: 'PENDING_CONFIRMATIONS' | 'CONFIRMED';
}

export function evaluateDepositConfirmationThreshold(params: {
  confirmationsObserved: number;
  confirmationsRequired: number;
}): DepositConfirmationEvaluation {
  const observed = Math.max(0, Math.floor(params.confirmationsObserved));
  const required = Math.max(1, Math.floor(params.confirmationsRequired));
  const confirmed = observed >= required;
  return {
    confirmed,
    confirmationsObserved: observed,
    confirmationsRequired: required,
    targetState: confirmed ? 'CONFIRMED' : 'PENDING_CONFIRMATIONS',
  };
}

export default FundingRequestService;
