'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { StatusBadge } from '@/components/status-badge';
export function OnboardingBlockers(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['onboarding', 'blockers'],
    queryFn: () => apiClient.get<{ blockers: Array<{ type: string; reason: string; severity: string }> }>('/client-lifecycle/onboarding/blockers'),
  });
  const blockers = data?.blockers ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Blockers</h3>
      {blockers.length===0 ? <p className="mt-2 text-xs text-muted">No blocking issues</p> :
        <ul className="mt-3 space-y-2">
          {blockers.map((b,i) => (
            <li key={i} className="rounded border p-2 text-xs">
              <StatusBadge status={b.type} /> <span className="ml-1">{b.reason}</span>
            </li>
          ))}
        </ul>
      }
    </div>
  );
}
