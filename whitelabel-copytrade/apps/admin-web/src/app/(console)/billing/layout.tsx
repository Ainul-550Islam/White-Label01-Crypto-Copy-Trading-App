import type { ReactNode } from 'react';

import { BillingScope } from '@/modules/billing/billing-scope';

/** Round 7: mounts the self-service billing portal inside the billing style scope. */
export default function BillingLayout({ children }: { children: ReactNode }): JSX.Element {
  return <BillingScope>{children}</BillingScope>;
}
