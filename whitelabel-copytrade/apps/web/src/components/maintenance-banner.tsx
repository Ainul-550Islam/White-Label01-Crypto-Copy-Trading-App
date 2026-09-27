'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/api/api-client';

interface MaintenanceInfo {
  active: boolean;
  message: string;
  scope: string;
  level?: string;
  scheduledAt?: string;
  endsAt?: string;
}

export function MaintenanceBanner(): JSX.Element | null {
  const [maintenance, setMaintenance] = useState<MaintenanceInfo | null>(null);

  useEffect(() => {
    const fetchMaintenance = async () => {
      try {
        const data = await apiClient.get<MaintenanceInfo>('/operations/maintenance/current');
        if (data.active) {
          setMaintenance(data);
        }
      } catch {
        // Ignore errors, maintenance banner is optional
      }
    };

    fetchMaintenance();
    const interval = setInterval(fetchMaintenance, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!maintenance?.active) return null;

  const level = maintenance.level ?? 'NORMAL';
  const bgColor =
    level === 'DISABLED' ? 'bg-red-600' : level === 'PAUSED' ? 'bg-orange-600' : level === 'READ_ONLY' ? 'bg-yellow-600' : 'bg-blue-600';

  return (
    <div className={`${bgColor} px-4 py-2 text-center text-sm text-white`} role="alert">
      <span className="font-medium">Maintenance:</span> {maintenance.message}
      {maintenance.endsAt && <span className="ml-2 text-xs opacity-90">Until {new Date(maintenance.endsAt).toLocaleString()}</span>}
    </div>
  );
}

export function DegradationBanner({ level, message }: { level: string; message: string }): JSX.Element | null {
  if (level === 'NORMAL') return null;

  const bg =
    level === 'DISABLED' ? 'bg-red-100 border-red-200 text-red-800' : level === 'PAUSED' ? 'bg-orange-100 border-orange-200 text-orange-800' : 'bg-yellow-100 border-yellow-200 text-yellow-800';

  return (
    <div className={`rounded border p-3 text-sm ${bg}`} role="alert">
      <strong>{level}:</strong> {message}
    </div>
  );
}
