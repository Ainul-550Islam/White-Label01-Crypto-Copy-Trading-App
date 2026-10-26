// # The operator side of venue status: read every venue, and put one into a named state for a bounded time.
//
// THIS LIVES IN ITS OWN FILE FOR A REASON
// ---------------------------------------
// `/v1/admin/venues` is the only surface in the platform that can silence a
// platform-wide warning, and the contract checker resolves one controller per file.
// Keeping it separate means the privileged routes are visible as a unit: two verbs,
// each with a platform permission AND a fresh, action-bound step-up proof, and each
// recording a reason that survives in the audit trail. UNKNOWN is not an assertable
// state - it is the absence of evidence, and the way back to "the feed decides" is
// to clear the override.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { ExchangeVenue } from './exchange.types';
import {
  OVERRIDE_DEFAULT_TTL_SECONDS,
  OVERRIDE_MAX_TTL_SECONDS,
  VenueStatusService,
  type VenueOperationalState,
  type VenueStatusOverride,
  type VenueStatusView,
} from './venue-status.service';

const VENUE_VALUES = Object.values(ExchangeVenue) as string[];

/** The states an operator may assert. UNKNOWN is deliberately absent. */
const OVERRIDE_STATES: VenueOperationalState[] = ['OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'OUTAGE'];

function parseVenue(value: string): ExchangeVenue {
  const venue = String(value ?? '').trim().toUpperCase();
  if (!VENUE_VALUES.includes(venue)) {
    throw new BadRequestException(`Unknown venue. Expected one of: ${VENUE_VALUES.join(', ')}`);
  }
  return venue as ExchangeVenue;
}

/** Body of an override. The TTL is optional and capped by the service. */
export class VenueStatusOverrideDto {
  @IsIn(OVERRIDE_STATES, { message: 'state must be OPERATIONAL, DEGRADED, MAINTENANCE or OUTAGE' })
  state!: VenueOperationalState;

  @IsString()
  @MinLength(8)
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(OVERRIDE_MAX_TTL_SECONDS)
  ttlSeconds?: number;
}

/**
 * `/v1/admin/venues` - the operator's side.
 *
 * One route per verb, each with the same two gates, because this surface can
 * silence a platform-wide warning for up to a day: a platform permission AND a
 * fresh, action-bound step-up proof AND a reason that survives in the audit
 * trail. Keeping it on its own controller means `check-route-authorization` sees
 * exactly which routes are privileged rather than having to infer it from a path
 * prefix.
 */
@Controller('admin/venues')
export class VenueStatusAdminController {
  constructor(private readonly venueStatus: VenueStatusService) {}

  @Get()
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async list(@TenantId() tenantId: string): Promise<{ venues: VenueStatusView[] }> {
    // Operators see every venue in the platform's vocabulary, not only the ones
    // their own tenant trades on: the override they are about to set is
    // platform-wide, so the state they must read is too.
    return { venues: await this.venueStatus.listForTenant(tenantId, Object.values(ExchangeVenue)) };
  }

  @Put(':venue/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @RequireStepUp('VENUE_STATUS_OVERRIDE')
  async set(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('venue') venue: string,
    @Body() dto: VenueStatusOverrideDto,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<VenueStatusOverride> {
    return this.venueStatus.setOverride(actor, {
      venue: parseVenue(venue),
      state: dto.state,
      reason: dto.reason,
      ttlSeconds: dto.ttlSeconds ?? OVERRIDE_DEFAULT_TTL_SECONDS,
      requestId: meta.requestId,
      ipHash: meta.ipHash,
    });
  }

  @Delete(':venue/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @RequireStepUp('VENUE_STATUS_OVERRIDE')
  async clear(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('venue') venue: string,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ cleared: boolean }> {
    return this.venueStatus.clearOverride(actor, parseVenue(venue), {
      requestId: meta.requestId,
      ipHash: meta.ipHash,
    });
  }
}
