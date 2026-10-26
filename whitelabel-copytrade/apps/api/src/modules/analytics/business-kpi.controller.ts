// # Responsibility: exposes platform-wide KPIs only to explicitly authorized platform operators.
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import { PlatformOnly, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { BusinessKpiService } from './business-kpi.service';

@ApiTags('Admin - business analytics')
@Controller({ path: 'admin/analytics/kpi', version: '1' })
@ApiStandardResponses()
@PlatformOnly()
@RequirePermissions(Permission.PLATFORM_READ_METRICS)
// Platform-global aggregation deliberately has no caller-supplied tenantId filter; tenant operators are rejected by PlatformOnly.
export class BusinessKpiController {
  constructor(private readonly service: BusinessKpiService) {}
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read platform-level trading and commercial KPIs', description: 'Platform-only read. Financial metrics are emitted in native-currency buckets without implicit FX conversion and include source/freshness definitions.' })
  getSnapshot() { return this.service.getSnapshot(); }
}
