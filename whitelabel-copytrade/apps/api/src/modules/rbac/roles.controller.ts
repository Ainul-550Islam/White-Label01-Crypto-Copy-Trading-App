import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Permission, type PaginatedResult } from '@wlct/shared-types';
import type { AuthenticatedActor } from '@wlct/shared-types';

import { RolesService, type RoleView } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesDto } from './dto/list-roles.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Roles')
@Controller({ path: 'roles', version: '1' })
@ApiStandardResponses()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ROLE_READ)
  @ApiOperation({ summary: 'List roles available to the current organisation' })
  @ApiOkResponse({ description: 'Paginated roles including their permission sets.' })
  async list(
    @Query() query: ListRolesDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<RoleView>> {
    return this.rolesService.list(tenantId, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ROLE_READ)
  @ApiOperation({ summary: 'Fetch a single role' })
  @ApiOkResponse({ description: 'The requested role.' })
  async findOne(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<RoleView> {
    return this.rolesService.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.ROLE_CREATE)
  @Audited(AuditAction.ROLE_CREATED, 'Role')
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiCreatedResponse({ description: 'The created role.' })
  async create(
    @Body() dto: CreateRoleDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<RoleView> {
    return this.rolesService.create(tenantId, actor.userId, dto, {
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: 'Update a custom role' })
  @ApiOkResponse({ description: 'The updated role.' })
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<RoleView> {
    return this.rolesService.update(tenantId, actor.userId, id, dto, {
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ROLE_DELETE)
  @ApiOperation({ summary: 'Soft delete a custom role' })
  @ApiOkResponse({ description: 'Deletion acknowledgement.' })
  async remove(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; deleted: true }> {
    return this.rolesService.remove(tenantId, actor.userId, id, {
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }
}
