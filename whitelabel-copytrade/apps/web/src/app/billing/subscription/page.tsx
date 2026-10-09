'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { SubscriptionPage } from '@/features/billing/subscription-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><SubscriptionPage /></AppShell></AuthGuard>;
}
