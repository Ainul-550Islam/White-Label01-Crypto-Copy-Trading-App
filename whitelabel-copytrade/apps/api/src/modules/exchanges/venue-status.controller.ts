// # Serves the normalised venue status a customer sees and the operator override that can set it, tenant-scoped from the JWT and step-up gated on the write.
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';

import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ExchangeVenue } from './exchange.types';
import {
  VenueStatusService,
  type VenueStatusView,
} from './venue-status.service';

const VENUE_VALUES = Object.values(ExchangeVenue) as string[];

function parseVenue(value: string): ExchangeVenue {
  const venue = String(value ?? '').trim().toUpperCase();
  if (!VENUE_VALUES.includes(venue)) {
    throw new BadRequestException(`Unknown venue. Expected one of: ${VENUE_VALUES.join(', ')}`);
  }
  return venue as ExchangeVenue;
}

/**
 * `?venues=BINANCE,OKX` narrows the answer. An empty or absent value means
 * "every venue this tenant has an account on", which the service derives from
 * the tenant's own accounts.
 */
function parseVenues(raw?: string): ExchangeVenue[] | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const parts = raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const unknown = parts.filter((part) => !VENUE_VALUES.includes(part));
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown venue(s): ${unknown.join(', ')}`);
  }
  return [...new Set(parts)] as ExchangeVenue[];
}


/**
 * `/v1/venues/status` - what a customer's trading screens read.
 *
 * Deliberately permissive: any authenticated member may ask whether a venue is
 * up, because a customer whose orders are being refused needs that answer and
 * the answer is not a secret. It reports only venues this tenant has an account
 * on (unless narrowed), so the platform's own coverage is not disclosed by a
 * venue list nobody trades.
 */
@Controller('venues')
export class VenueStatusController {
  constructor(private readonly venueStatus: VenueStatusService) {}

  @Get('status')
  @RequireAnyPermission(
    Permission.EXCHANGE_ACCOUNT_READ,
    Permission.EXECUTION_READ,
    Permission.ORDER_READ,
  )
  async list(
    @TenantId() tenantId: string,
    @Query('venues') venues?: string,
  ): Promise<{ venues: VenueStatusView[] }> {
    return { venues: await this.venueStatus.listForTenant(tenantId, parseVenues(venues)) };
  }

  @Get(':venue/status')
  @RequireAnyPermission(
    Permission.EXCHANGE_ACCOUNT_READ,
    Permission.EXECUTION_READ,
    Permission.ORDER_READ,
  )
  async one(@TenantId() tenantId: string, @Param('venue') venue: string): Promise<VenueStatusView> {
    return this.venueStatus.statusFor(tenantId, parseVenue(venue));
  }
}
