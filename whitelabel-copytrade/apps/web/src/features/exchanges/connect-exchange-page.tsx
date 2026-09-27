'use client';
import { useState } from 'react';
import { exchangeApi } from '@/api/exchange-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { ExchangeSecurityWarning } from './exchange-security-warning';
export function ConnectExchangePage(): JSX.Element {
  const [exchange, setExchange] = useState<string>('BINANCE');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await exchangeApi.connectAccount({ exchange, apiKey, apiSecret, label });
      setSuccess(`Account ${res.id} connected with status ${res.status}`);
      setApiKey('');
      setApiSecret('');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer title="Connect Exchange" description="Secure exchange connection using backend credential lifecycle">
      <ExchangeSecurityWarning />
      <div className="mt-4 max-w-md space-y-3 rounded border bg-card p-4">
        <select value={exchange} onChange={(e) => setExchange(e.target.value)} className="w-full rounded border px-3 py-2 text-sm">
          <option value="BINANCE">Binance</option>
          <option value="BYBIT">Bybit</option>
          <option value="OKX">OKX</option>
          <option value="KRAKEN">Kraken</option>
          <option value="PAPER">Paper</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-full rounded border px-3 py-2 text-sm" />
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" className="w-full rounded border px-3 py-2 text-sm font-mono" />
        <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API Secret" type="password" className="w-full rounded border px-3 py-2 text-sm font-mono" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}
        <button onClick={handleConnect} disabled={loading || !apiKey || !apiSecret} className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Connecting...' : 'Connect'}</button>
      </div>
    </PageContainer>
  );
}
