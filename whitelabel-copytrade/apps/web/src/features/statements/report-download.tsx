'use client';
import { useState } from 'react';
import { reportingApi } from '@/api/reporting-api';
export function ReportDownload({ statementId }: { statementId: string }): JSX.Element {
  const [loading, setLoading] = useState<boolean>(false);
  const [url, setUrl] = useState<string>('');
  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await reportingApi.downloadStatement(statementId);
      setUrl(res.url);
      window.open(res.url, '_blank');
    } catch {
      // error handled
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h4 className="font-medium">Export</h4>
      <p className="text-xs text-muted">Secure report export from backend</p>
      <button onClick={handleDownload} disabled={loading} className="mt-2 rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Preparing...' : 'Download PDF'}</button>
      {url && <p className="mt-2 text-xs break-all">Download URL: {url}</p>}
    </div>
  );
}
