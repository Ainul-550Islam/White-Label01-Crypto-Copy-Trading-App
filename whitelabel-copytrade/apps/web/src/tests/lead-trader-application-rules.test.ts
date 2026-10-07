// # Responsibility: protects applicant-side eligibility for initial submission and rejection-only versioned resubmission.

import { canSubmitLeadTraderApplication } from '../features/trading/lead-trader-application-rules';

describe('lead-trader application submission rules', () => {
  it('allows an initial application before any version exists', () => {
    expect(canSubmitLeadTraderApplication(undefined)).toBe(true);
    expect(canSubmitLeadTraderApplication(null)).toBe(true);
  });

  it.each(['SUBMITTED', 'IN_REVIEW', 'APPROVED'] as const)(
    'prevents a new submission while latest status is %s',
    (status) => expect(canSubmitLeadTraderApplication(status)).toBe(false),
  );

  it('allows a new version only after rejection', () => {
    expect(canSubmitLeadTraderApplication('REJECTED')).toBe(true);
  });
});
