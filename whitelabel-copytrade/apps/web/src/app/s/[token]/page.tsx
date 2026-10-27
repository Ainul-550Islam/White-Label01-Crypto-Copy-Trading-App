// # Public, server-rendered page for a shared trader or strategy link.
//
// This is the only page in the customer app that renders without a session, so its
// job is narrow and its defaults are paranoid:
//
//   * The page renders nothing but the projection the API resolved. There is no
//     client fetch, no "load more", and no authenticated call anywhere in this file:
//     a public page that reaches for a session is one deploy away from leaking one.
//   * Every failure is the same page. An expired link, a revoked link, a tampered
//     token and a link for a subject that no longer exists all render
//     "This link is not available", because distinguishing them would turn this
//     route into a way to discover which tokens exist.
//   * `robots` comes from the projection. A share is a private hand-off by default;
//     it is only indexable when the trader is already publicly listed, and that
//     decision is made by the API, not by this page.
//   * The 60-second cache mirrors the API's own `Cache-Control`. A share link that
//     is pasted into a group chat gets hit far more often than it is read, and every
//     hit would otherwise be an HMAC verification.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { serverFetch } from '@/lib/server-api';
import { resolvePublicOrigin } from '@/lib/public-origin';
import {
  buildShareMetadata,
  orderedShareFields,
  toNextMetadata,
  unavailableShareMetadata,
  type ShareProjection,
} from '@/features/trading/public-share-metadata';

export const dynamic = 'force-dynamic';

const UNAVAILABLE = 'This link is not available.';

interface PublicShareResponse extends ShareProjection {
  found: boolean;
  reason: string;
  message: string;
}

async function loadShare(token: string): Promise<PublicShareResponse | null> {
  try {
    const response = await serverFetch<PublicShareResponse>(`/public/shares/${encodeURIComponent(token)}`, {
      authenticated: false,
      revalidate: 60,
    });
    if (!response || response.found !== true) return null;
    return response;
  } catch {
    // 404, 429 and 5xx all look the same from here on purpose.
    return null;
  }
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'displayName':
      return 'Name';
    case 'strategyName':
      return 'Strategy';
    case 'headline':
      return 'About';
    case 'avatarUrl':
      return 'Avatar';
    case 'startedAt':
      return 'Started';
    case 'riskScore':
      return 'Risk score';
    case 'returnPercent30d':
      return '30-day return';
    case 'returnPercent90d':
      return '90-day return';
    case 'maxDrawdownPercent':
      return 'Maximum drawdown';
    case 'winRatePercent':
      return 'Win rate';
    case 'tradesLast30d':
      return 'Trades (30 days)';
    default:
      return field;
  }
}

interface SharedPageProps {
  // Next 16 hands route params to a server component as a promise. Typing them as a
  // plain object still compiles here, but the runtime value is a promise, so
  // `params.token` would be `undefined` and every shared link would render the
  // unavailable page. The promise is awaited exactly once per entry point.
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: SharedPageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await loadShare(token);
  const origin = resolvePublicOrigin() ?? '';
  if (!share) return toNextMetadata(unavailableShareMetadata(UNAVAILABLE));
  return toNextMetadata(
    buildShareMetadata({
      projection: share,
      origin,
      token,
      siteName: 'Copy trading',
    }),
  );
}

export default async function SharedPage({ params }: SharedPageProps): Promise<JSX.Element> {
  const { token } = await params;
  const share = await loadShare(token);
  const origin = resolvePublicOrigin() ?? '';
  const shareUrl = origin ? `${origin.replace(/\/+$/, '')}/s/${encodeURIComponent(token)}` : null;

  if (!share) {
    return (
      <div className="mx-auto grid max-w-md gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">This link is not available</h1>
        <p className="text-sm text-muted">
          The link may have expired, or the person who shared it may have withdrawn it. Ask them for a new one.
        </p>
      </div>
    );
  }

  const fields = orderedShareFields(share);
  const name =
    (typeof share.fields.displayName === 'string' && share.fields.displayName) ||
    (typeof share.fields.strategyName === 'string' && share.fields.strategyName) ||
    'Shared profile';
  const avatar = typeof share.fields.avatarUrl === 'string' ? share.fields.avatarUrl : null;

  return (
    <div className="mx-auto grid max-w-2xl gap-4 p-6">
      {/* The share URL is the page's own address; attributing it to the trader's
          private profile would credit a link the owner never handed out. */}
      {shareUrl && <link rel="canonical" href={shareUrl} />}
      <header className="flex items-center gap-3">
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary owner-supplied URL cannot be configured in next/image.
          <img src={avatar} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-lg font-semibold">{name}</h1>
          <p className="text-xs text-muted">
            Shared {share.subjectType === 'STRATEGY' ? 'strategy' : 'trader profile'}
            {share.expiresAt ? ` · available until ${new Date(share.expiresAt).toLocaleDateString()}` : ''}
          </p>
        </div>
      </header>

      {fields.length === 0 ? (
        <p className="rounded border bg-card p-3 text-sm text-muted">
          This profile is shared, but its owner has not chosen any details to show.
        </p>
      ) : (
        <dl className="grid gap-2 rounded border bg-card p-4 text-sm">
          {fields.map((entry) => (
            <div key={entry.field} className="flex items-baseline justify-between gap-3 border-b py-1 last:border-0">
              <dt className="text-muted">{fieldLabel(entry.field)}</dt>
              <dd className="font-medium">
                {entry.field.endsWith('Percent')
                  ? `${entry.value.replace(/0+$/, '').replace(/\.$/, '')}%`
                  : entry.field === 'startedAt'
                    ? new Date(entry.value).toLocaleDateString()
                    : entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-xs text-muted">
        Figures are as recorded by the platform at the time this page was requested. Past performance is not a reliable
        indicator of future results. Balances and followers are never shown on a shared page.
      </p>
    </div>
  );
}
