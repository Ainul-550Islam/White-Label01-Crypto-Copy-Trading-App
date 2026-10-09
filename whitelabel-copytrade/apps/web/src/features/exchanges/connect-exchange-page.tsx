'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { exchangeApi, EXCHANGE_VENUES, PASSPHRASE_VENUES } from '@/api/exchange-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { ExchangeSecurityWarning } from './exchange-security-warning';
export function ConnectExchangePage(): JSX.Element {
  const [exchange, setExchange] = useState<string>('BINANCE');
  const [environment, setEnvironment] = useState<string>('LIVE');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [passphrase, setPassphrase] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const needsPassphrase = PASSPHRASE_VENUES.includes(exchange);
  const handleConnect = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await exchangeApi.connectAccount({ exchange, environment, apiKey, apiSecret, label, passphrase: needsPassphrase ? passphrase : undefined });
      setSuccess(`${res.label ?? res.exchange} (${res.maskedApiKey ?? 'key saved'}) connected with status ${res.status}`);
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
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
        <select value={exchange} onChange={(e) => setExchange(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Exchange">
          {EXCHANGE_VENUES.map((venue) => <option key={venue} value={venue}>{venue === 'OKX' ? 'OKX' : venue.charAt(0) + venue.slice(1).toLowerCase()}</option>)}
        </select>
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Environment">
          <option value="LIVE">Live account</option>
          <option value="TESTNET">Testnet</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" maxLength={80} className="w-full rounded border px-3 py-2 text-sm" />
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" autoComplete="off" spellCheck={false} className="w-full rounded border px-3 py-2 text-sm font-mono" />
        <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API Secret" type="password" autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm font-mono" />
        {needsPassphrase && <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="API Passphrase" type="password" autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm font-mono" />}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}
        <button onClick={handleConnect} disabled={loading || apiKey.trim().length < 8 || apiSecret.trim().length < 8 || (needsPassphrase && !passphrase)} className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Connecting...' : 'Connect'}</button>
      </div>
    </PageContainer>
  );
}
