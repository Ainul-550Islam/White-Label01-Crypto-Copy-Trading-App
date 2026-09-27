'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function OnboardingSteps(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', 'steps'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; type: string; status: string; required: boolean }> }>('/client-lifecycle/onboarding/steps'),
  });
  if (isLoading) return <LoadingState />;
  const steps = data?.data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Steps</h3>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>{s.type.replace(/_/g, ' ')}</span>
            <StatusBadge status={s.status} />
          </li>
        ))}
        {steps.length===0 && <p className="text-xs text-muted">No steps available</p>}
      </ul>
    </div>
  );
}
