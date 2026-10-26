// # Responsibility: serves commercial readiness observations only to platform operators authorized to view metrics.
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { PlatformOnly, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CommercialReadinessService } from './commercial-readiness.service';
@ApiTags('Admin - commercial readiness')
@Controller({ path: 'admin/ops/commercial-readiness', version: '1' })
@ApiStandardResponses()
@PlatformOnly()
@RequirePermissions(Permission.PLATFORM_READ_METRICS)
export class CommercialReadinessController {
  constructor(private readonly service: CommercialReadinessService) {}
  @Get() @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate live commercial control-plane checks', description: 'Reports bounded live checks and explicit exclusions; it never certifies production readiness.' })
  evaluate() { return this.service.evaluate(); }
}
