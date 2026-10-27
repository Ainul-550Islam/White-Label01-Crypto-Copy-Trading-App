'use client';
import type { JSX } from 'react';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@wlct/shared-types';
import { useAuth } from '@/auth/auth.store';
import { permissionsAllowAny } from '@/auth/permissions';
import { fundingApi, isPositiveAmount } from '@/api/funding-api';
import { withdrawalDestinationApi } from '@/api/security-api';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { PageContainer } from '@/layout/page-container';
import { InlineError } from '@/components/error-state';
import { StepUpAuthDialog } from '@/features/security/step-up-auth-dialog';
import { AccountSelect, accountAllows, useFundingAccounts } from './account-select';
import { WITHDRAWAL_DESTINATIONS_QUERY_KEY, WithdrawalDestinationManager } from './withdrawal-destination-manager';

export function WithdrawalPage(): JSX.Element {
  const { session } = useAuth();
  const canRequest = permissionsAllowAny(session?.user.permissions ?? [], [Permission.PAYOUT_MANAGE]);
  const queryClient = useQueryClient();
  const accounts = useFundingAccounts();
  const destinations = useQuery({ queryKey: WITHDRAWAL_DESTINATIONS_QUERY_KEY, queryFn: withdrawalDestinationApi.list, retry: false });
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [destinationId, setDestinationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const intent = useRef<{ signature: string; key: string } | null>(null);
  const destination = destinations.data?.find((row) => row.id === destinationId && row.status === 'ACTIVE');
  const valid = Boolean(canRequest && accounts.data?.some((account) => account.id === accountId && accountAllows(account, 'WITHDRAWAL')) && destination && isPositiveAmount(amount.trim()) && (amount.trim().split('.')[1]?.length ?? 0) <= 12 && /^[A-Z0-9]{2,10}$/.test(currency));
  async function submit(): Promise<void> {
    if (!destination || !valid || busy) return;
    const signature = JSON.stringify([accountId, amount.trim(), currency, destination.id]);
    if (!intent.current || intent.current.signature !== signature) intent.current = { signature, key: newIdempotencyKey('withdrawal') };
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = await fundingApi.createWithdrawalRequest({ accountId, amount: amount.trim(), currency,
        destinationAddress: destination.address, destinationType: destination.network, idempotencyKey: intent.current.key });
      setSuccess(`Withdrawal ${result.id.slice(0, 8)} is ${result.state.toLowerCase().replace(/_/g, ' ')}. Track its status; a request is not a transfer.`);
      setAmount(''); setDestinationId(''); intent.current = null;
      await queryClient.invalidateQueries({ queryKey: ['funding'] });
    } catch { setError('The withdrawal request could not be confirmed. Check your withdrawal history and account details before trying again.'); }
    finally { setBusy(false); }
  }
  return <PageContainer title="Withdraw" description="Request a withdrawal to an approved address">
    <div className="max-w-lg space-y-4 rounded border bg-card p-4">
      {accounts.isLoading ? <p role="status">Loading accounts…</p> : accounts.error ? <p role="alert">Accounts could not be loaded.</p> : <AccountSelect accounts={accounts.data ?? []} direction="WITHDRAWAL" value={accountId} onChange={setAccountId} />}
      {accounts.data && !accounts.data.some((a) => accountAllows(a, 'WITHDRAWAL')) && <p>No account currently permits withdrawals.</p>}
      <label className="block">Amount<input className="block w-full rounded border p-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="block">Currency<input className="block w-full rounded border p-2" value={currency} maxLength={10} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
      <label className="block">Approved withdrawal address<select className="block w-full rounded border p-2" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
        <option value="">Select an active address</option>{destinations.data?.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.label} · {row.network} · {row.address}</option>)}
      </select></label>
      {destinations.isLoading && <p role="status">Loading addresses…</p>}{destinations.error && <p role="alert">Addresses could not be loaded. No withdrawal can be requested.</p>}
      {!canRequest && <p role="status">Withdrawal requests require payout management permission. Contact your administrator if you need access.</p>}
      <p className="text-sm">An authenticator or recovery code is required. The server checks account ownership, clearance, an active address, and authoritative available balance. A request is not a transfer.</p>
      {error && <InlineError message={error} />}{success && <p role="status">{success}</p>}
      <button className="rounded bg-primary p-2 text-white disabled:opacity-50" disabled={!valid || busy} onClick={() => { setError(''); setStepUp(true); }}>Request withdrawal</button>
    </div>
    <StepUpAuthDialog open={stepUp} action="PAYOUT_CREATE" allowedMethods={['TOTP', 'RECOVERY_CODE']} onCancel={() => setStepUp(false)} onVerified={() => { setStepUp(false); void submit(); }} />
    <div className="mt-6"><WithdrawalDestinationManager /></div>
  </PageContainer>;
}
