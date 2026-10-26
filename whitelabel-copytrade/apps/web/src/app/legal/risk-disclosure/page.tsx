// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Makes the current risk disclosure consent surface available to copy-trading enable flows without editing their owned routes.
import type { JSX } from 'react';
import RiskDisclosureConsent from '@/features/compliance/risk-disclosure-consent';

export default function RiskDisclosureRoute(): JSX.Element {
  return <main id="main-content" className="mx-auto max-w-3xl p-6"><h1 className="mb-4 text-2xl font-bold">Risk disclosure</h1><RiskDisclosureConsent /></main>;
}
