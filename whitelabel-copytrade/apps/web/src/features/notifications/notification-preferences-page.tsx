'use client';
import { useQuery } from '@tanstack/react-query';
import { notificationApi } from '@/api/notification-api';
import { PageContainer } from '@/layout/page-container';
import { LoadingState } from '@/components/loading-state';
import { useState } from 'react';
export function NotificationPreferencesPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => notificationApi.getPreferences() });
  const [saving, setSaving] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  return (
    <PageContainer title="Notification Preferences" description="Customer notification preferences">
      <div className="space-y-3">
        {(data ?? []).map((pref) => (
          <div key={pref.channel} className="rounded border bg-card p-3">
            <h4 className="font-medium">{pref.channel}</h4>
            <p className="text-xs">Enabled: {pref.enabled ? 'Yes' : 'No'}</p>
          </div>
        ))}
        <button onClick={async () => { setSaving(true); if (data) await notificationApi.updatePreferences({ preferences: data }); setSaving(false); refetch(); }} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving}>{saving ? 'Saving...' : 'Save Preferences'}</button>
      </div>
    </PageContainer>
  );
}
