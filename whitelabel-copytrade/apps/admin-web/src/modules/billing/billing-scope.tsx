import type { JSX } from 'react';
import type { ReactNode } from 'react';

import '@/styles/billing-utilities.css';

/**
 * Wraps the billing screens (portal, plan catalogue, SaaS tenant admin) in the
 * `.wlct-billing` scope. Those components were written with utility class
 * names; billing-utilities.css defines exactly those classes, mapped onto the
 * console's dark theme tokens and scoped to this wrapper so nothing leaks
 * into the rest of the console.
 */
export function BillingScope({ children }: { children: ReactNode }): JSX.Element {
  return <div className="wlct-billing">{children}</div>;
}
