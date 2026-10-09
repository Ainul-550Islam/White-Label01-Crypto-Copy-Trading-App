import type { JSX } from 'react';
import type { ReactNode } from 'react';

import { BillingScope } from '@/modules/billing/billing-scope';

/** Round 7: mounts the plan catalogue inside the billing style scope. */
export default function PlansLayout({ children }: { children: ReactNode }): JSX.Element {
  return <BillingScope>{children}</BillingScope>;
}
