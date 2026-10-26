// # Responsibility: the owner's dialog for creating, copying and revoking a public share link, with an explicit field-by-field opt-in and a stated expiry.
//
// THE OPT-IN IS THE POINT
// -----------------------
// Everything a share can reveal is listed here as a checkbox, off by default, with a
// sentence saying what it means. A customer who shares a link should be able to see
// the full extent of what they are sharing before they press the button, and that
// list is generated from the same allow-list the API enforces - not from a second,
// drifting copy of it.
//
// Three further rules:
//
//   * The token is shown ONCE, with a copy button. It is not stored client-side and
//     cannot be recovered later; the dialog says so instead of letting a customer
//     discover it.
//   * Revoking asks for confirmation inline. A single mis-click that silently kills
//     a link someone already sent to a group chat is not recoverable.
//   * Nothing is optimistically created or revoked. The dialog shows the server's
//     answer, including refusals, verbatim.
'use client';
import type { JSX } from 'react';

import { useMemo, useState } from 'react';

import { SHAREABLE_FIELD_LABELS, shareApi, type ShareLinkSummary } from '@/api/copy-ops-api';

export const SHARE_EXPIRY_CHOICES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/** Fields offered for a trader share, in the order they are shown. */
const TRADER_FIELDS = ['displayName', 'headline', 'avatarUrl', 'startedAt', 'returnPercent30d', 'returnPercent90d', 'maxDrawdownPercent', 'winRatePercent', 'riskScore'];
const STRATEGY_FIELDS = ['strategyName', 'headline', 'startedAt', 'returnPercent30d', 'maxDrawdownPercent', 'tradesLast30d'];

export interface ShareTraderDialogProps {
  open: boolean;
  subjectType: 'TRADER' | 'STRATEGY';
  subjectId: string;
  /** Shown in the dialog title, e.g. the trader's display name. */
  subjectLabel: string;
  onClose: () => void;
  /** Existing links for this subject, so the dialog can list and revoke them. */
  existing?: ShareLinkSummary[];
}

/**
 * Renders the form only while open.
 *
 * Closing must also forget the token the dialog just showed, the copy confirmation
 * and any half-typed revocation. Clearing them in an effect when `open` goes false is
 * a synchronous `setState` in an effect body, which React rejects (and which renders
 * once with the stale token before clearing it). Unmounting does the same job without
 * that intermediate frame, so the form lives in `ShareTraderForm` and is rebuilt from
 * `existing` every time the dialog opens.
 *
 * The key is the subject: opening the dialog for a different trader or strategy must
 * not show the previous subject's links.
 */
export function ShareTraderDialog(props: ShareTraderDialogProps): JSX.Element | null {
  if (!props.open) return null;
  return (
    <ShareTraderForm
      key={`${props.subjectType}:${props.subjectId}`}
      subjectType={props.subjectType}
      subjectId={props.subjectId}
      subjectLabel={props.subjectLabel}
      onClose={props.onClose}
      existing={props.existing ?? []}
    />
  );
}

interface ShareTraderFormProps extends Omit<ShareTraderDialogProps, 'open'> {
  existing: ShareLinkSummary[];
}

function ShareTraderForm({
  subjectType,
  subjectId,
  subjectLabel,
  onClose,
  existing,
}: ShareTraderFormProps): JSX.Element {
  const available = subjectType === 'STRATEGY' ? STRATEGY_FIELDS : TRADER_FIELDS;
  const [selected, setSelected] = useState<string[]>(['displayName', 'headline', 'startedAt']);
  const [expiryDays, setExpiryDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<ShareLinkSummary[]>(existing);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const labels = useMemo(() => {
    const map = new Map(SHAREABLE_FIELD_LABELS.map((entry) => [entry.field, entry]));
    return available.map((field) => map.get(field) ?? { field, label: field, hint: '' });
  }, [available]);

  const activeLinks = links.filter((link) => link.revokedAt === null);

  async function create(): Promise<void> {
    if (selected.length === 0) {
      setError('Choose at least one thing to share. Nothing is shared by default.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await shareApi.create({ subjectType, subjectId, fields: selected, expiryDays });
      if (!result.created) {
        setError(result.message);
        return;
      }
      setCreatedToken(result.token);
      setCreatedUrl(result.url);
      setLinks((current) => [
        {
          id: result.id ?? 'pending',
          subjectType,
          subjectId,
          expiresAt: result.expiresAt ?? '',
          revokedAt: null,
        },
        ...current,
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The link could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!createdToken) return;
    const absolute = typeof window === 'undefined' ? createdUrl ?? '' : `${window.location.origin}${createdUrl ?? `/s/${createdToken}`}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
    } catch {
      setError('The link could not be copied automatically. Select it and copy it manually.');
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await shareApi.revoke(id);
      if (!result.revoked) {
        setError(result.message);
        return;
      }
      setLinks((current) => current.map((link) => (link.id === id ? { ...link, revokedAt: new Date().toISOString() } : link)));
      setConfirmRevoke(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The link could not be revoked.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="share-dialog-title" className="text-base font-semibold">
              Share {subjectLabel}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Anyone with the link can see what you tick below, until it expires. You can revoke it at any time.
            </p>
          </div>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        {createdToken ? (
          <section className="mt-4 grid gap-3">
            <p className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900" role="status">
              Link created. Copy it now — it is not stored anywhere you can retrieve it later.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded border bg-slate-50 p-2 text-xs">{createdUrl ?? `/s/${createdToken}`}</code>
              <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white" onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="text-xs text-muted">
              What it shows: {selected.join(', ')}. The page is excluded from search engines unless your profile is
              already listed publicly.
            </p>
          </section>
        ) : (
          <section className="mt-4 grid gap-3">
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted">What to share</legend>
              {labels.map((entry) => (
                <label key={entry.field} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(entry.field)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, entry.field] : current.filter((field) => field !== entry.field),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{entry.label}</span>
                    {entry.hint && <span className="block text-xs text-muted">{entry.hint}</span>}
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="grid gap-1 text-sm">
              <span className="font-medium">Link expires after</span>
              <select className="w-40 rounded border px-3 py-2" value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))}>
                {SHARE_EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.days} value={choice.days}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-xs text-muted">
              Balances, follower lists and your email are never included in a shared page. Only the details you tick
              above are published.
            </p>

            {error && (
              <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              className="w-fit rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </section>
        )}

        <section className="mt-5 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Your links</h3>
          {activeLinks.length === 0 ? (
            <p className="mt-1 text-xs text-muted">You have no active links for this profile.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {activeLinks.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
                  <span>
                    Expires {link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : 'soon'}
                  </span>
                  {confirmRevoke === link.id ? (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="rounded bg-red-600 px-2 py-1 font-medium text-white"
                        onClick={() => void revoke(link.id)}
                        disabled={busy}
                      >
                        Yes, revoke
                      </button>
                      <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmRevoke(null)}>
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmRevoke(link.id)}>
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">
            A revoked link stops working immediately and cannot be restored. Create a new one if you need to share again.
          </p>
        </section>
      </div>
    </div>
  );
}
