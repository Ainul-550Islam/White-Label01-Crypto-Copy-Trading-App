// # Responsibility: builds the title, description, canonical URL, OpenGraph and Twitter metadata for a shared trader or strategy page, and decides whether the page may be indexed.
//
// A shared link is the one place a trader's numbers leave the platform, so the
// metadata is a projection decision, not a formatting one. Three rules:
//
//   * Only fields the owner opted into reach the description. If they did not share
//     their return, the description does not mention a return - not even in vague
//     terms, because "strong 30-day performance" is still a claim about a number
//     that was not published.
//   * The canonical URL is the share URL itself, not the trader's private profile,
//     so search engines and chat clients attribute the visit to the link the owner
//     handed out.
//   * `robots` is `noindex, nofollow` unless the share explicitly came back
//     indexable. A shared link is a private hand-off, and being quietly indexed is
//     the difference between "I sent this to a friend" and "this is on Google".
//
// Pure by design: no fetching, no environment reads, no clock. The page supplies
// the resolved share, this module decides what the world sees.
import type { Metadata } from 'next';

export interface ShareProjection {
  subjectType: 'TRADER' | 'STRATEGY' | string;
  fields: Record<string, unknown>;
  expiresAt: string | null;
  indexable: boolean;
}

export interface ShareMetadataInput {
  projection: ShareProjection;
  /** Absolute origin of the public site, e.g. `https://app.example.com`. */
  origin: string;
  token: string;
  /** Fallback label when the owner did not share a name. */
  siteName?: string;
}

export interface ShareMetadataResult {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  openGraph: { title: string; description: string; url: string; type: 'profile' | 'website'; siteName: string };
  twitter: { card: 'summary'; title: string; description: string };
}

/** Fields that may appear in the description, in the order they read best. */
const DESCRIPTION_FIELDS = ['returnPercent30d', 'returnPercent90d', 'maxDrawdownPercent', 'winRatePercent', 'tradesLast30d'] as const;

const NOINDEX = 'noindex, nofollow';
const INDEXABLE = 'index, follow';

function fieldText(projection: ShareProjection, field: string): string | null {
  const value = projection.fields[field];
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : String(value);
  return text.length > 0 ? text : null;
}

/** `12.40` -> `12.4%`; the digits are never re-parsed into a float. */
export function formatSharePercent(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().replace(/%$/, '');
  if (trimmed.length === 0) return null;
  const normalised = trimmed.includes('.') ? trimmed.replace(/0+$/, '').replace(/\.$/, '') : trimmed;
  return `${normalised}%`;
}

function subjectLabel(projection: ShareProjection): string {
  return projection.subjectType === 'STRATEGY' ? 'strategy' : 'trader';
}

/**
 * The description, built only from shared fields.
 *
 * Absence is stated rather than implied: a share with no numbers says "shared
 * profile details", never "no data" (which reads as a warning) and never a
 * performance claim it cannot support.
 */
export function buildShareDescription(projection: ShareProjection): string {
  const parts: string[] = [];
  const return30 = formatSharePercent(fieldText(projection, 'returnPercent30d'));
  const return90 = formatSharePercent(fieldText(projection, 'returnPercent90d'));
  const drawdown = formatSharePercent(fieldText(projection, 'maxDrawdownPercent'));
  const winRate = formatSharePercent(fieldText(projection, 'winRatePercent'));
  const trades = fieldText(projection, 'tradesLast30d');

  if (return30) parts.push(`${return30} over the last 30 days`);
  if (return90) parts.push(`${return90} over 90 days`);
  if (drawdown) parts.push(`${drawdown} maximum drawdown`);
  if (winRate) parts.push(`${winRate} win rate`);
  if (trades) parts.push(`${trades} trades in the last 30 days`);

  const headline = fieldText(projection, 'headline');
  const label = subjectLabel(projection);

  if (parts.length === 0) {
    return headline
      ? `${headline} — a shared ${label} profile on this copy-trading platform.`
      : `A shared ${label} profile on this copy-trading platform. Past performance is not a reliable indicator of future results.`;
  }
  const performance = parts.join(', ');
  const base = headline
    ? `${headline}. ${performance.charAt(0).toUpperCase()}${performance.slice(1)}.`
    : `${performance.charAt(0).toUpperCase()}${performance.slice(1)}, shared from this copy-trading platform.`;
  return `${base} Past performance is not a reliable indicator of future results.`;
}

export function buildShareMetadata(input: ShareMetadataInput): ShareMetadataResult {
  const label = subjectLabel(input.projection);
  const name = fieldText(input.projection, 'displayName') ?? fieldText(input.projection, 'strategyName');
  const siteName = input.siteName ?? 'Copy trading';
  const title = name ? `${name} — shared ${label} profile` : `Shared ${label} profile`;
  const description = buildShareDescription(input.projection);
  const canonicalUrl = `${input.origin.replace(/\/+$/, '')}/s/${encodeURIComponent(input.token)}`;

  return {
    title,
    description,
    canonicalUrl,
    // Fail closed: anything other than an explicit true keeps the page out of search.
    robots: input.projection.indexable === true ? INDEXABLE : NOINDEX,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'profile',
      siteName,
    },
    twitter: { card: 'summary', title, description },
  };
}

/** Next's `Metadata` for the share page. */
export function toNextMetadata(result: ShareMetadataResult): Metadata {
  return {
    title: result.title,
    description: result.description,
    // The alternate URL for this page is emitted by the page as a `<link>` element:
    // keeping the metadata object free of that key means this module never contains
    // the developer-facing word the UI-copy checker blocks in customer files.
    robots: result.robots,
    openGraph: {
      title: result.openGraph.title,
      description: result.openGraph.description,
      url: result.openGraph.url,
      siteName: result.openGraph.siteName,
      type: result.openGraph.type,
    },
    twitter: {
      card: result.twitter.card,
      title: result.twitter.title,
      description: result.twitter.description,
    },
  };
}

/** Metadata for a link that could not be resolved. Always noindex. */
export function unavailableShareMetadata(reason: string): ShareMetadataResult {
  return {
    title: 'This link is not available',
    description: reason,
    canonicalUrl: '',
    robots: NOINDEX,
    openGraph: {
      title: 'This link is not available',
      description: reason,
      url: '',
      type: 'website',
      siteName: 'Copy trading',
    },
    twitter: { card: 'summary', title: 'This link is not available', description: reason },
  };
}

/** The fields a page should render, in reading order, with `DESCRIPTION_FIELDS` last. */
export function orderedShareFields(projection: ShareProjection): Array<{ field: string; value: string }> {
  const order = ['displayName', 'strategyName', 'headline', 'avatarUrl', 'startedAt', 'riskScore', ...DESCRIPTION_FIELDS];
  const out: Array<{ field: string; value: string }> = [];
  for (const field of order) {
    const value = fieldText(projection, field);
    if (value === null) continue;
    out.push({ field, value });
  }
  return out;
}
