'use client';
import { useQuery } from '@tanstack/react-query';
import { notificationApi, NotificationPreference, NOTIFICATION_CATEGORIES } from '@/api/notification-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { useEffect, useState } from 'react';
export function NotificationPreferencesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => notificationApi.getPreferences() });
  const [draft, setDraft] = useState<NotificationPreference[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  useEffect(() => { if (data) setDraft(data); }, [data]);
  if (isLoading) return <LoadingState />;
  if (error) return <PageContainer title="Notification Preferences"><ErrorState error={error} onRetry={() => refetch()} /></PageContainer>;
  const toggle = (channel: string, category: string) => setDraft((current) => current.map((pref) => {
    if (pref.channel !== channel) return pref;
    const categories = { ...pref.categories, [category]: !pref.categories[category] };
    return { ...pref, categories, enabled: Object.values(categories).some(Boolean) };
  }));
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const saved = await notificationApi.updatePreferences({ preferences: draft });
      setDraft(saved);
      setMessage('Preferences saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.getUserMessage() : 'Preferences could not be saved.');
    } finally {
      setSaving(false);
      refetch();
    }
  };
  return (
    <PageContainer title="Notification Preferences" description="Customer notification preferences">
      <div className="space-y-3">
        <p className="text-xs text-muted">Security alerts (new device, password or two-factor changes) are always delivered in-app and by email.</p>
        <div className="overflow-x-auto rounded border bg-card p-3">
          <table className="w-full text-sm">
            <thead><tr><th className="text-left font-medium">Category</th>{draft.map((pref) => <th key={pref.channel} className="px-2 text-center font-medium">{pref.channel.replace('_', '-')}</th>)}</tr></thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category} className="border-t">
                  <td className="py-2 capitalize">{category}</td>
                  {draft.map((pref) => (
                    <td key={pref.channel} className="text-center"><input type="checkbox" aria-label={`${category} via ${pref.channel}`} checked={pref.categories[category] ?? true} onChange={() => toggle(pref.channel, category)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {message && <p className="text-xs text-muted">{message}</p>}
        <button onClick={save} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving || draft.length === 0}>{saving ? 'Saving...' : 'Save Preferences'}</button>
      </div>
    </PageContainer>
  );
}
