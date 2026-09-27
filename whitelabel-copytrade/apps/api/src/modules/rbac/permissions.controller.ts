import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type PermissionDefinition } from '@wlct/shared-types';

import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';

@ApiTags('Roles')
@Controller({ path: 'permissions', version: '1' })
@ApiStandardResponses()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PERMISSION_READ)
  @ApiOperation({
    summary: 'List the permission catalogue',
    description: 'Every permission that can be attached to a custom role.',
  })
  @ApiOkResponse({ description: 'Permission definitions grouped by resource.' })
  async list(): Promise<PermissionDefinition[]> {
    return this.permissionsService.listCatalogue();
  }
}
