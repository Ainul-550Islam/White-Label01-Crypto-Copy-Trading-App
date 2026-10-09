// # Responsibility: provides authenticated lead-trader application submission, status history, rejection feedback, and risk disclosure.
'use client';
import type { JSX } from 'react';

import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/api-errors';
import {
  tradingApi,
  type LeadTraderApplication,
  type SubmitLeadTraderApplicationInput,
} from '@/api/trading-api';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { PageContainer, Section } from '@/layout/page-container';
import { canSubmitLeadTraderApplication } from './lead-trader-application-rules';

const MARKET_OPTIONS: Array<{ value: SubmitLeadTraderApplicationInput['markets'][number]; label: string }> = [
  { value: 'SPOT', label: 'Spot markets' },
  { value: 'USDT_PERPETUAL', label: 'USDT perpetuals' },
  { value: 'COIN_PERPETUAL', label: 'Coin-margined perpetuals' },
];

function readableStatus(status: LeadTraderApplication['status']): string {
  switch (status) {
    case 'SUBMITTED': return 'Submitted';
    case 'IN_REVIEW': return 'In review';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
  }
}

export function LeadTraderApplicationPage(): JSX.Element {
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string | null>(null);
  const [yearsExperience, setYearsExperience] = useState('');
  const [markets, setMarkets] = useState<SubmitLeadTraderApplicationInput['markets']>([]);
  const [strategySummary, setStrategySummary] = useState('');
  const [evidenceReferences, setEvidenceReferences] = useState('');
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const applicationsQuery = useQuery({
    queryKey: ['lead-trader-applications', 'mine'],
    queryFn: () => tradingApi.listMyLeadTraderApplications(),
    retry: 1,
  });
  const applications = applicationsQuery.data ?? [];
  const latestApplication = applications[0];
  const canResubmit = canSubmitLeadTraderApplication(latestApplication?.status);

  const submitMutation = useMutation({
    mutationFn: () => {
      const parsedYears = Number(yearsExperience);
      const references = evidenceReferences
        .split(',')
        .map((reference) => reference.trim())
        .filter(Boolean);
      const payload: SubmitLeadTraderApplicationInput = {
        idempotencyKey: idempotencyKey.current ?? (idempotencyKey.current = newIdempotencyKey('lead-app')),
        yearsExperience: parsedYears,
        markets,
        strategySummary: strategySummary.trim(),
        evidenceReferences: references,
        riskAcknowledged,
      };
      return tradingApi.submitLeadTraderApplication(payload);
    },
    onSuccess: async (application) => {
      idempotencyKey.current = null;
      setSuccessMessage(`Application version ${application.version} was submitted for review.`);
      await queryClient.invalidateQueries({ queryKey: ['lead-trader-applications', 'mine'] });
    },
    onError: () => setSuccessMessage(null),
  });

  const toggleMarket = (value: SubmitLeadTraderApplicationInput['markets'][number]) => {
    setMarkets((current) => current.includes(value)
      ? current.filter((market) => market !== value)
      : [...current, value]);
  };

  const formReady = yearsExperience !== ''
    && Number.isInteger(Number(yearsExperience))
    && Number(yearsExperience) >= 0
    && Number(yearsExperience) <= 50
    && markets.length > 0
    && strategySummary.trim().length >= 50
    && strategySummary.trim().length <= 1000
    && evidenceReferences.split(',').map((reference) => reference.trim()).filter(Boolean).length <= 20
    && riskAcknowledged;
  const canSubmit = applicationsQuery.isSuccess && !applicationsQuery.isFetching && canResubmit && formReady && !submitMutation.isPending;

  return (
    <PageContainer
      title="Apply to become a lead trader"
      description="Submit your experience and strategy declaration for tenant review. Application details are not verified performance results."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
        <Section title="Application declaration" description="Provide truthful information. Do not include passwords, API keys, identity documents, or exchange credentials.">
          {applicationsQuery.isPending && <p role="status" className="text-sm text-muted">Loading your application history…</p>}
          {applicationsQuery.isError && (
            <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {applicationsQuery.error instanceof ApiError ? applicationsQuery.error.message : 'Your application history could not be loaded. Retry before submitting.'}
              <button type="button" className="ml-3 underline" onClick={() => void applicationsQuery.refetch()}>Retry</button>
            </div>
          )}
          {applicationsQuery.isSuccess && latestApplication && (
            <div className="mb-5 rounded border p-4" data-testid="latest-application-status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>Latest application · version {latestApplication.version}</strong>
                <span className="rounded-full border px-3 py-1 text-xs font-semibold" aria-label={`Status: ${readableStatus(latestApplication.status)}`}>
                  {readableStatus(latestApplication.status)}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">Submitted {new Date(latestApplication.submittedAt).toLocaleString()}</p>
              {latestApplication.status === 'REJECTED' && latestApplication.decisionReason && (
                <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">
                  <strong>Reviewer feedback</strong>
                  <p className="mb-0 mt-1">{latestApplication.decisionReason}</p>
                  <p className="mb-0 mt-2 text-xs">You may submit a new version that addresses this feedback.</p>
                </div>
              )}
              {latestApplication.status === 'APPROVED' && (
                <p className="mb-0 mt-3 text-sm">Your profile is approved. Further applications are disabled; trading access remains subject to separate platform, account, risk, and live-execution controls.</p>
              )}
              {(latestApplication.status === 'SUBMITTED' || latestApplication.status === 'IN_REVIEW') && (
                <p className="mb-0 mt-3 text-sm">A review is active. You cannot submit another application until a decision is recorded.</p>
              )}
            </div>
          )}

          {applicationsQuery.isSuccess && canResubmit ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setSuccessMessage(null);
                submitMutation.mutate();
              }}
            >
              <label className="grid gap-1 text-sm font-medium">
                Trading experience (years)
                <input
                  aria-label="Trading experience in years"
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  required
                  value={yearsExperience}
                  onChange={(event) => setYearsExperience(event.target.value)}
                  className="rounded border px-3 py-2 font-normal"
                />
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Markets you intend to lead</legend>
                {MARKET_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={markets.includes(option.value)} onChange={() => toggleMarket(option.value)} />
                    {option.label}
                  </label>
                ))}
              </fieldset>

              <label className="grid gap-1 text-sm font-medium">
                Strategy and risk-management summary
                <textarea
                  aria-label="Strategy and risk-management summary"
                  required
                  minLength={50}
                  maxLength={1000}
                  rows={6}
                  value={strategySummary}
                  onChange={(event) => setStrategySummary(event.target.value)}
                  className="rounded border px-3 py-2 font-normal"
                  placeholder="Describe your approach, intended markets, risk limits, and how you manage drawdowns. Do not make unsupported performance claims."
                />
                <span className="font-normal text-xs text-muted">{strategySummary.trim().length}/1000 characters · at least 50 required</span>
              </label>

              <label className="grid gap-1 text-sm font-medium">
                Evidence reference IDs (optional, comma-separated)
                <input
                  aria-label="Evidence reference IDs"
                  value={evidenceReferences}
                  onChange={(event) => setEvidenceReferences(event.target.value)}
                  maxLength={2600}
                  className="rounded border px-3 py-2 font-normal"
                  placeholder="For example: review-2026-01, statement-ref-42"
                />
                <span className="font-normal text-xs text-muted">Use identifiers already issued by the platform. Do not paste URLs, secrets, or documents; the references themselves do not prove performance.</span>
              </label>

              <label className="flex items-start gap-2 rounded border p-3 text-sm">
                <input
                  type="checkbox"
                  required
                  checked={riskAcknowledged}
                  onChange={(event) => setRiskAcknowledged(event.target.checked)}
                  className="mt-1"
                />
                <span>I understand that digital-asset trading and copy trading involve substantial risk, losses can exceed expectations, past results do not guarantee future results, and approval is not a promise of returns or live trading access.</span>
              </label>

              {submitMutation.isError && (
                <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  {submitMutation.error instanceof ApiError ? submitMutation.error.message : 'The application could not be submitted. Your request key will be reused if you retry.'}
                </p>
              )}
              {successMessage && <p role="status" className="text-sm text-green-700">{successMessage}</p>}
              <button type="submit" disabled={!canSubmit} className="w-fit rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {submitMutation.isPending ? 'Submitting…' : latestApplication?.status === 'REJECTED' ? 'Submit new application version' : 'Submit application'}
              </button>
            </form>
          ) : applicationsQuery.isSuccess ? (
            <p className="text-sm text-muted">No new application can be submitted in the current state.</p>
          ) : null}
        </Section>

        <Section title="Review and trading safeguards" description="Approval is a qualification decision, not an execution authorization.">
          <ul className="grid gap-3 pl-5 text-sm text-muted">
            <li>Applications are scoped to your authenticated tenant and trader profile.</li>
            <li>Only a tenant-authorized reviewer can claim and decide an application; decisions are audited.</li>
            <li>Rejected applications remain in history. A corrected submission creates a new version.</li>
            <li>Approval does not bypass subscription, exchange-account, market, risk, maintenance, kill-switch, credential, or live-trading gates.</li>
            <li>Evidence references are identifiers only. No performance, profitability, or compliance verification is inferred from the declaration.</li>
          </ul>
        </Section>
      </div>

      {applications.length > 1 && (
        <Section title="Application history" description="Each submitted version remains visible, including reviewer feedback.">
          <ol className="grid gap-3">
            {applications.map((application) => (
              <li key={application.id} className="rounded border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>Version {application.version} · {readableStatus(application.status)}</strong>
                  <time dateTime={application.submittedAt} className="text-xs text-muted">{new Date(application.submittedAt).toLocaleString()}</time>
                </div>
                {application.decisionReason && <p className="mb-0 mt-2 text-muted">{application.decisionReason}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </PageContainer>
  );
}
