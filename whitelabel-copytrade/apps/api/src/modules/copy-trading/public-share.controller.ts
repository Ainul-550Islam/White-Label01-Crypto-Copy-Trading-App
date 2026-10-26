// # Exposes share links: the owner's authenticated create/revoke/list, and the single public resolve route.
//
// THE PUBLIC ROUTE IS THE WHOLE RISK
// ---------------------------------
// `GET /v1/public/shares/:token` is reachable without a session, from anywhere,
// with any string in the path. Everything about it is therefore defensive:
//
//   * it is throttled twice - per client IP by the edge throttler, and per token by
//     `PublicShareRateLimiter` before the HMAC is computed, so a guessing campaign
//     cannot turn this endpoint into an HMAC oracle;
//   * every failure (bad signature, unknown token, expired, revoked, subject gone)
//     returns the SAME 404 body, so the response cannot be used to learn which
//     tokens exist;
//   * it is cacheable for 60 seconds and says so, because the answer is identical
//     for every visitor holding the same token and a cache hit is a request that
//     never touches the signing path;
//   * the projection it returns is already limited to the fields the owner opted
//     into - this handler adds formatting, never fields.
//
// The authenticated routes are ordinary customer routes: tenant and user come from
// the JWT via `@TenantId()`/`@CurrentUser()`, so a customer can only create or
// revoke links for their own subjects in their own tenant.
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AppRequest } from '../../common/types/request.types';
import {
  PublicShareRateLimiter,
  PublicShareService,
  type ShareSubjectType,
} from './public-share.service';

const PUBLIC_RESOLVE_THROTTLE = { default: { limit: 120, ttl: 60_000 } };
const CREATE_THROTTLE = { default: { limit: 20, ttl: 60 * 60 * 1_000 } };

/** The one 404 the public route ever returns, whatever actually went wrong. */
const NOT_FOUND_BODY = {
  found: false,
  reason: 'NOT_FOUND',
  message: 'This link is not available.',
  fields: {},
  expiresAt: null,
  indexable: false,
} as const;

@Controller()
export class PublicShareController {
  constructor(
    private readonly shares: PublicShareService,
    private readonly limiter: PublicShareRateLimiter,
  ) {}

  /**
   * Create a share link.
   *
   * `STRATEGY_MANAGE` covers a trader sharing their own strategy and
   * `COPY_SUBSCRIPTION_READ` covers the follower-facing "share this trader"
   * action; both are customer permissions, not operator ones.
   */
  @Post('copy-trading/shares')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(CREATE_THROTTLE)
  @RequireAnyPermission(Permission.STRATEGY_MANAGE, Permission.COPY_SUBSCRIPTION_READ)
  async create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body()
    body: {
      subjectType?: string;
      subjectId?: string;
      fields?: string[];
      expiryDays?: number;
    },
  ): Promise<{
    created: boolean;
    id?: string;
    token?: string;
    url?: string;
    expiresAt?: string;
    fields?: string[];
    reason?: string;
    message: string;
  }> {
    const subjectType = String(body?.subjectType ?? '').toUpperCase();
    if (subjectType !== 'TRADER' && subjectType !== 'STRATEGY') {
      return {
        created: false,
        reason: 'SUBJECT_TYPE_REQUIRED',
        message: 'Choose whether you are sharing a trader profile or a strategy.',
      };
    }
    const subjectId = String(body?.subjectId ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
      return { created: false, reason: 'SUBJECT_REQUIRED', message: 'Choose what to share.' };
    }

    const result = await this.shares.create({
      tenantId,
      ownerUserId: user.userId,
      subjectType: subjectType as ShareSubjectType,
      subjectId,
      fields: Array.isArray(body?.fields) ? body.fields.map(String) : [],
      ...(typeof body.expiryDays === 'number' ? { expiryDays: body.expiryDays } : {}),
    });

    if ('refused' in result) {
      const messages: Record<string, string> = {
        NOTHING_SHAREABLE: 'Choose at least one detail to share. Nothing is shared by default.',
        SUBJECT_UNAVAILABLE: 'That profile is not available to share.',
      };
      return {
        created: false,
        reason: result.refused,
        message: messages[result.refused] ?? 'That link could not be created.',
      };
    }

    return {
      created: true,
      id: result.id,
      token: result.token,
      url: `/s/${result.token}`,
      expiresAt: result.expiresAt,
      fields: result.fields,
      message: 'Link created. Anyone with it can see the details you chose until it expires or you revoke it.',
    };
  }

  /** Revoke one link. Someone else's id answers `revoked: false`, identically to a link that does not exist. */
  @Delete('copy-trading/shares/:id')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(Permission.STRATEGY_MANAGE, Permission.COPY_SUBSCRIPTION_READ)
  async revoke(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<{ revoked: boolean; message: string }> {
    const result = await this.shares.revoke({ tenantId, ownerUserId: user.userId, id });
    return {
      revoked: result.revoked,
      message: result.revoked
        ? 'This link no longer works.'
        : 'That link does not exist, or it has already been revoked.',
    };
  }

  /** The owner's own links, so the UI can show what is currently shared and for how long. */
  @Get('copy-trading/shares')
  @RequireAnyPermission(Permission.STRATEGY_MANAGE, Permission.COPY_SUBSCRIPTION_READ)
  async list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ): Promise<{ data: Awaited<ReturnType<PublicShareService['list']>>; total: number }> {
    const data = await this.shares.list({ tenantId, ownerUserId: user.userId });
    return { data, total: data.length };
  }

  /**
   * Resolve a public token. Anonymous by design, and deliberately indistinguishable
   * on failure.
   *
   * `no-store` is NOT used: the response is the same for every holder of the token,
   * so a 60-second shared cache reduces the attack surface instead of widening it.
   * The `Vary` header is omitted on purpose for the same reason - there is no
   * per-visitor variation to vary on.
   */
  @Public()
  @Get('public/shares/:token')
  @Throttle(PUBLIC_RESOLVE_THROTTLE)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async resolve(
    @Param('token') token: string,
    @Req() request: Pick<AppRequest, 'ipHash'>,
  ): Promise<{
    found: boolean;
    reason: string;
    message: string;
    subjectType: string | null;
    fields: Record<string, unknown>;
    expiresAt: string | null;
    indexable: boolean;
  }> {
    // Per-token budget, checked before the HMAC so a flood costs a map lookup.
    const gate = this.limiter.check(`share:${request.ipHash ?? 'unknown'}`);
    if (!gate.allowed) {
      throw new HttpException(
        { message: 'Too many requests. Try again shortly.', retryAfterSeconds: gate.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resolved = await this.shares.resolve(token);
    if (!resolved.found) {
      // The reason is logged by the service; the caller never learns it.
      throw new HttpException(NOT_FOUND_BODY, HttpStatus.NOT_FOUND);
    }

    return {
      found: true,
      reason: 'OK',
      message: resolved.expiresAt
        ? `Shared until ${new Date(resolved.expiresAt).toISOString()}.`
        : 'Shared link.',
      subjectType: resolved.subjectType,
      fields: resolved.fields,
      expiresAt: resolved.expiresAt,
      indexable: resolved.indexable,
    };
  }
}
