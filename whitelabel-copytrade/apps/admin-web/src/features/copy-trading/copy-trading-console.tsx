'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { copyRows, copyTradingAdminApi, DECIMAL_MONEY, type CopyBudgetView, type TraderProfile, type TraderStrategy } from '@/api/copy-trading-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Copy-trading operations: trader verification, the strategy lifecycle and the
 * featured listing.
 *
 * The lifecycle is a state machine the API owns - draft, published, paused,
 * archived - so the console offers only the transitions the service exposes and
 * never a free-form status field. Archiving is one-way: there is no un-archive
 * route, and the confirmation says so.
 *
 * The budget form accepts an exact decimal string because that is what
 * `UpsertCopyBudgetDto` validates (at most 16 whole and 12 fractional digits).
 * A value that does not match is refused locally, before it can reach the
 * ledger as a rounded number.
 */
export function CopyTradingConsole(): JSX.Element {
  const [version, setVersion] = useState(0);
  const [traderId, setTraderId] = useState('');
  const [strategyInput, setStrategyInput] = useState('');

  const myProfile = useResource(() => copyTradingAdminApi.getMyTraderProfile(), [version], { errorMessage: 'Your trader profile could not be loaded.' });
  const platformPolicy = useResource(() => copyTradingAdminApi.getPlatformPolicy(), [version], { errorMessage: 'The platform copy policy could not be loaded.' });
  const featured = useResource(() => copyTradingAdminApi.getFeaturedRankings(10), [version], { errorMessage: 'Featured rankings could not be loaded.' });
  const subscriptions = useResource(() => copyTradingAdminApi.listTraderSubscriptions(traderId.trim()), [traderId, version], {
    enabled: traderId.trim() !== '',
    errorMessage: 'Subscriptions could not be loaded.',
  });

  const [profileForm, setProfileForm] = useState({ displayName: '', bio: '', venues: '', symbols: '', isPublic: false });
  const [strategyForm, setStrategyForm] = useState({ traderId: '', name: '', description: '', symbols: '', venues: '' });
  const [budgetForm, setBudgetForm] = useState({ maxActiveExposure: '', perTraderCap: '', currency: 'USDT' });
  const [budgetResult, setBudgetResult] = useState<CopyBudgetView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function splitList(value: string): string[] {
    return value.split(',').map((part) => part.trim()).filter((part) => part !== '');
  }

  function fail(caught: unknown, fallback: string): void {
    setError(
      caught instanceof ApiError && caught.status === 403
        ? 'This action needs a copy-trading management permission, or administrator rights for verification.'
        : caught instanceof ApiError && caught.status === 404
          ? 'That trader or strategy is not visible to your organisation.'
          : fallback,
    );
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (profileForm.displayName.trim().length < 2) {
      setError('A display name of at least two characters is required.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await copyTradingAdminApi.createTraderProfile(
        {
          displayName: profileForm.displayName.trim(),
          ...(profileForm.bio.trim() ? { bio: profileForm.bio.trim() } : {}),
          ...(splitList(profileForm.venues).length > 0 ? { supportedVenues: splitList(profileForm.venues) } : {}),
          ...(splitList(profileForm.symbols).length > 0 ? { supportedSymbols: splitList(profileForm.symbols) } : {}),
          isPublic: profileForm.isPublic,
        },
        crypto.randomUUID(),
      );
      setMessage('Your trader profile was saved. Verification is a separate, administrator-only step.');
      setProfileForm({ displayName: '', bio: '', venues: '', symbols: '', isPublic: false });
      setVersion((current) => current + 1);
    } catch (caught) {
      fail(caught, 'The profile was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function createStrategy(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const symbols = splitList(strategyForm.symbols);
    const venues = splitList(strategyForm.venues);
    if (strategyForm.traderId.trim() === '') {
      setError('A strategy needs the trader id that will own it.');
      return;
    }
    if (strategyForm.name.trim().length < 3) {
      setError('A strategy name of at least three characters is required.');
      return;
    }
    if (symbols.length === 0 || venues.length === 0) {
      setError('List at least one supported symbol and one venue.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await copyTradingAdminApi.createStrategy(
        {
          traderId: strategyForm.traderId.trim(),
          name: strategyForm.name.trim(),
          supportedSymbols: symbols,
          supportedVenues: venues,
          ...(strategyForm.description.trim() ? { description: strategyForm.description.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setMessage('The strategy was created as a draft. Publishing it is a separate step.');
      setStrategyForm({ traderId: '', name: '', description: '', symbols: '', venues: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      fail(caught, 'The strategy was not created.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(strategy: TraderStrategy, action: 'publish' | 'pause' | 'resume' | 'archive'): Promise<void> {
    const id = strategy.strategyId ?? strategy.id ?? '';
    if (id === '') {
      setError('This row has no strategy id, so no transition can be applied.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const key = crypto.randomUUID();
      if (action === 'publish') await copyTradingAdminApi.publishStrategy(id, key);
      else if (action === 'pause') await copyTradingAdminApi.pauseStrategy(id, key);
      else if (action === 'resume') await copyTradingAdminApi.resumeStrategy(id, key);
      else await copyTradingAdminApi.archiveStrategy(id, key);

      setMessage(
        action === 'archive'
          ? 'The strategy is archived. Copying stops and there is no un-archive route.'
          : `The strategy is now ${action === 'publish' ? 'published' : action === 'pause' ? 'paused' : 'running'}.`,
      );
      setVersion((current) => current + 1);
    } catch (caught) {
      fail(caught, 'The transition was not applied. The strategy keeps its current state.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(trader: string): Promise<void> {
    if (trader.trim() === '') {
      setError('Enter the trader id to verify.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await copyTradingAdminApi.verifyTrader(trader.trim(), crypto.randomUUID());
      setMessage('The trader is verified. Their marketplace listing can now be public.');
      setVersion((current) => current + 1);
    } catch (caught) {
      fail(caught, 'The verification was not applied.');
    } finally {
      setBusy(false);
    }
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!DECIMAL_MONEY.test(budgetForm.maxActiveExposure.trim())) {
      setError('The cap must be an exact decimal string with no sign and no exponent, for example 10000.50.');
      return;
    }
    if (budgetForm.perTraderCap.trim() !== '' && !DECIMAL_MONEY.test(budgetForm.perTraderCap.trim())) {
      setError('The per-trader cap must be an exact decimal string too.');
      return;
    }
    if (!/^[A-Z0-9]{2,12}$/.test(budgetForm.currency.trim().toUpperCase())) {
      setError('Use an upper-case asset code such as USDT.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await copyTradingAdminApi.upsertBudget(
        {
          maxActiveExposure: budgetForm.maxActiveExposure.trim(),
          currency: budgetForm.currency.trim().toUpperCase(),
          ...(budgetForm.perTraderCap.trim() ? { perTraderCap: budgetForm.perTraderCap.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setBudgetResult(result);
      setMessage('Your copy budget was saved.');
    } catch (caught) {
      fail(caught, 'The budget was not saved. Your previous cap still applies.');
    } finally {
      setBusy(false);
    }
  }

  const featuredRows = copyRows(featured.data);
  const subscriptionRows = copyRows<Record<string, unknown>>(subscriptions.data);
  const strategies: TraderStrategy[] = Array.isArray(platformPolicy.data?.strategies)
    ? (platformPolicy.data.strategies as TraderStrategy[])
    : [];

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
      {error && <ErrorNotice title="Action not completed" message={error} />}

      <Card title="My trader profile" description="Your public marketplace profile. Verification is granted by an administrator and cannot be self-issued.">
        {myProfile.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading your profile…</p>}
        {myProfile.error && <ErrorNotice title="No trader profile yet" message="Create one below; the API answers 404 until a profile exists for your user." />}
        {myProfile.data && (
          <p style={{ marginTop: 0, fontSize: 13 }}>
            <strong>{myProfile.data.displayName}</strong> ·{' '}
            <Badge tone={toneForStatus(myProfile.data.verificationState ?? 'UNVERIFIED')}>{myProfile.data.verificationState ?? 'UNVERIFIED'}</Badge>{' '}
            {myProfile.data.isPublic ? 'public' : 'private'}
          </p>
        )}

        <form onSubmit={(event) => void saveProfile(event)} aria-label="Save your trader profile" style={{ display: 'grid', gap: theme.space(3), maxWidth: 640 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Display name
              <input required value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Supported venues (comma separated)
              <input value={profileForm.venues} onChange={(event) => setProfileForm((current) => ({ ...current, venues: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Supported symbols (comma separated)
              <input value={profileForm.symbols} onChange={(event) => setProfileForm((current) => ({ ...current, symbols: event.target.value }))} disabled={busy} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Bio
            <textarea rows={3} value={profileForm.bio} onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={profileForm.isPublic} onChange={(event) => setProfileForm((current) => ({ ...current, isPublic: event.target.checked }))} disabled={busy} />
            List my profile publicly
          </label>
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          </div>
        </form>
      </Card>

      <Card title="Verify a trader" description="Administrator-only. Verification is what allows a public listing; it is not a performance claim.">
        <form
          onSubmit={(event) => { event.preventDefault(); void verify(traderId); }}
          aria-label="Verify a trader"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 320 }}>
            Trader id
            <input value={traderId} onChange={(event) => setTraderId(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify trader'}</button>
        </form>

        {traderId.trim() !== '' && (
          <div style={{ marginTop: theme.space(4) }}>
            {subscriptions.error && <ErrorNotice title="Subscriptions unavailable" message={subscriptions.error} />}
            {subscriptions.data && (
              <DataTable
                rows={subscriptionRows}
                rowKey={(row, index) => String(row.id ?? index)}
                emptyTitle="No subscribers"
                emptyDescription="Nobody follows this trader yet."
                columns={[
                  { key: 'id', header: 'Subscription', render: (row) => <code style={{ fontSize: 12 }}>{String(row.id ?? '—').slice(0, 8)}</code> },
                  { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(String(row.state ?? row.status ?? '—'))}>{String(row.state ?? row.status ?? '—')}</Badge> },
                  { key: 'allocated', header: 'Allocated', align: 'right', render: (row) => formatAmount(typeof row.allocatedAmount === 'string' ? row.allocatedAmount : null) },
                ]}
              />
            )}
          </div>
        )}
      </Card>

      <Card title="Create a strategy" description="Strategies start as drafts. Publishing exposes them to followers; the API owns the state machine.">
        <form onSubmit={(event) => void createStrategy(event)} aria-label="Create a trader strategy" style={{ display: 'grid', gap: theme.space(3), maxWidth: 700 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Trader id
              <input required value={strategyForm.traderId} onChange={(event) => setStrategyForm((current) => ({ ...current, traderId: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Name
              <input required value={strategyForm.name} onChange={(event) => setStrategyForm((current) => ({ ...current, name: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Symbols (comma separated)
              <input required value={strategyForm.symbols} onChange={(event) => setStrategyForm((current) => ({ ...current, symbols: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Venues (comma separated)
              <input required value={strategyForm.venues} onChange={(event) => setStrategyForm((current) => ({ ...current, venues: event.target.value }))} disabled={busy} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Description
            <textarea rows={2} value={strategyForm.description} onChange={(event) => setStrategyForm((current) => ({ ...current, description: event.target.value }))} disabled={busy} />
          </label>
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</button>
          </div>
        </form>
      </Card>

      <Card
        title="Strategy lifecycle"
        description="Publish, pause, resume or archive. Archiving is final: the API has no un-archive route."
        actions={
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            Strategy id
            <input value={strategyInput} onChange={(event) => setStrategyInput(event.target.value)} disabled={busy} />
          </label>
        }
      >
        {strategies.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: theme.color.textMuted }}>
            Enter a strategy id and use the row actions after creating a strategy, or publish from the strategy list once it appears.
          </p>
        )}

        <DataTable
          rows={strategyInput.trim() === '' ? [] : [{ strategyId: strategyInput.trim(), traderId: '', name: strategyInput.trim(), supportedSymbols: [], supportedVenues: [] }]}
          rowKey={(row) => row.strategyId ?? row.name}
          emptyTitle="No strategy selected"
          emptyDescription="Paste a strategy id above to act on it."
          columns={[
            { key: 'id', header: 'Strategy', render: (row) => <code style={{ fontSize: 12 }}>{row.strategyId?.slice(0, 8) ?? row.name}</code> },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={() => void transition(row, 'publish')}>Publish</button>
                  <button type="button" disabled={busy} onClick={() => void transition(row, 'pause')}>Pause</button>
                  <button type="button" disabled={busy} onClick={() => void transition(row, 'resume')}>Resume</button>
                  <button type="button" disabled={busy} onClick={() => void transition(row, 'archive')}>Archive</button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Featured rankings" description="What the marketplace currently showcases. Ranking is the service's, not a local sort.">
        {featured.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading featured traders…</p>}
        {featured.error && <ErrorNotice title="Rankings unavailable" message={featured.error} />}
        {featured.data && (
          <DataTable
            rows={featuredRows}
            rowKey={(row, index) => String(row.traderId ?? row.id ?? index)}
            emptyTitle="Nothing featured"
            emptyDescription="No trader is featured for this organisation."
            columns={[
              { key: 'name', header: 'Trader', render: (row) => String(row.displayName ?? row.traderId ?? '—') },
              { key: 'rank', header: 'Rank', align: 'right', render: (row) => (row.rank === undefined ? '—' : String(row.rank)) },
              { key: 'followers', header: 'Followers', align: 'right', render: (row) => (row.followerCount === undefined ? '—' : String(row.followerCount)) },
            ]}
          />
        )}
      </Card>

      <Card title="My copy budget" description="The total quote-asset capital you allow in active copies. Sent as an exact decimal string; the API rejects anything else.">
        <form onSubmit={(event) => void saveBudget(event)} aria-label="Set your copy budget" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Currency
            <input value={budgetForm.currency} onChange={(event) => setBudgetForm((current) => ({ ...current, currency: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 200 }}>
            Max active exposure
            <input required inputMode="decimal" value={budgetForm.maxActiveExposure} onChange={(event) => setBudgetForm((current) => ({ ...current, maxActiveExposure: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 200 }}>
            Per-trader cap (optional)
            <input inputMode="decimal" value={budgetForm.perTraderCap} onChange={(event) => setBudgetForm((current) => ({ ...current, perTraderCap: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</button>
        </form>

        {budgetResult && (
          <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 13 }}>
            Cap {formatAmount(budgetResult.maxActiveExposure, { symbol: budgetResult.currency ?? undefined })} · committed{' '}
            {formatAmount(budgetResult.committedExposure ?? null)} · remaining {formatAmount(budgetResult.remaining ?? null)}
            {budgetResult.updatedAt ? ` · saved ${formatDateTime(budgetResult.updatedAt)}` : ''}
          </p>
        )}
      </Card>

      <Card title="Platform copy policy" description="The tenant-level policy the service applies when a strategy or subscription sets no narrower rule.">
        {platformPolicy.error && <ErrorNotice title="Policy unavailable" message={platformPolicy.error} />}
        {platformPolicy.data && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(3), margin: 0 }}>
            {Object.entries(platformPolicy.data)
              .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
              .map(([key, value]) => (
                <div key={key}>
                  <dt style={{ fontSize: 11, textTransform: 'uppercase', color: theme.color.textMuted }}>{key}</dt>
                  <dd style={{ margin: 0, fontSize: 13 }}>{value === null ? 'Not set' : String(value)}</dd>
                </div>
              ))}
          </dl>
        )}
      </Card>

      <TraderProfileEditor />
    </div>
  );
}

/** Updates an existing trader profile by id. Separated so the create form stays a create form. */
function TraderProfileEditor(): JSX.Element {
  const [traderId, setTraderId] = useState('');
  const [form, setForm] = useState({ displayName: '', bio: '', isPublic: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (traderId.trim() === '') {
      setError('Enter the trader id this profile belongs to.');
      return;
    }
    if (form.displayName.trim() !== '' && form.displayName.trim().length < 2) {
      setError('A display name must be either empty or at least two characters.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await copyTradingAdminApi.updateTraderProfile(
        traderId.trim(),
        {
          ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
          ...(form.bio.trim() ? { bio: form.bio.trim() } : {}),
          isPublic: form.isPublic,
        },
        crypto.randomUUID(),
      );
      setMessage('The profile was updated.');
    } catch {
      setError('The profile was not updated. Only its owner or an administrator may change it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Update a trader profile" description="Owner-only, or an administrator. Blank fields are left unchanged.">
      <form onSubmit={(event) => void save(event)} aria-label="Update a trader profile" style={{ display: 'grid', gap: theme.space(3), maxWidth: 620 }}>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 320 }}>
          Trader id
          <input value={traderId} onChange={(event) => setTraderId(event.target.value)} disabled={busy} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Display name
            <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={form.isPublic} onChange={(event) => setForm((current) => ({ ...current, isPublic: event.target.checked }))} disabled={busy} />
            Public listing
          </label>
        </div>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Bio
          <textarea rows={2} value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} disabled={busy} />
        </label>
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Profile not updated" message={error} />}
        <div>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update profile'}</button>
        </div>
      </form>
    </Card>
  );
}

/** Export kept for the page's benefit: the profile type is shared with the editor above. */
export type { TraderProfile };
