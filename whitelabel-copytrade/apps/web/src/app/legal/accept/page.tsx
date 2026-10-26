// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Serves the authenticated read-then-accept workflow for current legal policies.
import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import PolicyAcceptancePage from '@/features/legal/policy-acceptance-page';

export default function AcceptPoliciesRoute(): JSX.Element {
  return <AuthGuard><AppShell><PolicyAcceptancePage /></AppShell></AuthGuard>;
}
