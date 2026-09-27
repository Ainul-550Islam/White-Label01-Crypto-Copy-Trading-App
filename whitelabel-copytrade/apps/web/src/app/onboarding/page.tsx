'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';
export default function Page(): JSX.Element {
  return <AuthGuard><OnboardingPage /></AuthGuard>;
}
