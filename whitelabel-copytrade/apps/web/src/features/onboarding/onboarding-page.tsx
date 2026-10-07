'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { clientLifecycleApi } from '@/api/client-lifecycle-api';
import { ApiError } from '@/api/api-errors';
import { useAuth } from '@/auth/auth.store';
import { PageContainer } from '@/layout/page-container';
import { OnboardingProgress } from './onboarding-progress';
import { OnboardingSteps } from './onboarding-steps';
import { OnboardingBlockers } from './onboarding-blockers';
import { useOnboarding } from './use-onboarding';

export function OnboardingPage(): JSX.Element {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useOnboarding();

  const [legalName, setLegalName] = useState<string>(session?.user.displayName ?? '');
  const [countryCode, setCountryCode] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string>('');

  const handleStartOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user.id) return;
    setSubmitting(true);
    setActionError('');
    setActionSuccess('');
    try {
      let profileId = await clientLifecycleApi.getOwnClientProfileId();
      if (!profileId) {
        profileId = await clientLifecycleApi.createOwnClientProfile({
          externalIdentityRef: session.user.id,
          displayName: session.user.displayName ?? legalName.trim() ?? session.user.email,
          ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
          email: session.user.email,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(countryCode.trim() ? { countryCode: countryCode.trim().toUpperCase() } : {}),
        });
      }
      if (!profileId) {
        setActionError('Client profile could not be created.');
        return;
      }
      await clientLifecycleApi.initiateOnboarding(profileId);
      setActionSuccess('Onboarding workflow started.');
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.getUserMessage() : 'Could not initiate onboarding.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer
      title="Onboarding"
      description="Complete your account setup from authoritative workflow"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/dashboard" className="rounded border px-3 py-1.5 hover:bg-accent">
            Dashboard
          </Link>
          <Link href="/exchanges/connect" className="rounded border px-3 py-1.5 hover:bg-accent">
            Connect Exchange
          </Link>
          <Link href="/security/mfa" className="rounded border px-3 py-1.5 hover:bg-accent">
            Configure MFA
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <OnboardingProgress />

        {!isLoading && !data && session?.user.id && (
          <form onSubmit={handleStartOnboarding} className="rounded border bg-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Start Client Onboarding</h2>
              <p className="mt-1 text-xs text-muted">
                No onboarding record is open for your account yet. Submit your legal details below to create your
                client profile and start the organisation&apos;s onboarding workflow.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium" htmlFor="onboarding-legal-name">
                  Legal Full Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="onboarding-legal-name"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="Full legal name"
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="onboarding-country">
                  Country Code (ISO-2)
                </label>
                <input
                  id="onboarding-country"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                  maxLength={2}
                  placeholder="BD"
                  className="mt-1 w-full rounded border px-3 py-1.5 font-mono text-sm uppercase"
                />
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="onboarding-phone">
                  Phone (E.164 optional)
                </label>
                <input
                  id="onboarding-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+8801712345678"
                  className="mt-1 w-full rounded border px-3 py-1.5 font-mono text-sm"
                />
              </div>
            </div>

            {actionError && (
              <div className="rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>
            )}
            {actionSuccess && (
              <div className="rounded bg-green-50 p-2 text-xs text-green-800">{actionSuccess}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !legalName.trim()}
              className="rounded bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Starting Onboarding...' : 'Create Client Profile & Start Onboarding'}
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OnboardingSteps />
          </div>
          <div>
            <OnboardingBlockers />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
