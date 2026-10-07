// # Responsibility: keeps applicant-side resubmission eligibility aligned with the API state machine.

import type { LeadTraderApplicationStatus } from '@/api/trading-api';

export function canSubmitLeadTraderApplication(
  latestStatus: LeadTraderApplicationStatus | null | undefined,
): boolean {
  return latestStatus === null || latestStatus === undefined || latestStatus === 'REJECTED';
}
