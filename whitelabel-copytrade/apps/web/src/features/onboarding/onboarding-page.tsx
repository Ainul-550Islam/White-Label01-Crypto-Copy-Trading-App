'use client';
import { PageContainer } from '@/layout/page-container';
import { OnboardingProgress } from './onboarding-progress';
import { OnboardingSteps } from './onboarding-steps';
import { OnboardingBlockers } from './onboarding-blockers';
export function OnboardingPage(): JSX.Element {
  return (
    <PageContainer title="Onboarding" description="Complete your account setup from authoritative workflow">
      <OnboardingProgress />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><OnboardingSteps /></div>
        <div><OnboardingBlockers /></div>
      </div>
    </PageContainer>
  );
}
