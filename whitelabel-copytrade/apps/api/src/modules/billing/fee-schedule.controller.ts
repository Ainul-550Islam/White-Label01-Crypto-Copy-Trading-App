// # Responsibility: exposes a cacheable effective public fee schedule and step-up-protected platform publication.
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions, PlatformOnly } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { FeeScheduleService } from './fee-schedule.service';
import { PublishFeeScheduleDto } from './fee-schedule.dto';

@ApiTags('Billing - public fee schedule')
@Controller({ path: 'public/fee-schedule', version: '1' })
@ApiStandardResponses()
export class PublicFeeScheduleController {
  constructor(private readonly service: FeeScheduleService) {}
  @Get()
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control','public, max-age=60, s-maxage=60')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get effective fee rates', description: 'Public intentionally for pre-signup pricing transparency. Exposes only effective rates/version, never tenant IDs, plan names, or private configuration. An unknown host falls back to the platform default schedule.' })
  get(@TenantId() tenantId: string | null, @Query('at') at?: string) { return this.service.getPublicSchedule(tenantId, at ? new Date(at) : new Date()); }
}

@ApiTags('Billing - fee schedule administration')
@Controller({ path: 'admin/fee-schedule', version: '1' })
@ApiStandardResponses()
@PlatformOnly()
@RequirePermissions(Permission.PLATFORM_MANAGE)
export class AdminFeeScheduleController {
  constructor(private readonly service: FeeScheduleService) {}
  @Post() @HttpCode(HttpStatus.CREATED) @RequireStepUp('FEE_SCHEDULE_PUBLISH')
  @ApiOperation({ summary: 'Publish an effective-dated fee schedule version', description: 'Platform operator only; publication requires fresh step-up. Existing versions are superseded by effective interval, never overwritten.' })
  publish(@Body() dto: PublishFeeScheduleDto, @CurrentUser() actor: AuthenticatedActor) { return this.service.publish(dto, actor.userId); }
}
