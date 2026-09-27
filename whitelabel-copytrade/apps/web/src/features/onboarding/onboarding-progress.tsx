'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { LoadingState } from '@/components/loading-state';
export function OnboardingProgress(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', 'progress'],
    queryFn: () => apiClient.get<{ state: string; progressPct: number; currentStep: string }>('/client-lifecycle/onboarding/current'),
  });
  if (isLoading) return <LoadingState />;
  if (!data) return <div className="text-sm text-muted">No onboarding data</div>;
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">State: {data.state}</span>
        <span className="text-xs">{data.progressPct}%</span>
      </div>
      <div className="mt-2 h-2 w-full rounded bg-gray-200">
        <div className="h-2 rounded bg-primary" style={{ width: `${data.progressPct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">Current: {data.currentStep}</p>
    </div>
  );
}
