'use client';

import { ReactNode } from 'react';
import { App } from './app';

/**
 * Query/state/theme/auth/tenant/notification providers using existing repository conventions.
 * Delegates to root App composition.
 */

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return <App>{children}</App>;
}
