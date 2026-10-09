// # Responsibility: defines exactly what a public trader profile may expose, and projects to it.
//
// `TraderProfile` is the internal record: it carries `tenantId`, `userId`, the trader's
// `riskProfile` (which holds the platform's own assessment of them) and bookkeeping timestamps.
// `GET traders/:traderId/profile` and `GET traders` are read by any authenticated member of the
// tenant, so returning that record verbatim published the owner's identity by user id, the tenant
// id, and an internal risk assessment, on the one surface built for other people to look at.
//
// The projection is a function rather than a spread-with-deletes, so the safe shape is the one that
// gets constructed. Adding a field to `TraderProfile` cannot silently widen this view: it appears
// here only if someone writes it here.
//
// `viewerIsOwner` is computed from the authenticated principal, never from the request. A query
// parameter that names a user cannot make a caller the owner of a profile they do not own, because
// the comparison is between the profile's owner and the id the token carried.
import { TraderProfile, TraderSafePublicStatistics, TraderVerificationState } from './copy-trading.types';

/** Public metrics for a trader profile, exactly as the statistics service reports them. */
export type PublicTraderMetrics = TraderSafePublicStatistics | null;

export interface TraderProfilePublicView {
  traderId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  verificationState: TraderVerificationState;
  verifiedAt: string | null;
  supportedVenues: string[];
  supportedSymbols: string[];
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  createdAt: string;
  /** True only when the authenticated caller owns this profile. */
  viewerIsOwner: boolean;
  /**
   * Derived statistics, or null where the caller is not the owner and the figures are not
   * published. Null means "not provided", which is deliberately distinct from a zero.
   */
  publicMetrics: PublicTraderMetrics;
}

/** A listing entry: the same public shape, without the per-viewer ownership flag or metrics. */
export type TraderProfileListingView = Omit<TraderProfilePublicView, 'viewerIsOwner' | 'publicMetrics'>;

/**
 * Projects an internal profile to what a public route may return.
 *
 * The owner still receives the public shape here - `GET traders/profile/me` is the route that
 * returns the internal record to its owner, and keeping one route single-purpose is what makes this
 * projection auditable.
 */
export function toTraderProfilePublicView(params: {
  profile: TraderProfile;
  /** The authenticated caller's user id, from the token. */
  viewerUserId: string | null;
  metrics?: PublicTraderMetrics;
}): TraderProfilePublicView {
  const { profile, viewerUserId, metrics } = params;

  return {
    traderId: profile.traderId,
    displayName: profile.displayName,
    bio: profile.bio ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    verificationState: profile.verificationState,
    verifiedAt: profile.verifiedAt ?? null,
    supportedVenues: [...(profile.supportedVenues ?? [])],
    supportedSymbols: [...(profile.supportedSymbols ?? [])],
    isPublic: profile.isPublic,
    isFeatured: profile.isFeatured,
    followerCount: profile.followerCount,
    createdAt: profile.createdAt,
    viewerIsOwner: viewerUserId !== null && profile.userId === viewerUserId,
    publicMetrics: metrics ?? null,
  };
}

/** Projects a listing entry. Ownership is not a property of a listing, so it is not computed. */
export function toTraderProfileListingView(profile: TraderProfile): TraderProfileListingView {
  return {
    traderId: profile.traderId,
    displayName: profile.displayName,
    bio: profile.bio ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    verificationState: profile.verificationState,
    verifiedAt: profile.verifiedAt ?? null,
    supportedVenues: [...(profile.supportedVenues ?? [])],
    supportedSymbols: [...(profile.supportedSymbols ?? [])],
    isPublic: profile.isPublic,
    isFeatured: profile.isFeatured,
    followerCount: profile.followerCount,
    createdAt: profile.createdAt,
  };
}
